// Pipeline de avaliação, em funções puras (sem rede, sem banco).
//
// Estrutura do quadro branco do pipeline (a mesma do all_OS) com os critérios e a régua do
// "Avaliador da revista" (.prompts/Avaliador da revista — *.md):
//
//   Input: texto submetido + resumo do edital
//   Metacomando (cabeçalho comum) + Princípios          ┐ prefixo comum,
//   [resumo do edital] + [texto submetido]               ┘ igual em todos os nós (cache)
//   ── fase 1: PORTÃO ──
//   Critério 10 · Regras do edital, régua própria 0/1/2 (pior ocorrência)
//     0 → eliminado: os outros nove não rodam (o admin ainda decide)
//     1 → segue, com sinal para o admin conferir a regra
//     2 → segue
//   ── fase 2: critérios 1–9, nós cegos em paralelo, régua geral 0–5 ──
//   Agregador (código): total 0–45 em três terços de 0–15
//   Sintetizador (IA): feedback ao autor
//
// Por que o portão vai antes: o que pesa no custo é a SAÍDA de cada nó (o
// raciocínio); o cache só barateia a entrada. Cortar os eliminados antes poupa
// nove nós por texto; o empate com o paralelo fica em ~3% de eliminação.
//
// CACHE: o prefixo (metacomando + princípios + edital + texto) é idêntico nos
// dez nós; a régua e o critério vão na mensagem do usuário, no fim.

const SLOTS = [
  {
    id: 'metacomando',
    nome: 'Metacomando (cabeçalho comum)',
    descricao: 'Papel do avaliador e como trabalhar. Abre o prefixo comum (cacheado) dos dez nós.',
    exige: [],
  },
  {
    id: 'principios',
    nome: 'Princípios',
    descricao: 'Princípios para evitar os problemas típicos de IA na avaliação de textos.',
    exige: [],
  },
  {
    id: 'regua',
    nome: 'Régua geral 0–5 (critérios 1–9)',
    descricao: 'Escala dos critérios de qualidade e o formato de saída desses nós.',
    exige: ['ANÁLISE:', 'FALTOU:', 'NOTA:'],
  },
  {
    id: 'regua_portao',
    nome: 'Régua do portão 0–2 (critério 10)',
    descricao: 'Escala de conformidade das Regras do edital (pior ocorrência) e o formato de saída do portão.',
    exige: ['ANÁLISE:', 'NOTA:'],
  },
  {
    id: 'criterios',
    nome: 'Critérios',
    descricao: 'Os 10 critérios. O 10 (Regras do edital) é o portão; 1–9 formam os três terços.',
    exige: [],
  },
  {
    id: 'sintetizador',
    nome: 'Sintetizador',
    descricao: 'Junta as análises num feedback único ao autor.',
    exige: ['{{ANALISES}}', '{{PORTAO}}'],
  },
];
const SLOT_IDS = SLOTS.map((s) => s.id);

const TOTAL_CRITERIOS = 10;
const PORTAO = 10;              // número do critério que funciona como portão
const NOTA_MAX = 5;             // régua geral
const NOTA_MAX_PORTAO = 2;      // régua do portão
// Os três terços pesam igual, por decisão editorial (guia de implementação).
const TERCOS = [
  { id: 'relevancia', nome: 'Relevância', criterios: [1, 2, 3] },
  { id: 'rigor', nome: 'Rigor', criterios: [4, 5, 6] },
  { id: 'escrita', nome: 'Escrita', criterios: [7, 8, 9] },
];
const TOTAL_MAX = TERCOS.reduce((s, t) => s + t.criterios.length, 0) * NOTA_MAX; // 45
const MAX_TOKENS = { no: 16000, sintetizador: 16000 };

// ---------------------------------------------------------------------------
// Critérios
// ---------------------------------------------------------------------------

function extrairCampo(corpo, rotulo) {
  const marca = `**${rotulo}**`;
  const i = corpo.indexOf(marca);
  if (i === -1) return '';
  return corpo.slice(i + marca.length).split(/\n\s*\n/)[0].trim();
}

