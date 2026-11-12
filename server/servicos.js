// Operações compartilhadas pelas rotas: eventos, caixa de saída de e-mail,
// registro de erros e as "visões" (o que cada papel pode ver de uma submissão).
const { q, agoraISO, json } = require('./db');
const pipeline = require('./pipeline');
const regras = require('./regras');
const email = require('./email');
const errorLog = require('./error-log');

// ---------------------------------------------------------------------------
// Erros: o usuário recebe mensagem genérica + código; o detalhe fica no banco.
// ---------------------------------------------------------------------------

function clientIp(req) {
  const cf = req && req.headers && req.headers['cf-connecting-ip'];
  const raw = (typeof cf === 'string' && cf.trim()) ? cf.trim() : ((req && req.ip) || '');
  return raw.startsWith('::ffff:') && raw.includes('.') ? raw.slice(7) : raw;
}

function registrarErro(req, err, onde, { status = 500, extra = null } = {}) {
  let entry;
  try {
    entry = errorLog.buildErrorEntry({ err, req, where: onde, status, extra, ip: req ? clientIp(req) : null });
    if (req && req.user) entry.actor = { id: req.user.id, username: req.user.email || req.user.username, role: req.user.papel };
    const { id, timestamp, where, message, ...resto } = entry;
    q.run('INSERT INTO erros (id, em, onde, mensagem, dados) VALUES (?, ?, ?, ?, ?)', id, timestamp, where, message, JSON.stringify(resto));
    q.run("DELETE FROM erros WHERE em < ?", new Date(Date.now() - errorLog.TTL_DAYS * 864e5).toISOString());
  } catch (e) {
    console.error('[erros] não consegui registrar:', e && e.message);
    if (!entry) return errorLog.newErrorId();
  }
  console.error(`[${entry.where}] ${entry.id}:`, (err && err.message) || err);
  return entry.id;
}

function falhou(req, err, onde, { status = 500, message } = {}) {
  return errorLog.userFacingError(registrarErro(req, err, onde, { status }), message);
}

// ---------------------------------------------------------------------------
// Eventos (linha do tempo da submissão)
// ---------------------------------------------------------------------------

function evento(submissaoId, tipo, detalhe = null, por = 'sistema') {
  q.run('INSERT INTO eventos (submissao_id, tipo, detalhe, por) VALUES (?, ?, ?, ?)', submissaoId, tipo, detalhe, por);
}

const quem = (user) => (user ? (user.username || user.email || `#${user.id}`) : 'sistema');

// ---------------------------------------------------------------------------
// E-mail: grava na caixa de saída (dentro da transação de quem pede) e
// despacha depois, fora dela. Assim o e-mail só existe se a mudança existiu.
// ---------------------------------------------------------------------------

function enfileirarEmail({ tipo, para, mensagem, submissaoId = null }) {
  const r = q.run(
    "INSERT INTO emails (tipo, para, assunto, html, texto, submissao_id, estado) VALUES (?, ?, ?, ?, ?, ?, 'pendente')",
    tipo, para, mensagem.assunto, mensagem.html, mensagem.texto, submissaoId,
  );
  return Number(r.lastInsertRowid);
}

