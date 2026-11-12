import { useState } from 'react';
import { api } from '../../api';

export default function AdminLogin({ user, onLogin, onSair }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const u = await api.login(login, senha);
      if (u.papel !== 'admin') { setErro('Esta conta não tem acesso à administração.'); setEnviando(false); return; }
      onLogin(u);
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-eyebrow">Associação Allos</div>
        <h1>Submissões <span className="accent">Allos</span></h1>
        <p className="subtitle">painel de administração</p>
        <div className="login-ornament" />
        {user && user.papel !== 'admin' && (
          <div className="alert warn">Você está conectado como autor. <button className="btn btn-ghost btn-sm" onClick={onSair}>Sair</button></div>
        )}
        <form onSubmit={entrar}>
          <div>
            <label htmlFor="login">Usuário ou e-mail</label>
            <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          </div>
          <div>
            <label htmlFor="senha">Senha</label>
            <input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
          </div>
          {erro && <div className="alert error">{erro}</div>}
          <button type="submit" className="btn btn-primary" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  );
}
