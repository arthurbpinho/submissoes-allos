// Cliente HTTP. Mesmo esquema do all_OS: token JWT no localStorage, 401
// derruba a sessão e avisa quem estiver ouvindo.
const BASE = '/api';
const TOKEN_KEY = 'submissoes_token';
const USER_KEY = 'submissoes_user';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function getSavedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function saveAuth(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* sem storage: a sessão dura até recarregar */ }
}
export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* nada */ }
}

const sessionListeners = new Set();
export function onSessionExpired(fn) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { ...options, headers });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/auth/login') {
    clearAuth();
    for (const fn of sessionListeners) { try { fn(); } catch { /* nada */ } }
  }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
  return data;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });
const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) });
const patch = (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
const del = (path) => request(path, { method: 'DELETE' });
const enc = encodeURIComponent;

export const api = {
  async login(login, senha) {
    const r = await post('/auth/login', { login, senha });
    saveAuth(r.token, r.user);
    return r.user;
  },
  async cadastro(dados) {
    const r = await post('/auth/cadastro', dados);
    saveAuth(r.token, r.user);
    return r;
  },
  me: () => request('/auth/me'),
  periodos: () => request('/periodos'),

  editais: () => request('/editais'),
  edital: (slug) => request(`/editais/${enc(slug)}`),
  participar: (slug) => post(`/editais/${enc(slug)}/participar`),

  minhasSubmissoes: () => request('/minhas-submissoes'),
  enviarTexto: (id, dados) => post(`/submissoes/${id}/texto`, dados),
  correcoes: () => request('/correcoes'),
  correcao: (id) => request(`/correcoes/${id}`),
  enviarCorrecao: (id, dados) => post(`/correcoes/${id}`, dados),

  admin: {
    resumo: () => request('/admin/resumo'),
    rodarCiclo: () => post('/admin/avaliacao/ciclo'),

    editais: () => request('/admin/editais'),
    edital: (id) => request(`/admin/editais/${id}`),
    criarEdital: (d) => post('/admin/editais', d),
    salvarEdital: (id, d) => put(`/admin/editais/${id}`, d),
    alternarEdital: (id, d) => patch(`/admin/editais/${id}`, d),
    excluirEdital: (id) => del(`/admin/editais/${id}`),

    submissoes: (filtros = {}) => {
      const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
      return request(`/admin/submissoes${qs ? `?${qs}` : ''}`);
    },
    submissao: (id) => request(`/admin/submissoes/${id}`),
    versao: (id) => request(`/admin/versoes/${id}`),
    reavaliar: (id) => post(`/admin/submissoes/${id}/reavaliar`),
    previaEmail: (id, d) => post(`/admin/submissoes/${id}/previa-email`, d),
    decidir: (id, d) => post(`/admin/submissoes/${id}/decisao`, d),
    etapa: (id, status, link) => post(`/admin/submissoes/${id}/etapa`, { status, link }),
    corrigirLink: (id, link) => put(`/admin/submissoes/${id}/link`, { link }),

    revisao: (id) => request(`/admin/revisao/${id}`),
    salvarRevisao: (id, d) => put(`/admin/revisao/${id}`, d),
    enviarRevisao: (id, d) => post(`/admin/revisao/${id}/enviar`, d),
    aceitarRevisao: (id) => post(`/admin/revisao/${id}/aceitar`),

    prompts: () => request('/admin/prompts'),
    prompt: (slot, versao) => request(`/admin/prompts/${enc(slot)}${versao ? `?versao=${versao}` : ''}`),
    salvarPrompt: (slot, conteudo, nomeArquivo) => put(`/admin/prompts/${enc(slot)}`, { conteudo, nomeArquivo }),

    emails: () => request('/admin/emails'),
    email: (id) => request(`/admin/emails/${id}`),
    reenviarEmail: (id) => post(`/admin/emails/${id}/reenviar`),
    erros: () => request('/admin/erros'),

    equipe: () => request('/admin/equipe'),
    criarAdmin: (d) => post('/admin/equipe', d),
    senhaAdmin: (id, senha) => put(`/admin/equipe/${id}/senha`, { senha }),
    excluirAdmin: (id) => del(`/admin/equipe/${id}`),
  },
};
