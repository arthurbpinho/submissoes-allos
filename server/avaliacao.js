// Motor da avaliação: fila → Batch API da OpenAI → agregador → sintetizador.
//
// DUAS FASES por texto (ver server/pipeline.js):
//   portao     → só o critério 10 (Regras do edital). Nota 0 = eliminado: a
//                avaliação fecha aqui, sem gastar os outros nove nós.
//   criterios  → os critérios 1–9, cegos, em paralelo, com o mesmo prefixo.
// Depois: agregador (total 0–45) e sintetizador (feedback ao autor).
//
// MODOS
//   batch         → produção. Cada fase vai num lote da Batch API (50% mais
//                   barato; até 24h por lote). Um varredor periódico submete o
//                   que está na fila e coleta os lotes prontos; quem passa no
//                   portão volta para a fila já na fase 2.
//   direto        → as mesmas requisições em chamadas normais. Para testar com
//                   a chave sem esperar lote.
//   demonstracao  → sem OPENAI_API_KEY. Saídas fictícias, na hora.
//
// O sintetizador não entra no lote: roda numa chamada normal quando a última
// fase é coletada (como no all_OS).
//
// STATUS: a submissão vai sozinha de "enviado" para "em_avaliacao" quando o
// primeiro lote é submetido, e para "avaliado" quando o feedback fica pronto.
// Daí em diante, só o admin mexe — inclusive nos eliminados pelo portão.

const { q, tx, agoraISO, json } = require('./db');
const pipeline = require('./pipeline');

const env = (k, padrao) => (process.env[k] === undefined ? padrao : process.env[k]);

// Sem chave: em dev, modo demonstração; em PRODUÇÃO, desligado — a fila espera
// a chave em vez de inventar notas e feedbacks para textos reais.
function modoAtual() {
  if (!process.env.OPENAI_API_KEY) return process.env.NODE_ENV === 'production' ? 'desligado' : 'demonstracao';
  return env('AVALIACAO_MODO', 'batch') === 'direto' ? 'direto' : 'batch';
}
const MODELO = () => env('OPENAI_MODEL', 'gpt-6-luna');
const EFFORT = () => ({ no: env('AVALIADOR_EFFORT', 'high'), sintetizador: env('SINTETIZADOR_EFFORT', 'medium') });
const TENTATIVAS_POR_NO = 3;
const MAX_TENTATIVAS_LOTE = 6;

let registrarErro = (err, onde, extra) => { console.error(`[${onde}]`, err && err.message, extra || ''); return null; };
function configurar({ registrarErro: re }) { if (re) registrarErro = re; }

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

let clienteOpenAI = null;
function openai() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!clienteOpenAI) {
    const OpenAI = require('openai');
    clienteOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 300000, maxRetries: 2 });
  }
  return clienteOpenAI;
}

async function chamarOpenAI(body) {
  const resp = await openai().chat.completions.create(body);
  return { texto: resp.choices?.[0]?.message?.content || '', uso: resp.usage || null };
}

// Ponto único de chamada síncrona. Os testes trocam por _setIA.
let chamarIA = chamarOpenAI;

function somarUso(total, uso) {
  if (!uso) return total;
  total.entrada += uso.prompt_tokens || 0;
  total.cache += uso.prompt_tokens_details?.cached_tokens || 0;
  total.saida += uso.completion_tokens || 0;
  total.raciocinio += uso.completion_tokens_details?.reasoning_tokens || 0;
  return total;
}
const usoVazio = () => ({ entrada: 0, cache: 0, saida: 0, raciocinio: 0 });
const somarDois = (a, b) => somarUso({ ...(a || usoVazio()) }, b ? {
  prompt_tokens: b.entrada, completion_tokens: b.saida,
  prompt_tokens_details: { cached_tokens: b.cache }, completion_tokens_details: { reasoning_tokens: b.raciocinio },
} : null);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function promptsAtivos() {
  const linhas = q.all(`
    SELECT p.* FROM prompts p
    JOIN (SELECT slot, MAX(id) AS id FROM prompts GROUP BY slot) u ON u.id = p.id`);
  const por = {};
  for (const l of linhas) if (pipeline.SLOT_IDS.includes(l.slot)) por[l.slot] = l;
  return por;
}

function promptsFaltando() {
  const ativos = promptsAtivos();
  return pipeline.SLOT_IDS.filter((s) => !ativos[s] || pipeline.validarSlot(s, ativos[s].conteudo));
}