let despachando = false;
async function despacharEmails() {
  if (despachando) return;
  despachando = true;
  try {
    for (const m of q.all("SELECT * FROM emails WHERE estado = 'pendente' ORDER BY id LIMIT 50")) {
      const r = await email.enviarEmail({ to: m.para, subject: m.assunto, html: m.html });
      if (r.ok) {
        q.run("UPDATE emails SET estado = 'enviado', enviado_em = ?, erro = NULL, tentativas = tentativas + 1 WHERE id = ?", agoraISO(), m.id);
      } else if (r.naoConfigurado) {
        q.run("UPDATE emails SET estado = 'nao_configurado', tentativas = tentativas + 1 WHERE id = ?", m.id);
        console.warn(`[email] NÃO CONFIGURADO — registrado em Admin → E-mails: "${m.assunto}" → ${m.para}`);
      } else {
        q.run("UPDATE emails SET estado = 'falhou', erro = ?, tentativas = tentativas + 1 WHERE id = ?", String(r.erro).slice(0, 500), m.id);
        registrarErro(null, new Error(r.erro), 'email/envio', { extra: { emailId: m.id, tipo: m.tipo } });
      }
    }
  } finally {
    despachando = false;
  }
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

function editalPublico(e) {
  if (!e) return null;
  return {
    id: e.id,
    slug: e.slug,
    titulo: e.titulo,
    revista: e.revista,
    chamada: e.chamada,
    corpo: e.corpo,
    palavrasMin: e.palavras_min,
    palavrasMax: e.palavras_max,
    abreEm: e.abre_em,
    fechaEm: e.fecha_em,
    situacao: regras.situacaoEdital(e),
  };
}

function nomeCompleto(u) {
  return u ? `${u.nome}${u.sobrenome ? ` ${u.sobrenome}` : ''}` : 'Conta excluída';
}

// A rodada que está com o autor agora (enviada e ainda não respondida).
function rodadaAberta(submissaoId) {
  return q.get("SELECT * FROM rodadas WHERE submissao_id = ? AND status = 'enviada' ORDER BY numero DESC LIMIT 1", submissaoId);
}

// O que o AUTOR vê da própria submissão.
function visaoAutor(s) {
  const edital = q.get('SELECT * FROM editais WHERE id = ?', s.edital_id);
  const versao = s.versao_atual_id ? q.get('SELECT id, numero, nome_arquivo, palavras, criado_em FROM versoes WHERE id = ?', s.versao_atual_id) : null;
  const status = regras.statusPublico(s.status);
  const situacaoEdital = regras.situacaoEdital(edital);
  const decidido = !!s.decisao;
  return {
    id: s.id,
    edital: editalPublico(edital),
    status,
    rotulo: regras.STATUS_PUBLICO_ROTULO[status] || status,
    podeEnviarTexto: s.status === 'inscrito' && situacaoEdital === 'abertas',
    enviadoEm: s.enviado_em,
    versao,
    decisao: decidido ? s.decisao : null,
    decisaoEm: decidido ? s.decisao_em : null,
    feedback: decidido ? s.feedback_final : null,
    observacoes: decidido && s.decisao === 'aprovado' ? (s.observacoes_decisao || null) : null,
    correcaoPendente: s.status === 'aguardando_correcoes' && !!rodadaAberta(s.id),
    linkPublicacao: s.status === 'publicado' ? s.link_publicacao : null,
    criadoEm: s.criado_em,
  };
}

// Limites de "topo" e "base" do lote: textos avaliados (e não eliminados) do
// mesmo edital, pela última avaliação de cada um. Cor por posição, como pede o
// guia: com texto de aluno, uma escala fixa deixaria quase tudo vermelho.
function limitesDoLote(editalId) {
  const linhas = q.all(`
    SELECT a.nota_final, a.subtotais FROM avaliacoes a
    JOIN (SELECT submissao_id, MAX(id) AS id FROM avaliacoes WHERE status = 'concluida' GROUP BY submissao_id) u ON u.id = a.id
    JOIN submissoes s ON s.id = a.submissao_id
    WHERE s.edital_id = ? AND a.eliminado = 0`, editalId);
  const subs = linhas.map((l) => json(l.subtotais, {}));
  const out = { total: pipeline.faixasDoLote(linhas.map((l) => l.nota_final)), n: linhas.length };
  for (const t of pipeline.TERCOS) out[t.id] = pipeline.faixasDoLote(subs.map((x) => x[t.id]));
  return out;
}

function pontuacao(av, limites) {
  if (!av || av.status !== 'concluida') return null;
  const subtotais = json(av.subtotais);
  return {
    total: av.nota_final,
    totalMax: pipeline.TOTAL_MAX,
    faixaTotal: limites ? pipeline.faixa(av.nota_final, limites.total) : null,
    tercos: subtotais ? pipeline.TERCOS.map((t) => ({
      id: t.id, nome: t.nome, valor: subtotais[t.id], max: t.criterios.length * pipeline.NOTA_MAX,
      faixa: limites ? pipeline.faixa(subtotais[t.id], limites[t.id]) : null,
    })) : null,
    portao: av.portao_nota,
    eliminado: !!av.eliminado,
    conferirRegra: av.portao_nota === 1,
    sugestao: av.sugestao,
    loteN: limites ? limites.n : null,
  };
}

// Linha da lista do admin. `cacheLimites` evita recalcular o lote por linha.
function resumoAdmin(s, cacheLimites = new Map()) {
  const autor = q.get('SELECT * FROM usuarios WHERE id = ?', s.autor_id);
  const edital = q.get('SELECT id, titulo, slug FROM editais WHERE id = ?', s.edital_id);
  const versao = s.versao_atual_id ? q.get('SELECT numero, palavras, conteudo FROM versoes WHERE id = ?', s.versao_atual_id) : null;
  const av = q.get('SELECT * FROM avaliacoes WHERE submissao_id = ? ORDER BY id DESC LIMIT 1', s.id);
  if (!cacheLimites.has(s.edital_id)) cacheLimites.set(s.edital_id, limitesDoLote(s.edital_id));
  return {
    id: s.id,
    status: s.status,
    rotulo: regras.STATUS_ADMIN_ROTULO[s.status] || s.status,
    autor: autor ? { id: autor.id, nome: nomeCompleto(autor), email: autor.email } : null,
    edital,
    titulo: versao ? regras.tituloDoTexto(versao.conteudo) : null,
    palavras: versao ? versao.palavras : null,
    versao: versao ? versao.numero : null,
    avaliacao: av ? { status: av.status, fase: av.fase, erro: av.erro, pontuacao: pontuacao(av, cacheLimites.get(s.edital_id)) } : null,
    enviadoEm: s.enviado_em,
    atualizadoEm: s.atualizado_em,
  };
}

function avaliacaoAdmin(av, limites = null) {
  if (!av) return null;
  return {
    id: av.id,
    status: av.status,
    modo: av.modo,
    modelo: av.modelo,
    batchId: av.batch_id,
    versaoId: av.versao_id,
    fase: av.fase,
    portao: json(av.triagem),
    criterios: json(av.criterios, []),
    pontuacao: pontuacao(av, limites),
    feedbackIA: av.feedback_ia,
    uso: json(av.uso),
    erro: av.erro,
    tentativas: av.tentativas,
    criadoEm: av.criado_em,
    submetidoEm: av.submetido_em,
    concluidoEm: av.concluido_em,
  };
}

function rodadaAdmin(r) {
  if (!r) return null;
  return {
    id: r.id,
    numero: r.numero,
    status: r.status,
    versaoId: r.versao_id,
    anotacoes: json(r.anotacoes, []),
    observacoesAdmin: r.observacoes_admin,
    enviadaEm: r.enviada_em,
    respostaVersaoId: r.resposta_versao_id,
    anotacoesResposta: json(r.anotacoes_resposta),
    observacoesAutor: r.observacoes_autor,
    respondidaEm: r.respondida_em,
  };
}

module.exports = {
  clientIp,
  registrarErro,
  falhou,
  evento,
  quem,
  enfileirarEmail,
  despacharEmails,
  editalPublico,
  nomeCompleto,
  rodadaAberta,
  visaoAutor,
  resumoAdmin,
  avaliacaoAdmin,
  limitesDoLote,
  rodadaAdmin,
};
