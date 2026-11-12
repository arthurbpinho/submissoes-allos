// Banco SQLite (node:sqlite, nativo do Node ≥ 22.5 — sem dependência nativa
// para compilar, o que importa com o `ignore-scripts=true` do .npmrc).
//
// Por que SQLite e não os JSON do all_OS: transação de verdade (uma mudança de
// status e o e-mail que ela gera entram juntos ou não entram), consulta sem
// carregar tudo na memória e um arquivo só no volume. Continua sendo UMA
// instância: o SQLite aguenta bem um processo escrevendo, não vários servidores.
//
// A API do node:sqlite é síncrona. Como o Node roda o JS numa thread só, um
// bloco `tx(() => …)` sem await dentro é atômico em relação às outras requests.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let db = null;

const AGORA_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// Cada entrada roda uma vez, em ordem, e fica registrada em `schema_versao`.
// Mudança de esquema = nova entrada no fim. Nunca editar uma que já rodou.
const MIGRACOES = [
  `
  CREATE TABLE usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT, -- AUTOINCREMENT: id nunca é reaproveitado
    papel         TEXT NOT NULL CHECK (papel IN ('admin', 'autor')),
    nome          TEXT NOT NULL,
    sobrenome     TEXT NOT NULL DEFAULT '',
    email         TEXT UNIQUE COLLATE NOCASE,
    username      TEXT UNIQUE COLLATE NOCASE,
    curso         TEXT,
    faculdade     TEXT,
    periodo       TEXT,
    senha_hash    TEXT NOT NULL,
    token_versao  INTEGER NOT NULL DEFAULT 0,
    consentimento_em     TEXT,
    consentimento_versao TEXT,
    criado_em     TEXT NOT NULL DEFAULT (${AGORA_SQL})
  );

  CREATE TABLE editais (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slug             TEXT NOT NULL UNIQUE,
    titulo           TEXT NOT NULL,
    revista          TEXT NOT NULL DEFAULT '',
    chamada          TEXT NOT NULL DEFAULT '',      -- uma ou duas frases para o card da home
    corpo            TEXT NOT NULL DEFAULT '',      -- o edital completo (markdown simples)
    resumo_ia        TEXT NOT NULL DEFAULT '',      -- o "resumo do edital" que entra no pipeline
    palavras_min     INTEGER,
    palavras_max     INTEGER,
    nota_corte       REAL NOT NULL DEFAULT 7,
    publicado        INTEGER NOT NULL DEFAULT 0,    -- aparece na home
    inscricoes_abertas INTEGER NOT NULL DEFAULT 1,  -- chave manual: pausa/fecha antes do prazo
    abre_em          TEXT,                          -- ISO; nulo = já aberto
    fecha_em         TEXT,                          -- ISO; nulo = sem prazo
    visivel_ate      TEXT,                          -- ISO; depois disso sai da home
    criado_em        TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    atualizado_em    TEXT NOT NULL DEFAULT (${AGORA_SQL})
  );

  CREATE TABLE submissoes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    edital_id        INTEGER NOT NULL REFERENCES editais(id),
    autor_id         INTEGER NOT NULL REFERENCES usuarios(id),
    status           TEXT NOT NULL,
    versao_atual_id  INTEGER,
    enviado_em       TEXT,
    decisao          TEXT CHECK (decisao IN ('aprovado', 'reprovado')),
    decisao_em       TEXT,
    decisao_por      INTEGER,
    feedback_final   TEXT,      -- o que o autor lê (IA + edições do admin)
    observacoes_decisao TEXT,   -- pedidos de correção que vão junto no e-mail de aprovação
    link_publicacao  TEXT,
    publicado_em     TEXT,
    criado_em        TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    atualizado_em    TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    UNIQUE (edital_id, autor_id)
  );
  CREATE INDEX idx_submissoes_status ON submissoes(status);

  -- Cada texto enviado (o original e cada correção) é uma versão imutável.
  CREATE TABLE versoes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    submissao_id  INTEGER NOT NULL REFERENCES submissoes(id),
    numero        INTEGER NOT NULL,
    conteudo      TEXT NOT NULL,
    nome_arquivo  TEXT,
    palavras      INTEGER NOT NULL,
    origem        TEXT NOT NULL CHECK (origem IN ('envio', 'correcao')),
    consentimento_em TEXT NOT NULL,
    criado_em     TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    UNIQUE (submissao_id, numero)
  );

  -- Uma linha por execução do pipeline sobre uma versão.
  CREATE TABLE avaliacoes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    submissao_id  INTEGER NOT NULL REFERENCES submissoes(id),
    versao_id     INTEGER NOT NULL REFERENCES versoes(id),
    status        TEXT NOT NULL CHECK (status IN ('na_fila', 'em_lote', 'executando', 'concluida', 'erro')),
    modo          TEXT NOT NULL,
    modelo        TEXT,
    batch_id      TEXT,
    prompts       TEXT,       -- JSON: id da versão de cada prompt usada
    triagem       TEXT,       -- JSON
    criterios     TEXT,       -- JSON: [{numero, nome, peso, nota, analise, tentativas}]
    nota_final    REAL,
    eliminado     INTEGER,
    sugestao      TEXT,       -- 'aprovar' | 'reprovar'
    feedback_ia   TEXT,
    uso           TEXT,       -- JSON: tokens somados
    erro          TEXT,
    tentativas    INTEGER NOT NULL DEFAULT 0,
    criado_em     TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    submetido_em  TEXT,
    concluido_em  TEXT
  );
  CREATE INDEX idx_avaliacoes_status ON avaliacoes(status);
  CREATE INDEX idx_avaliacoes_submissao ON avaliacoes(submissao_id);

  -- Rodadas de revisão: o admin anota uma versão, o autor responde com outra.
  CREATE TABLE rodadas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    submissao_id    INTEGER NOT NULL REFERENCES submissoes(id),
    numero          INTEGER NOT NULL,
    versao_id       INTEGER NOT NULL REFERENCES versoes(id),   -- a versão anotada
    status          TEXT NOT NULL CHECK (status IN ('rascunho', 'enviada', 'respondida', 'encerrada')),
    anotacoes       TEXT NOT NULL DEFAULT '[]',                -- JSON
    observacoes_admin TEXT NOT NULL DEFAULT '',
    enviada_em      TEXT,
    enviada_por     INTEGER,
    resposta_versao_id INTEGER REFERENCES versoes(id),
    anotacoes_resposta TEXT,      -- JSON: as anotações reposicionadas no texto corrigido + respostas
    observacoes_autor TEXT,
    respondida_em   TEXT,
    criado_em       TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    UNIQUE (submissao_id, numero)
  );

  -- Prompts do pipeline, com histórico: o ativo é o mais recente de cada slot.
  CREATE TABLE prompts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slot          TEXT NOT NULL,
    conteudo      TEXT NOT NULL,
    nome_arquivo  TEXT,
    por           TEXT,
    criado_em     TEXT NOT NULL DEFAULT (${AGORA_SQL})
  );
  CREATE INDEX idx_prompts_slot ON prompts(slot, id);

  -- Caixa de saída: todo e-mail fica registrado, enviado ou não.
  CREATE TABLE emails (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo          TEXT NOT NULL,
    para          TEXT NOT NULL,
    assunto       TEXT NOT NULL,
    html          TEXT NOT NULL,
    texto         TEXT NOT NULL,
    submissao_id  INTEGER,
    estado        TEXT NOT NULL CHECK (estado IN ('pendente', 'enviado', 'falhou', 'nao_configurado')),
    erro          TEXT,
    tentativas    INTEGER NOT NULL DEFAULT 0,
    criado_em     TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    enviado_em    TEXT
  );

  -- Linha do tempo de cada submissão (auditoria e tela do admin).
  CREATE TABLE eventos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    submissao_id  INTEGER NOT NULL,
    tipo          TEXT NOT NULL,
    detalhe       TEXT,
    por           TEXT,
    em            TEXT NOT NULL DEFAULT (${AGORA_SQL})
  );
  CREATE INDEX idx_eventos_submissao ON eventos(submissao_id);

  -- Lotes da Batch API ainda em voo.
  CREATE TABLE lotes (
    batch_id      TEXT PRIMARY KEY,
    modelo        TEXT NOT NULL,
    requisicoes   INTEGER NOT NULL,
    status        TEXT NOT NULL,
    erro          TEXT,
    criado_em     TEXT NOT NULL DEFAULT (${AGORA_SQL}),
    finalizado_em TEXT
  );

  CREATE TABLE erros (
    id            TEXT PRIMARY KEY,
    em            TEXT NOT NULL,
    onde          TEXT NOT NULL,
    mensagem      TEXT,
    dados         TEXT          -- JSON com o resto da entrada
  );
  `,
  // 2 · Critérios do "Avaliador da revista": portão (critério 10) em fase
  // própria, régua 0–5, total 0–45 em três terços. A coluna avaliacoes.triagem
  // passa a guardar a saída do portão; nota_final, o total (0–45).
  `
  ALTER TABLE avaliacoes ADD COLUMN fase TEXT NOT NULL DEFAULT 'portao';
  ALTER TABLE avaliacoes ADD COLUMN portao_nota INTEGER;
  ALTER TABLE avaliacoes ADD COLUMN subtotais TEXT;
  ALTER TABLE editais ADD COLUMN limiar_descarte INTEGER;
  `,
];