// Aceita dois formatos.
//
// O do documento de critérios (prosa corrida; o bloco é a seção inteira):
//   ## 1. Nome do critério
//   **Nome do critério.** Mede…
//   (parágrafos)
//
// E o do allosvendas (campos rotulados):
//   ## 1 · Nome
//   **Linha curta.** …   **Peso.** 1   **Bloco.** …   ---
function parseCriterios(md) {
  const secoes = String(md || '').replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  return secoes.map((sec, i) => {
    const linhas = sec.split('\n');
    const titulo = linhas[0].trim();
    const tm = titulo.match(/^(\d+)\s*[·.\-–—)]\s*(.+)$/);
    const nome = (tm ? tm[2] : titulo).trim();
    const corpo = linhas.slice(1).join('\n').split(/^---\s*$/m)[0].trim();
    const iBloco = corpo.indexOf('**Bloco.**');
    let bloco;
    let definicao;
    if (iBloco !== -1) {
      bloco = corpo.slice(iBloco + '**Bloco.**'.length).trim();
      definicao = extrairCampo(corpo, 'Definição.') || extrairCampo(corpo, 'Linha curta.');
    } else {
      bloco = corpo;
      // Primeiro parágrafo, sem o nome em negrito do começo.
      definicao = corpo.split(/\n\s*\n/)[0].replace(/^\*\*[^*]+\*\*\s*/, '').trim();
    }
    const pesoTxt = extrairCampo(corpo, 'Peso.');
    const numero = tm ? Number(tm[1]) : i + 1;
    return {
      numero,
      nome,
      definicao,
      linhaCurta: extrairCampo(corpo, 'Linha curta.') || `${nome}: ${definicao}`,
      peso: pesoTxt ? Number(pesoTxt.replace(',', '.')) : 1,
      bloco,
      portao: numero === PORTAO,
      terco: (TERCOS.find((t) => t.criterios.includes(numero)) || {}).id || null,
    };
  });
}

function validarSlot(slotId, conteudo) {
  const slot = SLOTS.find((s) => s.id === slotId);
  if (!slot) return 'Prompt desconhecido.';
  const texto = String(conteudo || '');
  if (texto.trim().length < 50) return 'O texto está vazio ou curto demais.';
  const faltando = slot.exige.filter((m) => !texto.includes(m));
  if (faltando.length) return `Este texto não parece ser o prompt "${slot.nome}": falta ${faltando.join(', ')}.`;
  if (slotId === 'criterios') {
    const cs = parseCriterios(texto);
    if (cs.length !== TOTAL_CRITERIOS) return `O arquivo de critérios precisa ter ${TOTAL_CRITERIOS} critérios (encontrei ${cs.length}).`;
    const nums = cs.map((c) => c.numero).sort((a, b) => a - b).join(',');
    if (nums !== '1,2,3,4,5,6,7,8,9,10') return 'Os critérios precisam estar numerados de 1 a 10 (o 10 é o portão, Regras do edital).';
    const incompleto = cs.find((c) => !c.nome || !c.bloco || c.bloco.length < 80);
    if (incompleto) return `O critério "${incompleto.nome || '?'}" está sem texto.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Montagem das requisições
// ---------------------------------------------------------------------------

function preencher(template, valores) {
  let out = String(template);
  for (const [k, v] of Object.entries(valores)) out = out.split(`{{${k}}}`).join(String(v ?? ''));
  return out;
}

function semBreakpoints(texto) {
  return String(texto || '').replace(/^=== CACHE BREAKPOINT[^\n]*===\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// O "resumo do edital" que entra no pipeline.
function materialDoEdital(edital) {
  const linhas = [`Edital: ${edital.titulo}`];
  if (edital.revista) linhas.push(`Revista: ${edital.revista}`);
  const lim = [];
  if (edital.palavras_min) lim.push(`mínimo de ${edital.palavras_min} palavras`);
  if (edital.palavras_max) lim.push(`máximo de ${edital.palavras_max} palavras`);
  if (lim.length) linhas.push(`Extensão: ${lim.join(', ')}`);
  const resumo = String(edital.resumo_ia || '').trim() || String(edital.corpo || '').trim() || '(o edital não traz resumo)';
  return `${linhas.join('\n')}\n\n${resumo}`;
}

// Prefixo comum dos dez nós.
function montarDeveloper(prompts, { edital, texto, palavras }) {
  return [
    semBreakpoints(prompts.metacomando),
    semBreakpoints(prompts.principios),
    '[RESUMO DO EDITAL]',
    `<edital>\n${materialDoEdital(edital)}\n</edital>`,
    '[TEXTO SUBMETIDO]',
    `<texto palavras="${palavras}">\n${texto}\n</texto>`,
  ].join('\n\n');
}

// O que muda por nó: a régua (geral ou do portão) e o critério.
function montarUserCriterio(prompts, c) {
  return [
    semBreakpoints(c.portao ? prompts.regua_portao : prompts.regua),
    '[CRITÉRIO]',
    `## ${c.numero}. ${c.nome}\n\n${c.bloco}`,
    '[TAREFA]',
    c.portao
      ? 'Verifique o texto submetido contra as regras deste critério, aplique a régua do portão e responda exatamente no formato de saída dela.'
      : 'Avalie o texto submetido somente neste critério, aplique a régua e responda exatamente no formato de saída dela.',
  ].join('\n\n');
}

