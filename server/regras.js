// Regras do domínio em funções puras (sem I/O): senha, editais, status da
// submissão e tratamento do texto. Testadas em tests/regras.test.js.

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

const SIMBOLOS_SENHA = '!@#$%&*-';

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Pedaços de "nome de usuário" que a senha não pode conter. Não há campo de
// usuário no cadastro: a pessoa é identificada pelo e-mail e pelo nome, então
// valem a parte local do e-mail e cada palavra do nome/sobrenome (3+ letras).
function identificadoresDoUsuario({ email, nome, sobrenome } = {}) {
  const ids = new Set();
  const local = semAcento(String(email || '').split('@')[0]);
  if (local.length >= 3) ids.add(local);
  for (const parte of semAcento(`${nome || ''} ${sobrenome || ''}`).split(/[^a-z0-9]+/)) {
    if (parte.length >= 3) ids.add(parte);
  }
  return [...ids];
}

// Devolve a lista de regras com `ok` para cada uma. A tela usa a mesma lista
// para o checklist ao vivo (client/src/lib/senha.js espelha isto).
function checarSenha(senha, usuario = {}) {
  const s = String(senha || '');
  const normal = semAcento(s);
  const contemUsuario = identificadoresDoUsuario(usuario).some((id) => normal.includes(id));
  return [
    { id: 'tamanho', texto: 'Pelo menos 8 caracteres', ok: s.length >= 8 },
    { id: 'letra', texto: 'Pelo menos 1 letra', ok: /\p{L}/u.test(s) },
    { id: 'numero', texto: 'Pelo menos 1 número', ok: /\d/.test(s) },
    { id: 'simbolo', texto: 'Pelo menos 1 símbolo (! @ # $ % & * -)', ok: [...s].some((c) => SIMBOLOS_SENHA.includes(c)) },
    { id: 'usuario', texto: 'Não pode conter seu nome de usuário', ok: s.length > 0 && !contemUsuario },
  ];
}

