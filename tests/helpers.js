// Sobe o app num banco em memória, com envs de teste, sem IA (modo demonstração).
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.ADMIN_INITIAL_PASSWORD = 'Senha-admin#2026';
process.env.OPENAI_API_KEY = '';
delete process.env.DATA_DIR;

const request = require('supertest');
const { app } = require('../server/index');
const avaliacao = require('../server/avaliacao');
const pipeline = require('../server/pipeline');

// Prompts: os de .prompts/ quando existem; senão, mínimos válidos.
function promptsDeTeste() {
  const dir = path.join(__dirname, '..', '.prompts');
  const out = {};
  for (const slot of pipeline.SLOT_IDS) {
    const f = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => x === `${slot}.md` || x.startsWith(`${slot}-`));
    if (f) { out[slot] = fs.readFileSync(path.join(dir, f), 'utf-8'); continue; }
    const base = `Prompt de teste do slot ${slot}. `.repeat(4);
    if (slot === 'regua') out[slot] = `${base}\nANÁLISE: …\nFALTOU: …\nNOTA: 0 a 5`;
    else if (slot === 'regua_portao') out[slot] = `${base}\nANÁLISE: …\nNOTA: 0, 1 ou 2`;
    else if (slot === 'sintetizador') out[slot] = `${base}\n{{PORTAO}}\n{{ANALISES}}`;
    else if (slot === 'criterios') {
      out[slot] = Array.from({ length: 10 }, (_, i) => `## ${i + 1}. C${i + 1}\n\n**C${i + 1}.** Mede ${i + 1}.\n\n${'Texto do bloco. '.repeat(8)}\n`).join('\n');
    } else out[slot] = base;
  }
  return out;
}

const api = () => request(app);
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

async function loginAdmin() {
  const r = await api().post('/api/auth/login').send({ login: 'admin', senha: process.env.ADMIN_INITIAL_PASSWORD });
  if (r.status !== 200) throw new Error(`login admin: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

async function subirPrompts(tokenAdmin) {
  for (const [slot, conteudo] of Object.entries(promptsDeTeste())) {
    const r = await api().put(`/api/admin/prompts/${slot}`).set(bearer(tokenAdmin)).send({ conteudo });
    if (r.status !== 200) throw new Error(`prompt ${slot}: ${JSON.stringify(r.body)}`);
  }
}

function textoDeTeste(extra = '') {
  return `Título do ensaio de teste\n\n${'Esta é uma frase do texto submetido para avaliação. '.repeat(40)}\n\n${extra}`;
}

module.exports = { app, api, bearer, avaliacao, loginAdmin, subirPrompts, textoDeTeste };
