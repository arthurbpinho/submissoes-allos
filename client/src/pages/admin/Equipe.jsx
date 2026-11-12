import { useEffect, useState } from 'react';
import { api } from '../../api';
import { dataHora } from '../../lib/util';
import ChecklistSenha from '../../components/ChecklistSenha';

export default function Equipe({ user }) {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState({ nome: '', username: '', email: '', senha: '' });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const carregar = () => api.admin.equipe().then(setLista).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function criar(e) {
    e.preventDefault();
    setErro(''); setAviso('');
    try {
      await api.admin.criarAdmin(form);
      setAviso(`Conta "${form.username}" criada.`);
      setForm({ nome: '', username: '', email: '', senha: '' });
      carregar();
    } catch (x) { setErro(x.message); }
  }
  async function trocarSenha(u) {
    const nova = window.prompt(`Nova senha para ${u.username}:`);
    if (!nova) return;
    try { await api.admin.senhaAdmin(u.id, nova); setAviso(`Senha de "${u.username}" trocada.`); } catch (x) { setErro(x.message); }
  }
  async function excluir(u) {
    if (!window.confirm(`Excluir a conta "${u.username}"?`)) return;
    try { await api.admin.excluirAdmin(u.id); carregar(); } catch (x) { setErro(x.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Configuração</div>
        <h2>Equipe</h2>
        <p>Contas com acesso ao painel de administração.</p>
        <div className="ornament" />
      </div>
      {erro && <div className="alert error">{erro}</div>}
      {aviso && <div className="alert">{aviso}</div>}
      <div className="card">
        <h3 className="card-titulo">Nova conta de administração</h3>
        <form onSubmit={criar}>
          <div className="form-grid">
            <div><label htmlFor="n">Nome</label><input id="n" value={form.nome} onChange={set('nome')} required /></div>
            <div><label htmlFor="u">Usuário</label><input id="u" value={form.username} onChange={set('username')} autoCapitalize="none" required /></div>
            <div><label htmlFor="e">E-mail (opcional)</label><input id="e" type="email" value={form.email} onChange={set('email')} /></div>
            <div><label htmlFor="s">Senha</label><input id="s" type="text" value={form.senha} onChange={set('senha')} required /></div>
          </div>
          <ChecklistSenha senha={form.senha} usuario={{ email: form.username, nome: form.nome }} />
          <button className="btn btn-primary" type="submit">Criar conta</button>
        </form>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Nome</th><th>Usuário</th><th>E-mail</th><th>Criada em</th><th /></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id}>
                <td>{u.nome}</td><td>{u.username}</td><td>{u.email || '—'}</td><td>{dataHora(u.criado_em)}</td>
                <td className="actions">
                  <button className="btn btn-outline btn-sm" onClick={() => trocarSenha(u)}>Trocar senha</button>
                  {u.id !== user.id && <button className="btn btn-outline btn-sm" onClick={() => excluir(u)}>Excluir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