function idsDosPrompts(ativos) {
  return Object.fromEntries(pipeline.SLOT_IDS.map((s) => [s, ativos[s] ? ativos[s].id : null]));
}

// Conteúdo dos prompts pelas versões gravadas na avaliação: um upload no meio
// do caminho (inclusive entre as duas fases) não mistura versões.
function promptsPorIds(ids) {
  const out = {};
  for (const slot of pipeline.SLOT_IDS) {
    const linha = ids && ids[slot] ? q.get('SELECT conteudo FROM prompts WHERE id = ?', ids[slot]) : null;
    out[slot] = linha ? linha.conteudo : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

function evento(submissaoId, tipo, detalhe, por = 'sistema') {
  q.run('INSERT INTO eventos (submissao_id, tipo, detalhe, por) VALUES (?, ?, ?, ?)', submissaoId, tipo, detalhe || null, por);
}

// Põe uma versão na fila (fase do portão). Chamado dentro da transação do envio.
function enfileirar(submissaoId, versaoId) {
  const r = q.run(
    "INSERT INTO avaliacoes (submissao_id, versao_id, status, modo, fase) VALUES (?, ?, 'na_fila', ?, 'portao')",
    submissaoId, versaoId, modoAtual(),
  );
  return Number(r.lastInsertRowid);
}

function contexto(av) {
  const versao = q.get('SELECT conteudo, palavras FROM versoes WHERE id = ?', av.versao_id);
  const sub = q.get('SELECT edital_id FROM submissoes WHERE id = ?', av.submissao_id);
  const edital = q.get('SELECT * FROM editais WHERE id = ?', sub.edital_id);
  return { texto: versao.conteudo, palavras: versao.palavras, edital };
}

function requisicoes(av, prompts, fase = av.fase) {
  const m = contexto(av);
  return pipeline.requisicoesDaFase(fase, {
    prompts,
    criterios: pipeline.parseCriterios(prompts.criterios),
    edital: m.edital,
    texto: m.texto,
    palavras: m.palavras,
    model: MODELO(),
    effort: EFFORT().no,
    cacheKey: `submissao-${av.submissao_id}-av${av.id}`,
  });
}

// Marca o início de uma fase. Na 1ª fase grava as versões dos prompts; na 2ª,
// mantém as que já estão gravadas.
function iniciar(av, { status, batchId = null, ids = null }) {
  const prompts = av.prompts ? av.prompts : JSON.stringify(ids || idsDosPrompts(promptsAtivos()));
  tx(() => {
    q.run(
      'UPDATE avaliacoes SET status = ?, batch_id = ?, prompts = ?, modelo = ?, modo = ?, submetido_em = COALESCE(submetido_em, ?) WHERE id = ?',
      status, batchId, prompts, modoAtual() === 'demonstracao' ? 'demonstração' : MODELO(), modoAtual(), agoraISO(), av.id,
    );
    const mudou = q.run(
      "UPDATE submissoes SET status = 'em_avaliacao', atualizado_em = ? WHERE id = ? AND status IN ('enviado', 'em_avaliacao')",
      agoraISO(), av.submissao_id,
    );
    const quem = av.fase === 'portao' ? 'portão (regras do edital)' : 'critérios 1–9';
    if (mudou.changes || av.fase === 'criterios') evento(av.submissao_id, 'avaliacao_iniciada', `${quem}${batchId ? ` · lote ${batchId}` : ''}`);
  });
  return q.get('SELECT * FROM avaliacoes WHERE id = ?', av.id);
}

// ---------------------------------------------------------------------------
// Nós: saída do lote (ou nenhuma) + reparo síncrono
// ---------------------------------------------------------------------------

const ehPortao = (req) => req.numero === pipeline.PORTAO;
const parseDe = (req, texto) => pipeline.parseSaidaCriterio(texto, ehPortao(req) ? pipeline.NOTA_MAX_PORTAO : pipeline.NOTA_MAX);

async function rodarNo(req, textoDoLote, uso, demo, textoSubmetido) {
  if (demo) return { texto: pipeline.saidaDemonstracao(req.chave, textoSubmetido), tentativas: 1 };
  if (textoDoLote != null && parseDe(req, textoDoLote).completo) return { texto: textoDoLote, tentativas: 1 };
  let ultimo = textoDoLote;
  for (let i = 0; i < TENTATIVAS_POR_NO; i++) {
    const r = await chamarIA(req.body);
    somarUso(uso, r.uso);
    ultimo = r.texto;
    if (parseDe(req, ultimo).completo) return { texto: ultimo, tentativas: i + 1 + (textoDoLote != null ? 1 : 0) };
  }
  const e = new Error(`nó "${req.chave}" sem saída válida após ${TENTATIVAS_POR_NO} tentativas`);
  e.saida = String(ultimo || '').slice(0, 1500);
  throw e;
}

async function rodarFase(av, fase, saidasDoLote, uso) {
  const prompts = promptsPorIds(json(av.prompts, {}));
  const reqs = requisicoes(av, prompts, fase);
  const demo = modoAtual() === 'demonstracao';
  const { texto } = contexto(av);
  const saidas = await Promise.all(reqs.map((r) => rodarNo(r, saidasDoLote.has(r.chave) ? saidasDoLote.get(r.chave) : null, uso, demo, texto)));
  const out = {};
  reqs.forEach((r, i) => { out[r.numero] = { ...parseDe(r, saidas[i].texto), tentativas: saidas[i].tentativas }; });
  return out;
}

// Fim da fase do portão. Nota 0 → fecha a avaliação; 1 ou 2 → segue para os nove.
// Devolve true quando a avaliação precisa da fase 2.
async function concluirPortao(av, saidasDoLote = new Map(), usoDoLote = usoVazio()) {
  const uso = { ...usoDoLote };
  const r = (await rodarFase(av, 'portao', saidasDoLote, uso))[pipeline.PORTAO];
  const portao = { nota: r.nota, analise: r.analise, tentativas: r.tentativas };
  q.run('UPDATE avaliacoes SET triagem = ?, portao_nota = ?, uso = ? WHERE id = ?', JSON.stringify(portao), r.nota, JSON.stringify(uso), av.id);
  evento(av.submissao_id, 'portao_concluido', `nota ${r.nota} · ${pipeline.ROTULO_PORTAO[r.nota]}`);
  if (r.nota === 0) {
    await finalizar(q.get('SELECT * FROM avaliacoes WHERE id = ?', av.id));
    return false;
  }
  return true;
}

// Fecha a avaliação: (critérios 1–9, se houve fase 2) → agregador → sintetizador.
async function finalizar(av, saidasDoLote = null, usoDoLote = null) {
  const prompts = promptsPorIds(json(av.prompts, {}));
  const criterios = pipeline.parseCriterios(prompts.criterios);
  const m = contexto(av);
  const portao = json(av.triagem);
  const uso = somarDois(json(av.uso, usoVazio()), usoDoLote);
  const demo = modoAtual() === 'demonstracao';

  const resultados = portao.nota === 0 ? {} : await rodarFase(av, 'criterios', saidasDoLote || new Map(), uso);
  const ag = pipeline.agregar({
    notasPorNumero: Object.fromEntries(Object.entries(resultados).map(([n, r]) => [n, r.nota])),
    portao: portao.nota,
    limiarDescarte: m.edital.limiar_descarte,
  });

  let feedback;
  if (demo) {
    feedback = pipeline.sinteseDemonstracao(ag.eliminado);
  } else {
    const conteudo = pipeline.montarPromptSintetizador(prompts.sintetizador, {
      edital: m.edital, texto: m.texto, portao, criterios, resultadosPorNumero: resultados,
    });
    const r = await chamarIA(pipeline.corpoChat({
      model: MODELO(), effort: EFFORT().sintetizador, maxTokens: pipeline.MAX_TOKENS.sintetizador,
      messages: [{ role: 'user', content: conteudo }],
    }));
    somarUso(uso, r.uso);
    feedback = String(r.texto || '').trim();
    if (!feedback) throw new Error('resposta vazia do sintetizador');
  }

  tx(() => {
    q.run(
      `UPDATE avaliacoes SET status = 'concluida', criterios = ?, nota_final = ?, subtotais = ?, eliminado = ?,
         sugestao = ?, feedback_ia = ?, uso = ?, erro = NULL, concluido_em = ? WHERE id = ?`,
      JSON.stringify(criterios.filter((c) => !c.portao && resultados[c.numero]).map((c) => ({
        numero: c.numero, nome: c.nome, terco: c.terco,
        nota: resultados[c.numero].nota, analise: resultados[c.numero].analise,
        faltou: resultados[c.numero].faltou, tentativas: resultados[c.numero].tentativas,
      }))),
      ag.total, ag.subtotais ? JSON.stringify(ag.subtotais) : null, ag.eliminado, ag.sugestao, feedback, JSON.stringify(uso), agoraISO(), av.id,
    );
    const mudou = q.run(
      "UPDATE submissoes SET status = 'avaliado', atualizado_em = ? WHERE id = ? AND status IN ('enviado', 'em_avaliacao')",
      agoraISO(), av.submissao_id,
    );
    if (mudou.changes) {
      evento(av.submissao_id, 'avaliacao_concluida', ag.eliminado
        ? 'eliminado no portão (regras do edital)'
        : `total ${ag.total}/${pipeline.TOTAL_MAX}${ag.conferirRegra ? ' · conferir regra apontada' : ''}${ag.sugestao ? ` · sugestão: ${ag.sugestao}` : ''}`);
    }
  });
}

function marcarErro(av, err) {
  const codigo = registrarErro(err, 'avaliacao', { avaliacaoId: av.id, submissaoId: av.submissao_id, fase: av.fase, saida: err && err.saida });
  q.run("UPDATE avaliacoes SET status = 'erro', erro = ? WHERE id = ?",
    `${(err && err.message) || err}${codigo ? ` (${codigo})` : ''}`.slice(0, 1000), av.id);
  evento(av.submissao_id, 'avaliacao_erro', String((err && err.message) || err).slice(0, 300));
}

// Modo direto e demonstração: as duas fases em sequência, na hora.
async function executarSincrono(av) {
  let atual = iniciar(av, { status: 'executando' });
  try {
    if (atual.fase === 'portao') {
      const segue = await concluirPortao(atual);
      if (!segue) return;
      q.run("UPDATE avaliacoes SET fase = 'criterios' WHERE id = ?", atual.id);
      atual = q.get('SELECT * FROM avaliacoes WHERE id = ?', atual.id);
    }
    await finalizar(atual);
  } catch (err) {
    marcarErro(atual, err);
  }
}

// ---------------------------------------------------------------------------
// Batch API
// ---------------------------------------------------------------------------

async function arquivoDoLote(jsonl) {
  const O = require('openai');
  const toFile = O.toFile || (O.default && O.default.toFile);
  return toFile(Buffer.from(jsonl, 'utf-8'), 'submissoes-lote.jsonl', { type: 'application/jsonl' });
}

async function submeterLote(avs) {
  const cli = openai();
  // Fotografa os prompts antes dos awaits: um upload durante o envio não pode
  // fazer o lote rodar uma versão e a avaliação registrar outra. Na fase 2 vale
  // a versão gravada na fase 1.
  const ids = idsDosPrompts(promptsAtivos());
  const linhas = [];
  for (const av of avs) {
    const prompts = promptsPorIds(av.prompts ? json(av.prompts, {}) : ids);
    for (const r of requisicoes(av, prompts)) {
      linhas.push({ custom_id: `av${av.id}::${r.chave}`, method: 'POST', url: '/v1/chat/completions', body: r.body });
    }
  }
  const jsonl = `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`;
  const file = await cli.files.create({ file: await arquivoDoLote(jsonl), purpose: 'batch' });
  const batch = await cli.batches.create({ input_file_id: file.id, endpoint: '/v1/chat/completions', completion_window: '24h' });
  q.run('INSERT INTO lotes (batch_id, modelo, requisicoes, status) VALUES (?, ?, ?, ?)', batch.id, MODELO(), linhas.length, batch.status || 'validating');
  for (const av of avs) iniciar(av, { status: 'em_lote', batchId: batch.id, ids });
  console.log(`[lote] ${batch.id}: ${avs.length} avaliação(ões), ${linhas.length} requisições`);
  return batch.id;
}

function lerSaidasDoLote(jsonl) {
  const porAv = new Map();
  for (const linha of String(jsonl || '').split('\n')) {
    if (!linha.trim()) continue;
    let obj;
    try { obj = JSON.parse(linha); } catch { continue; }
    const m = /^av(\d+)::(.+)$/.exec(String(obj.custom_id || ''));
    if (!m) continue;
    const body = obj.response && obj.response.body;
    const texto = body?.choices?.[0]?.message?.content;
    const atual = porAv.get(Number(m[1])) || { saidas: new Map(), uso: usoVazio() };
    if (typeof texto === 'string') atual.saidas.set(m[2], texto);
    somarUso(atual.uso, body && body.usage);
    porAv.set(Number(m[1]), atual);
  }
  return porAv;
}

// Falha de lote: espera (fila cheia), retenta (transitório/expirado) ou erro.
function classificarFalha(batch) {
  const dados = (batch.errors && batch.errors.data) || [];
  const codigos = dados.map((e) => e && e.code).filter(Boolean);
  const motivo = dados.map((e) => (e && (e.message || e.code)) || '').filter(Boolean).join(' | ').slice(0, 300) || `lote ${batch.status}`;
  if (batch.status === 'cancelled' || batch.status === 'cancelling') return { acao: 'erro', motivo };
  if (batch.status === 'expired') return { acao: 'retenta', motivo: 'lote expirou (janela de 24h)' };
  if (codigos.includes('token_limit_exceeded')) return { acao: 'espera', motivo };
  if (codigos.some((c) => ['rate_limit_exceeded', 'server_error', 'internal_error'].includes(c))) return { acao: 'retenta', motivo };
  return { acao: 'erro', motivo };
}

// Devolve os ids das avaliações que passaram no portão neste lote.
async function coletarLote(lote) {
  const passaram = [];
  const cli = openai();
  const batch = await cli.batches.retrieve(lote.batch_id);
  const avs = q.all("SELECT * FROM avaliacoes WHERE batch_id = ? AND status = 'em_lote'", lote.batch_id);
  if (['validating', 'in_progress', 'finalizing'].includes(batch.status)) {
    if (batch.status !== lote.status) q.run('UPDATE lotes SET status = ? WHERE batch_id = ?', batch.status, lote.batch_id);
    return passaram;
  }
  if (batch.status === 'completed') {
    let porAv = new Map();
    if (batch.output_file_id) porAv = lerSaidasDoLote(await (await cli.files.content(batch.output_file_id)).text());
    q.run("UPDATE lotes SET status = 'completed', finalizado_em = ? WHERE batch_id = ?", agoraISO(), lote.batch_id);
    for (const av of avs) {
      const r = porAv.get(av.id) || { saidas: new Map(), uso: usoVazio() };
      try {
        if (av.fase === 'portao') {
          const segue = await concluirPortao(av, r.saidas, r.uso);
          // Passou no portão: volta para a fila, já na fase dos nove critérios.
          if (segue) {
            q.run("UPDATE avaliacoes SET fase = 'criterios', status = 'na_fila', batch_id = NULL, tentativas = 0 WHERE id = ?", av.id);
            passaram.push(av.id);
          }
        } else {
          await finalizar(av, r.saidas, r.uso);
        }
      } catch (err) {
        marcarErro(av, err);
      }
    }
    return passaram;
  }
  // failed / expired / cancelled
  const c = classificarFalha(batch);
  q.run('UPDATE lotes SET status = ?, erro = ?, finalizado_em = ? WHERE batch_id = ?', batch.status, c.motivo, agoraISO(), lote.batch_id);
  for (const av of avs) {
    const tentativas = av.tentativas + (c.acao === 'retenta' ? 1 : 0);
    if (c.acao === 'erro' || tentativas >= MAX_TENTATIVAS_LOTE) {
      marcarErro(av, new Error(`lote ${lote.batch_id}: ${c.motivo}`));
    } else {
      q.run("UPDATE avaliacoes SET status = 'na_fila', batch_id = NULL, tentativas = ? WHERE id = ?", tentativas, av.id);
      evento(av.submissao_id, 'avaliacao_reenfileirada', c.motivo);
    }
  }
  return passaram;
}

// ---------------------------------------------------------------------------
// Varredor
// ---------------------------------------------------------------------------

const estado = { rodando: false, deNovo: false, ultimoCiclo: null, ultimoErro: null, avisouPrompts: false };

async function ciclo() {
  if (estado.rodando) { estado.deNovo = true; return; }
  estado.rodando = true;
  try {
    do {
      estado.deNovo = false;
      await umCiclo();
    } while (estado.deNovo);
    estado.ultimoErro = null;
  } catch (err) {
    estado.ultimoErro = (err && err.message) || String(err);
    registrarErro(err, 'avaliacao/ciclo');
  } finally {
    estado.rodando = false;
    estado.ultimoCiclo = agoraISO();
  }
}

// `ids`: submete só estas (os que acabaram de passar no portão). Sem `ids`,
// a fila inteira — inclusive o que voltou de um lote recusado, que assim
// espera o próximo ciclo em vez de ser reenviado na mesma hora.
async function submeterFila(ids = null) {
  const fila = q.all("SELECT * FROM avaliacoes WHERE status = 'na_fila' ORDER BY id")
    .filter((av) => !ids || ids.includes(av.id));
  if (!fila.length) return;
  if (modoAtual() === 'desligado') {
    if (!estado.avisouChave) console.warn('[avaliacao] fila parada: OPENAI_API_KEY ausente em produção');
    estado.avisouChave = true;
    return;
  }
  const faltando = promptsFaltando();
  if (faltando.length) {
    if (!estado.avisouPrompts) console.warn(`[avaliacao] fila parada: faltam prompts válidos (${faltando.join(', ')})`);
    estado.avisouPrompts = true;
    return;
  }
  estado.avisouPrompts = false;
  if (modoAtual() !== 'batch') {
    for (const av of fila) await executarSincrono(av);
    return;
  }
  const max = Math.max(1, Number(env('BATCH_MAX_SUBMISSOES', 20)) || 20);
  for (let i = 0; i < fila.length; i += max) {
    const grupo = fila.slice(i, i + max);
    try {
      await submeterLote(grupo);
    } catch (err) {
      // Falha ao SUBMETER (rede, chave): fica na fila para o próximo ciclo.
      registrarErro(err, 'avaliacao/submeter-lote', { avaliacoes: grupo.map((a) => a.id) });
      break;
    }
  }
}

async function umCiclo() {
  await submeterFila();
  if (!openai()) return;
  const passaram = [];
  for (const lote of q.all("SELECT * FROM lotes WHERE status NOT IN ('completed', 'failed', 'expired', 'cancelled')")) {
    try {
      passaram.push(...await coletarLote(lote));
    } catch (err) {
      registrarErro(err, 'avaliacao/coletar-lote', { batchId: lote.batch_id });
    }
  }
  // Quem passou no portão já sai neste ciclo para o lote dos nove critérios.
  if (passaram.length) await submeterFila(passaram);
}

let timer = null;
let cutucada = null;
function iniciarVarredor() {
  // Uma avaliação síncrona em curso morre com o processo: volta para a fila
  // (na fase em que estava).
  const r = q.run("UPDATE avaliacoes SET status = 'na_fila' WHERE status = 'executando'");
  if (r.changes) console.log(`[avaliacao] ${r.changes} avaliação(ões) interrompida(s) voltaram para a fila`);
  const intervalo = Math.max(10000, Number(env('AVALIACAO_INTERVALO_MS', 120000)) || 120000);
  timer = setInterval(ciclo, intervalo);
  timer.unref?.();
  setTimeout(ciclo, 1500).unref?.();
  const m = modoAtual();
  console.log(`[avaliacao] modo ${m}${['batch', 'direto'].includes(m) ? ` · modelo ${MODELO()}` : ''} · varredor a cada ${Math.round(intervalo / 1000)}s`);
}
function pararVarredor() { if (timer) clearInterval(timer); timer = null; }

// Pede um ciclo logo (depois de um envio), sem esperar o intervalo.
function cutucar() {
  if (cutucada) return;
  cutucada = setTimeout(() => { cutucada = null; ciclo(); }, 300);
  cutucada.unref?.();
}

function resumo() {
  const contagem = Object.fromEntries(q.all('SELECT status, COUNT(*) AS n FROM avaliacoes GROUP BY status').map((r) => [r.status, r.n]));
  const porFase = Object.fromEntries(q.all("SELECT fase, COUNT(*) AS n FROM avaliacoes WHERE status IN ('na_fila', 'em_lote', 'executando') GROUP BY fase").map((r) => [r.fase, r.n]));
  return {
    modo: modoAtual(),
    modelo: modoAtual() === 'demonstracao' ? null : MODELO(),
    effort: EFFORT(),
    fila: contagem,
    emAndamentoPorFase: porFase,
    lotesEmVoo: q.all("SELECT * FROM lotes WHERE status NOT IN ('completed', 'failed', 'expired', 'cancelled') ORDER BY criado_em"),
    promptsFaltando: promptsFaltando(),
    rodando: estado.rodando,
    ultimoCiclo: estado.ultimoCiclo,
    ultimoErro: estado.ultimoErro,
  };
}

module.exports = {
  configurar,
  modoAtual,
  promptsAtivos,
  promptsFaltando,
  enfileirar,
  ciclo,
  cutucar,
  iniciarVarredor,
  pararVarredor,
  resumo,
  lerSaidasDoLote,
  classificarFalha,
  _setIA(fn) { chamarIA = fn; },
  _setCliente(c) { clienteOpenAI = c; },
};