function corpoChat({ model, effort, maxTokens, messages, cacheKey }) {
  const b = { model, messages, max_completion_tokens: maxTokens };
  if (effort) b.reasoning_effort = effort;
  if (cacheKey) b.prompt_cache_key = cacheKey;
  return b;
}

// Requisições de uma fase: 'portao' (só o critério 10) ou 'criterios' (1–9).
// `chave` identifica o nó no custom_id do lote.
function requisicoesDaFase(fase, { prompts, criterios, edital, texto, palavras, model, effort, cacheKey }) {
  const developer = { role: 'developer', content: montarDeveloper(prompts, { edital, texto, palavras }) };
  const escolhidos = criterios.filter((c) => (fase === 'portao' ? c.portao : !c.portao));
  return escolhidos.map((c) => ({
    chave: `c${c.numero}`,
    numero: c.numero,
    body: corpoChat({
      model, effort, maxTokens: MAX_TOKENS.no, cacheKey,
      messages: [developer, { role: 'user', content: montarUserCriterio(prompts, c) }],
    }),
  }));
}

// ---------------------------------------------------------------------------
// Leitura das saídas
// ---------------------------------------------------------------------------

const RE_NOTA = /^\s*[-*]?\s*\**\s*NOTA\s*\**\s*:\s*\**\s*(\d{1,2})(?:[.,]\d+)?\s*(?:\/\s*\d+)?/im;
const ROTULOS = [
  { chave: 'analise', re: /^\s*\**\s*(?:AN[ÁA]LISE|JUSTIFICATIVA)\s*\**\s*:\s*\**\s*/i },
  { chave: 'faltou', re: /^\s*\**\s*(?:FALTOU|O QUE FALTOU)\s*\**\s*:\s*\**\s*/i },
];

// ANÁLISE (a justificativa com trechos), FALTOU (o que faltou para o nível
// seguinte; o portão não tem) e NOTA (0 a `max`).
function parseSaidaCriterio(texto, max = NOTA_MAX) {
  const partes = { analise: [], faltou: [] };
  let atual = null;
  let nota = null;
  for (const l of String(texto || '').split('\n')) {
    const m = l.match(RE_NOTA);
    if (m) { atual = null; if (nota === null) nota = Number(m[1]); continue; }
    const rot = ROTULOS.find((r) => r.re.test(l));
    if (rot) { atual = rot.chave; partes[atual].push(l.replace(rot.re, '')); continue; }
    if (atual) partes[atual].push(l);
  }
  const limpa = (arr) => arr.join('\n').replace(/\*+\s*$/, '').trim();
  const ok = nota !== null && nota >= 0 && nota <= max;
  const analise = limpa(partes.analise);
  return { nota: ok ? nota : null, analise, faltou: limpa(partes.faltou), completo: ok && analise.length > 0 };
}

// ---------------------------------------------------------------------------
// Agregador
// ---------------------------------------------------------------------------

// Total 0–45 e os três terços (0–15). Não há nota de corte: a escolha é
// comparativa e humana. A sugestão só aponta os extremos:
//   'eliminado' → portão 0
//   'descartar' → total abaixo do limiar de descarte do edital (se houver)
function agregar({ notasPorNumero, portao, limiarDescarte = null }) {
  const eliminado = portao === 0;
  if (eliminado) {
    return { total: null, subtotais: null, portao, eliminado: true, conferirRegra: false, sugestao: 'eliminado' };
  }
  const subtotais = {};
  for (const t of TERCOS) subtotais[t.id] = t.criterios.reduce((s, n) => s + (Number(notasPorNumero[n]) || 0), 0);
  const total = Object.values(subtotais).reduce((s, n) => s + n, 0);
  const descartar = limiarDescarte != null && total < limiarDescarte;
  return { total, subtotais, portao, eliminado: false, conferirRegra: portao === 1, sugestao: descartar ? 'descartar' : null };
}

