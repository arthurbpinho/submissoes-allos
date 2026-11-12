import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import ThemeToggle from './components/ThemeToggle';
import { api, getToken, getSavedUser, clearAuth, onSessionExpired, saveAuth } from './api';
import { ICONS } from './icons';

import Home from './pages/Home';
import Edital from './pages/Edital';
import Participar from './pages/Participar';
import Entrar from './pages/Entrar';
import Dashboard from './pages/Dashboard';
import Correcoes from './pages/Correcoes';
import CorrecaoEditor from './pages/CorrecaoEditor';
import EmBreve from './pages/EmBreve';

import AdminLogin from './pages/admin/AdminLogin';
import Painel from './pages/admin/Painel';
import Editais from './pages/admin/Editais';
import EditalForm from './pages/admin/EditalForm';
import ListaSubmissoes from './pages/admin/ListaSubmissoes';
import SubmissaoDetalhe from './pages/admin/SubmissaoDetalhe';
import RevisaoEditor from './pages/admin/RevisaoEditor';
import Publicacao from './pages/admin/Publicacao';
import Prompts from './pages/admin/Prompts';
import Emails from './pages/admin/Emails';
import Equipe from './pages/admin/Equipe';
import Erros from './pages/admin/Erros';

export default function App() {
  const [user, setUser] = useState(() => (getToken() ? getSavedUser() : null));
  const [checking, setChecking] = useState(!!getToken());
  const location = useLocation();

  // Confirma o token no servidor (senha trocada ou conta excluída derruba a sessão).
  useEffect(() => {
    if (!getToken()) return undefined;
    let vivo = true;
    api.me()
      .then((u) => { if (vivo) { setUser(u); saveAuth(getToken(), u); } })
      .catch(() => { if (vivo) { clearAuth(); setUser(null); } })
      .finally(() => { if (vivo) setChecking(false); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => onSessionExpired(() => setUser(null)), []);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  const sair = () => { clearAuth(); setUser(null); };

  if (checking) return <div className="carregando-tela"><span className="spinner" /></div>;

  if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) {
    return <AdminApp user={user} setUser={setUser} sair={sair} />;
  }
  return <SiteApp user={user} setUser={setUser} sair={sair} />;
}

// ---------------------------------------------------------------------------
// Site público + área do autor
// ---------------------------------------------------------------------------

function SiteApp({ user, setUser, sair }) {
  const navigate = useNavigate();
  const autor = user && user.papel === 'autor' ? user : null;

  return (
    <div className="site">
      <header className="site-topo">
        <div className="site-topo-inner">
          <Link to="/" className="site-logo">Submissões <span className="accent">Allos</span></Link>
          <nav className="site-nav">
            <NavLink to="/" end>Editais</NavLink>
            {autor && <NavLink to="/dashboard">Minhas submissões</NavLink>}
            {autor && <NavLink to="/correcao">Correções</NavLink>}
            {user && user.papel === 'admin' && <NavLink to="/admin">Painel admin</NavLink>}
            {user
              ? <button className="btn btn-ghost btn-sm" onClick={() => { sair(); navigate('/'); }}>Sair</button>
              : <NavLink to="/entrar" className="site-entrar">Entrar</NavLink>}
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/editais/:slug" element={<Edital user={user} />} />
          <Route path="/editais/:slug/participar" element={<Participar user={user} onLogin={setUser} />} />
          <Route path="/entrar" element={<Entrar user={user} onLogin={setUser} />} />
          <Route path="/dashboard" element={<SoAutor user={user}><Dashboard user={autor} /></SoAutor>} />
          <Route path="/correcao" element={<SoAutor user={user}><Correcoes /></SoAutor>} />
          <Route path="/correcao/:id" element={<SoAutor user={user}><CorrecaoEditor /></SoAutor>} />
          <Route path="/politica-de-privacidade" element={<EmBreve titulo="Política de privacidade" />} />
          <Route path="/termos-de-uso" element={<EmBreve titulo="Termos de uso" />} />
          <Route path="*" element={<EmBreve titulo="Página não encontrada" naoEncontrada />} />
        </Routes>
      </main>

      <footer className="site-rodape">
        <div>Associação Allos · Submissões</div>
        <div className="site-rodape-links">
          <a href="/politica-de-privacidade">Política de privacidade</a>
          <a href="/termos-de-uso">Termos de uso</a>
        </div>
      </footer>
    </div>
  );
}

function SoAutor({ user, children }) {
  const location = useLocation();
  if (!user) return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.papel !== 'autor') return <Navigate to="/admin" replace />;
  return children;
}

// ---------------------------------------------------------------------------
// Painel de administração
// ---------------------------------------------------------------------------

function AdminApp({ user, setUser, sair }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenuAberto(false); }, [location.pathname]);

  if (!user || user.papel !== 'admin') {
    return <AdminLogin user={user} onLogin={setUser} onSair={sair} />;
  }

  const ativo = (p, exato = false) => (exato ? location.pathname === p : location.pathname === p || location.pathname.startsWith(`${p}/`));
  const item = (to, icone, rotulo, exato) => (
    <Link to={to} className={ativo(to, exato) ? 'active' : ''} title={rotulo}>{icone}<span>{rotulo}</span></Link>
  );

  return (
    <div className="app-layout">
      <header className="app-topbar">
        <button className="hamburger-btn" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu" aria-expanded={menuAberto}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="mobile-topbar-logo">Submissões <span className="accent">Allos</span></div>
        <div className="topbar-actions"><ThemeToggle /></div>
      </header>

      <div className={`mobile-nav-backdrop ${menuAberto ? 'open' : ''}`} onClick={() => setMenuAberto(false)} aria-hidden="true" />

      <aside className={`sidebar ${menuAberto ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <h1>Submissões <span className="accent">Allos</span></h1>
          <p>Administração</p>
        </div>
        <nav className="sidebar-nav">
          {item('/admin', ICONS.home, 'Painel', true)}
          {item('/admin/editais', ICONS.log, 'Editais')}
          <div className="nav-section">Fluxo</div>
          {item('/admin/avaliacao', ICONS.evaluate, 'Avaliação')}
          {item('/admin/revisao', ICONS.supervisor, 'Revisão')}
          {item('/admin/publicacao', ICONS.trophy, 'Diagramação e publicação')}
          {item('/admin/submissoes', ICONS.characters, 'Todas as submissões')}
          <div className="nav-section">Configuração</div>
          {item('/admin/prompts', ICONS.skill, 'Prompts da IA')}
          {item('/admin/emails', ICONS.social, 'E-mails')}
          {item('/admin/equipe', ICONS.admin, 'Equipe')}
          {item('/admin/erros', ICONS.alert, 'Erros')}
        </nav>
        <div className="sidebar-user">
          <div className="profile-mini">
            <div className="profile-mini-info">
              <div className="profile-mini-name">{user.nome}</div>
              <div className="profile-mini-role">Administração</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={sair} title="Sair">{ICONS.exit}</button>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/admin" element={<Painel />} />
          <Route path="/admin/editais" element={<Editais />} />
          <Route path="/admin/editais/novo" element={<EditalForm />} />
          <Route path="/admin/editais/:id" element={<EditalForm />} />
          <Route path="/admin/avaliacao" element={<ListaSubmissoes modo="avaliacao" />} />
          <Route path="/admin/revisao" element={<ListaSubmissoes modo="revisao" />} />
          <Route path="/admin/revisao/:id" element={<RevisaoEditor />} />
          <Route path="/admin/publicacao" element={<Publicacao />} />
          <Route path="/admin/submissoes" element={<ListaSubmissoes modo="todas" />} />
          <Route path="/admin/submissoes/:id" element={<SubmissaoDetalhe />} />
          <Route path="/admin/prompts" element={<Prompts />} />
          <Route path="/admin/emails" element={<Emails />} />
          <Route path="/admin/equipe" element={<Equipe user={user} />} />
          <Route path="/admin/erros" element={<Erros />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