// node:sqlite não aceita boolean nem undefined como parâmetro.
function normalizar(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
function normalizarParams(params) {
  return params.map((p) => {
    if (p && typeof p === 'object' && !Array.isArray(p) && !(p instanceof Uint8Array)) {
      const o = {};
      for (const [k, v] of Object.entries(p)) o[k] = normalizar(v);
      return o;
    }
    return normalizar(p);
  });
}

// Linhas do node:sqlite vêm com protótipo nulo; o resto do código espera objeto comum.
const comum = (r) => (r ? { ...r } : r);

const cacheStmt = new Map();
function stmt(sql) {
  let s = cacheStmt.get(sql);
  if (!s) { s = db.prepare(sql); cacheStmt.set(sql, s); }
  return s;
}

function abrir(arquivo) {
  if (db) return db;
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  db = new DatabaseSync(arquivo);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_versao (versao INTEGER NOT NULL)');
  const atual = (db.prepare('SELECT MAX(versao) AS v FROM schema_versao').get() || {}).v || 0;
  for (let i = atual; i < MIGRACOES.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRACOES[i]);
      db.prepare('INSERT INTO schema_versao (versao) VALUES (?)').run(i + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

function fechar() {
  if (db) { db.close(); db = null; cacheStmt.clear(); }
}

const q = {
  get: (sql, ...p) => comum(stmt(sql).get(...normalizarParams(p))),
  all: (sql, ...p) => stmt(sql).all(...normalizarParams(p)).map(comum),
  run: (sql, ...p) => stmt(sql).run(...normalizarParams(p)),
};

let emTx = false;
// Transação síncrona. Aninhar reaproveita a de fora.
function tx(fn) {
  if (emTx) return fn();
  emTx = true;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('tx() não aceita função assíncrona');
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já desfeita */ }
    throw e;
  } finally {
    emTx = false;
  }
}

const agoraISO = () => new Date().toISOString();

function json(texto, padrao = null) {
  if (texto == null || texto === '') return padrao;
  try { return JSON.parse(texto); } catch { return padrao; }
}

module.exports = { abrir, fechar, q, tx, agoraISO, json };
