import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function Entrar({ user, onLogin }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  const destino = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (user) return <Navigate to={user.papel === 'admin' ? '/admin' : destino} replace />;

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const u = await api.login(login, senha);
      onLogin(u);
      navigate(u.papel === 'admin' ? '/admin' : destino, { replace: true });
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="site-container login-site">
      <div className="login-card">
        <div className="login-eyebrow">Associação Allos</div>
        <h1>Submissões <span className="accent">Allos</span></h1>
        <p className="subtitle">acompanhe as suas submissões</p>
        <div className="login-ornament" />
        <form onSubmit={entrar}>
          <div>
            <label htmlFor="login">E-mail</label>
            <input id="login" type="email" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="email" autoCapitalize="none" required />
          </div>
          <div>
            <label htmlFor="senha">Senha</label>
            <input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
          </div>
          {erro && <div className="alert error">{erro}</div>}
          <button className="btn btn-primary" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="login-rodape">Ainda não tem conta? Escolha um <Link to="/">edital aberto</Link> e clique em “Participar”.</p>
      </div>
    </div>
  );
}
