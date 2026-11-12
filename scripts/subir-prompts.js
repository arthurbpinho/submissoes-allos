#!/usr/bin/env node
// Sobe os prompts de .prompts/ para uma instância no ar, pelo mesmo caminho do
// painel (Admin → Prompts): login de admin + PUT /api/admin/prompts/:slot.
// Os prompts nunca vão para o git; este script só lê os arquivos locais.
//
//   ADMIN_SENHA='…' node scripts/subir-prompts.js https://submissao.allos.org.br
//
// Usuário: ADMIN_USUARIO (padrão "admin"). Cada envio vira uma versão nova no
// banco; arquivo igual ao que já está lá não cria versão.
const fs = require('fs');
const path = require('path');
const { SLOT_IDS } = require('../server/pipeline');

async function main() {
  const base = String(process.argv[2] || '').replace(/\/+$/, '');
  const usuario = process.env.ADMIN_USUARIO || 'admin';
  const senha = process.env.ADMIN_SENHA;
  if (!/^https?:\/\//.test(base) || !senha) {
    console.error('Uso: ADMIN_SENHA=… node scripts/subir-prompts.js https://endereco-do-app');
    process.exit(1);
  }
  const dir = path.join(__dirname, '..', '.prompts');
  const arquivos = fs.existsSync(dir) ? fs.readdirSync(dir) : [];

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: usuario, senha }),
  });
  if (!login.ok) { console.error(`Login falhou (${login.status}).`); process.exit(1); }
  const { token } = await login.json();

  let falhas = 0;
  for (const slot of SLOT_IDS) {
    const f = arquivos.find((x) => x === `${slot}.md` || x.startsWith(`${slot}-`));
    if (!f) { console.log(`- ${slot}: sem arquivo em .prompts/ (pulado)`); continue; }
    const conteudo = fs.readFileSync(path.join(dir, f), 'utf-8').replace(/\r\n/g, '\n');
    const r = await fetch(`${base}/api/admin/prompts/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conteudo, nomeArquivo: f }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) { falhas++; console.log(`✗ ${slot} (${f}): ${corpo.error || r.status}`); continue; }
    console.log(`✓ ${slot} (${f})${corpo.semMudanca ? ' · já estava igual' : ''}`);
  }

  const st = await (await fetch(`${base}/api/admin/prompts`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const faltando = st.slots.filter((s) => !s.carregado || s.problema).map((s) => s.id);
  console.log(faltando.length ? `Faltando ou com problema: ${faltando.join(', ')}` : `Todos os ${st.slots.length} prompts carregados e válidos · ${st.criterios.length} critérios.`);
  process.exit(falhas || faltando.length ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