function erroDeSenha(senha, usuario) {
  const falha = checarSenha(senha, usuario).find((r) => !r.ok);
  return falha ? `Senha: ${falha.texto.toLowerCase()}.` : null;
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function emailValido(email) {
  const e = String(email || '').trim();
  return e.length <= 254 && RE_EMAIL.test(e);
}

// ---------------------------------------------------------------------------
// Editais
// ---------------------------------------------------------------------------

function slugify(texto) {
  return semAcento(texto)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'edital';
}

function instante(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// Situação do edital agora. É calculada, nunca gravada: o prazo vira sozinho.
//   rascunho   → não publicado (só o admin vê)
//   arquivado  → passou do "visível até": sai da home
//   em_breve   → publicado, antes de abrir
//   abertas    → inscrições e envio de texto liberados
//   encerradas → passou do prazo, ou o admin fechou na chave manual
function situacaoEdital(e, agora = Date.now()) {
  if (!e || !e.publicado) return 'rascunho';
  const visivelAte = instante(e.visivel_ate);
  if (visivelAte !== null && agora > visivelAte) return 'arquivado';
  const abre = instante(e.abre_em);
  if (abre !== null && agora < abre) return 'em_breve';
  if (!e.inscricoes_abertas) return 'encerradas';
  const fecha = instante(e.fecha_em);
  if (fecha !== null && agora > fecha) return 'encerradas';
  return 'abertas';
}

const SITUACAO_EDITAL_ROTULO = {
  rascunho: 'Rascunho',
  arquivado: 'Fora do ar',
  em_breve: 'Em breve',
  abertas: 'Inscrições abertas',
  encerradas: 'Inscrições encerradas',
};

// Valida e normaliza o corpo do formulário do edital. Devolve { dados } ou { erro }.
function validarEdital(b = {}) {
  const titulo = String(b.titulo || '').trim().slice(0, 200);
  if (titulo.length < 4) return { erro: 'Informe o título do edital.' };
  const datas = {};
  for (const k of ['abre_em', 'fecha_em', 'visivel_ate']) {
    const v = b[k];
    if (v === null || v === undefined || v === '') { datas[k] = null; continue; }
    const t = instante(v);
    if (t === null) return { erro: `Data inválida em "${k}".` };
    datas[k] = new Date(t).toISOString();
  }
  if (datas.abre_em && datas.fecha_em && datas.fecha_em <= datas.abre_em) {
    return { erro: 'O prazo de encerramento precisa ser depois da abertura.' };
  }
  const inteiro = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  };
  const palavrasMin = inteiro(b.palavras_min);
  const palavrasMax = inteiro(b.palavras_max);
  if (Number.isNaN(palavrasMin) || Number.isNaN(palavrasMax)) return { erro: 'Limites de palavras precisam ser números positivos.' };
  if (palavrasMin && palavrasMax && palavrasMax < palavrasMin) return { erro: 'O máximo de palavras é menor que o mínimo.' };
  // Só os textos abaixo dele recebem a sugestão "descartar". Vazio = sem
  // descarte automático (o guia manda calibrar no primeiro lote real).
  let limiarDescarte = null;
  if (b.limiar_descarte !== undefined && b.limiar_descarte !== null && b.limiar_descarte !== '') {
    limiarDescarte = Number(b.limiar_descarte);
    if (!Number.isInteger(limiarDescarte) || limiarDescarte < 0 || limiarDescarte > 45) return { erro: 'O limiar de descarte é um número inteiro de 0 a 45.' };
  }
  const slug = b.slug ? slugify(b.slug) : slugify(titulo);
  return {
    dados: {
      titulo,
      slug,
      revista: String(b.revista || '').trim().slice(0, 200),
      chamada: String(b.chamada || '').trim().slice(0, 600),
      corpo: String(b.corpo || '').replace(/\r\n/g, '\n').slice(0, 100000),
      resumo_ia: String(b.resumo_ia || '').replace(/\r\n/g, '\n').slice(0, 30000),
      palavras_min: palavrasMin,
      palavras_max: palavrasMax,
      limiar_descarte: limiarDescarte,
      publicado: !!b.publicado,
      inscricoes_abertas: b.inscricoes_abertas === undefined ? true : !!b.inscricoes_abertas,
      ...datas,
    },
  };
}

// ---------------------------------------------------------------------------
// Submissões
// ---------------------------------------------------------------------------

// Status internos (coluna submissoes.status).
const STATUS = [
  'inscrito',              // inscrita no edital, sem texto
  'enviado',               // texto enviado, aguardando a avaliação começar
  'em_avaliacao',          // pipeline rodando (lote na OpenAI)
  'avaliado',              // IA terminou; espera o admin decidir
  'reprovado',             // final
  'aprovado',              // feedback liberado; espera a revisão do admin
  'aguardando_correcoes',  // rodada de revisão enviada ao autor
  'correcoes_enviadas',    // autor respondeu; admin confere
  'em_diagramacao',
  'aguardando_publicacao',
  'publicado',
];

// O que o AUTOR vê. "avaliado" continua aparecendo como "em avaliação": a
// decisão só existe depois que o admin confere.
function statusPublico(status) {
  if (status === 'inscrito') return 'nenhum_texto';
  if (status === 'avaliado') return 'em_avaliacao';
  return status;
}

const STATUS_PUBLICO_ROTULO = {
  nenhum_texto: 'Nenhum texto enviado',
  enviado: 'Texto enviado, aguardando avaliação',
  em_avaliacao: 'Texto em avaliação',
  aprovado: 'Texto aprovado',
  reprovado: 'Texto reprovado',
  aguardando_correcoes: 'Aguardando suas correções',
  correcoes_enviadas: 'Correções enviadas, em conferência',
  em_diagramacao: 'Texto em diagramação',
  aguardando_publicacao: 'Aguardando publicação',
  publicado: 'Texto publicado',
};

const STATUS_ADMIN_ROTULO = {
  inscrito: 'Inscrito, sem texto',
  enviado: 'Na fila da avaliação',
  em_avaliacao: 'Em avaliação (IA)',
  avaliado: 'Aguardando decisão',
  reprovado: 'Reprovado',
  aprovado: 'Aprovado · aguardando revisão',
  aguardando_correcoes: 'Com o autor (correções)',
  correcoes_enviadas: 'Correções recebidas',
  em_diagramacao: 'Em diagramação',
  aguardando_publicacao: 'Aguardando publicação',
  publicado: 'Publicado',
};

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const LIMITE_BYTES_TEXTO = 400 * 1024;   // ~60 mil palavras: folga para qualquer artigo
const MIN_PALAVRAS_ABSOLUTO = 50;

function normalizarTexto(t) {
  return String(t || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function contarPalavras(t) {
  const m = String(t || '').match(/\S+/g);
  return m ? m.length : 0;
}

// Título para as listas do admin: a primeira linha não vazia, encurtada.
function tituloDoTexto(t) {
  const linha = String(t || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return linha.length > 120 ? `${linha.slice(0, 117)}…` : linha;
}

// Valida o texto enviado (arquivo .txt lido pelo navegador). { texto, palavras } ou { erro }.
function validarTextoEnviado({ conteudo, nomeArquivo }) {
  const nome = String(nomeArquivo || '').trim();
  if (nome && !/\.txt$/i.test(nome)) return { erro: 'O arquivo precisa ser .txt.' };
  const bruto = String(conteudo || '');
  if (Buffer.byteLength(bruto, 'utf-8') > LIMITE_BYTES_TEXTO) return { erro: 'O arquivo é grande demais (limite de 400 KB).' };
  if (bruto.includes('\u0000')) return { erro: 'Este arquivo não parece ser texto puro (.txt).' };
  const texto = normalizarTexto(bruto);
  const palavras = contarPalavras(texto);
  if (palavras < MIN_PALAVRAS_ABSOLUTO) return { erro: `O texto está curto demais (${palavras} palavras).` };
  return { texto, palavras };
}

module.exports = {
  SIMBOLOS_SENHA,
  checarSenha,
  erroDeSenha,
  identificadoresDoUsuario,
  emailValido,
  slugify,
  situacaoEdital,
  SITUACAO_EDITAL_ROTULO,
  validarEdital,
  STATUS,
  statusPublico,
  STATUS_PUBLICO_ROTULO,
  STATUS_ADMIN_ROTULO,
  normalizarTexto,
  contarPalavras,
  tituloDoTexto,
  validarTextoEnviado,
  LIMITE_BYTES_TEXTO,
};