// Posição de cada nota no lote (os textos avaliados do mesmo edital): os 20%
// de cima e os 20% de baixo. Com texto de aluno, uma escala fixa deixaria
// quase tudo vermelho. Com menos de 5 textos não há lote para comparar.
function faixasDoLote(valores) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 5) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  return { base: q(0.2), topo: q(0.8) };
}
function faixa(valor, limites) {
  if (!limites || !Number.isFinite(valor)) return null;
  if (valor >= limites.topo && limites.topo > limites.base) return 'topo';
  if (valor <= limites.base && limites.topo > limites.base) return 'base';
  return 'meio';
}

const ROTULO_PORTAO = { 0: 'violação clara', 1: 'suspeita ou desvio pequeno', 2: 'conforme' };

function textoDoPortao(r) {
  return `NOTA: ${r.nota} (${ROTULO_PORTAO[r.nota] || '?'})\n\n${r.analise}`;
}

function montarAnalises(criterios, resultadosPorNumero) {
  const nove = criterios.filter((c) => !c.portao);
  if (!nove.some((c) => resultadosPorNumero[c.numero])) {
    return '(Os critérios de qualidade não foram avaliados: o texto não passou nas regras do edital.)';
  }
  return nove.map((c) => {
    const r = resultadosPorNumero[c.numero];
    return `## ${c.numero}. ${c.nome}\n${c.linhaCurta}\nNOTA: ${r.nota}/${NOTA_MAX}\n\nANÁLISE: ${r.analise}${r.faltou ? `\n\nFALTOU: ${r.faltou}` : ''}`;
  }).join('\n\n');
}

function montarPromptSintetizador(template, { edital, texto, portao, criterios, resultadosPorNumero }) {
  return semBreakpoints(preencher(template, {
    EDITAL: materialDoEdital(edital),
    TEXTO: texto,
    PORTAO: textoDoPortao(portao),
    ANALISES: montarAnalises(criterios, resultadosPorNumero),
  }));
}

// ---------------------------------------------------------------------------
// Modo demonstração: saídas fictícias, determinísticas pelo texto.
// ---------------------------------------------------------------------------

function hashSimples(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function saidaDemonstracao(chave, texto) {
  if (chave === `c${PORTAO}`) {
    // Para testar o caminho de eliminação: escreva [[elimina]] no texto; [[alerta]] dá nota 1.
    if (texto.includes('[[elimina]]')) return 'ANÁLISE: (modo demonstração) Regra disparada: referências inventadas que se denunciam no próprio texto.\nNOTA: 0';
    if (texto.includes('[[alerta]]')) return 'ANÁLISE: (modo demonstração) Regra disparada: tamanho um pouco acima do limite do edital.\nNOTA: 1';
    return 'ANÁLISE: (modo demonstração) Nenhuma violação encontrada.\nNOTA: 2';
  }
  const h = hashSimples(`${chave}:${texto.length}:${texto.slice(0, 200)}`);
  const nota = [1, 1, 2, 2, 2, 3, 3, 4][h % 8];
  return `ANÁLISE: (modo demonstração) Análise simulada do critério ${chave.slice(1)}, com "um trecho" do texto.\nFALTOU: (modo demonstração) o que faltou para o nível seguinte.\nNOTA: ${nota}`;
}

function sinteseDemonstracao(eliminado) {
  if (eliminado) {
    return [
      '**Pontos de atenção**',
      '(modo demonstração) Feedback simulado: o texto não passou nas regras do edital, e os critérios de qualidade não foram avaliados.',
    ].join('\n');
  }
  return [
    '**Sobre o seu texto**',
    '(modo demonstração) Este é um feedback simulado: sem a chave da OpenAI, o sistema gera textos fictícios para você navegar o fluxo inteiro.',
    '',
    '**O que funciona**',
    'O texto tem uma pergunta clara e uma estrutura que ajuda a leitura.',
    '',
    '**O que desenvolver**',
    'A discussão final pode dialogar mais com as referências citadas, e algumas afirmações pedem fonte.',
  ].join('\n');
}

module.exports = {
  SLOTS,
  SLOT_IDS,
  TOTAL_CRITERIOS,
  PORTAO,
  NOTA_MAX,
  NOTA_MAX_PORTAO,
  TERCOS,
  TOTAL_MAX,
  MAX_TOKENS,
  parseCriterios,
  validarSlot,
  preencher,
  materialDoEdital,
  montarDeveloper,
  requisicoesDaFase,
  corpoChat,
  parseSaidaCriterio,
  agregar,
  faixasDoLote,
  faixa,
  ROTULO_PORTAO,
  textoDoPortao,
  montarAnalises,
  montarPromptSintetizador,
  saidaDemonstracao,
  sinteseDemonstracao,
};
