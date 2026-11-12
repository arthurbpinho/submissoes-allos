// Espelho de server/regras.js (checarSenha), para o checklist ao vivo do cadastro.
// O servidor valida de novo: isto é só a ajuda visual.
export const SIMBOLOS_SENHA = '!@#$%&*-';

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function identificadores({ email, nome, sobrenome } = {}) {
  const ids = new Set();
  const local = semAcento(String(email || '').split('@')[0]);
  if (local.length >= 3) ids.add(local);
  for (const parte of semAcento(`${nome || ''} ${sobrenome || ''}`).split(/[^a-z0-9]+/)) {
    if (parte.length >= 3) ids.add(parte);
  }
  return [...ids];
}

export function checarSenha(senha, usuario = {}) {
  const s = String(senha || '');
  const normal = semAcento(s);
  const contem = identificadores(usuario).some((id) => normal.includes(id));
  return [
    { id: 'tamanho', texto: 'Pelo menos 8 caracteres', ok: s.length >= 8 },
    { id: 'letra', texto: 'Pelo menos 1 letra', ok: /\p{L}/u.test(s) },
    { id: 'numero', texto: 'Pelo menos 1 número', ok: /\d/.test(s) },
    { id: 'simbolo', texto: 'Pelo menos 1 símbolo (! @ # $ % & * -)', ok: [...s].some((c) => SIMBOLOS_SENHA.includes(c)) },
    { id: 'usuario', texto: 'Não pode conter seu nome de usuário', ok: s.length > 0 && !contem },
  ];
}
