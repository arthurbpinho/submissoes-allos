import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import ChecklistSenha from '../components/ChecklistSenha';
import Consentimento from '../components/Consentimento';
import { checarSenha } from '../lib/senha';

// Cadastro de quem clicou em "Participar do edital". Quem já tem conta entra e
// confirma a participação com um clique.
export default function Participar({ user, onLogin }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [edital, setEdital] = useState(null);
  const [periodos, setPeriodos] = useState([]);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({ nome: '', sobrenome: '', curso: '', faculdade: '', periodo: '', email: '', senha: '', confirmar: '' });
  const [consentimento, setConsentimento] = useState(false);
  const [verSenha, setVerSenha] = useState(false);

  useEffect(() => {
    api.edital(slug).then(setEdital).catch((e) => setErro(e.message));
    api.periodos().then(setPeriodos).catch(() => {});
  }, [slug]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!edital) return <div className="site-container estreito">{erro ? <div className="alert error">{erro}</div> : <div className="carregando"><span className="spinner" /></div>}</div>;

  const cabecalho = (
    <div className="page-header">
      <div className="eyebrow"><Link to={`/editais/${slug}`}>{edital.titulo}</Link></div>
      <h2>Participar do <span className="accent">edital</span></h2>
      <div className="ornament" />
    </div>
  );

  if (edital.situacao !== 'abertas') {
    return (
      <div className="site-container estreito">
        {cabecalho}
        <div className="card">As inscrições deste edital não estão abertas. <Link to="/">Ver outros editais</Link>.</div>
      </div>
    );
  }

  if (user && user.papel === 'autor') {
    return (
      <div className="site-container estreito">
        {cabecalho}
        <div className="card">
          <p style={{ marginBottom: 16 }}>Você está conectado como <strong>{user.nome} {user.sobrenome}</strong> ({user.email}).</p>
          {erro && <div className="alert error">{erro}</div>}
          <button
            className="btn btn-primary"
            disabled={enviando}
            onClick={async () => {
              setEnviando(true); setErro('');
              try { await api.participar(slug); navigate('/dashboard'); } catch (e) { setErro(e.message); setEnviando(false); }
            }}
          >
            {enviando ? 'Confirmando…' : 'Confirmar participação e ir para o envio do texto'}
          </button>
        </div>
      </div>
    );
  }

  const senhaOk = checarSenha(form.senha, form).every((r) => r.ok);
  const confere = form.senha && form.senha === form.confirmar;

  async function cadastrar(e) {
    e.preventDefault();
    setErro('');
    if (!senhaOk) { setErro('A senha ainda não atende a todas as regras.'); return; }
    if (!confere) { setErro('A confirmação da senha não confere.'); return; }
    setEnviando(true);
    try {
      const { confirmar, ...dados } = form;
      const r = await api.cadastro({ ...dados, consentimento, editalSlug: slug });
      onLogin(r.user);
      navigate('/dashboard');
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="site-container estreito">
      {cabecalho}
      <p className="ja-tem-conta">
        Já tem conta? <Link to={`/entrar?next=${encodeURIComponent(`/editais/${slug}/participar`)}`}>Entre aqui</Link> e confirme a participação.
      </p>

      <form className="card form-cadastro" onSubmit={cadastrar}>
        <div className="form-grid">
          <div>
            <label htmlFor="nome">Nome</label>
            <input id="nome" value={form.nome} onChange={set('nome')} autoComplete="given-name" required />
          </div>
          <div>
            <label htmlFor="sobrenome">Sobrenome</label>
            <input id="sobrenome" value={form.sobrenome} onChange={set('sobrenome')} autoComplete="family-name" required />
          </div>
          <div>
            <label htmlFor="curso">Curso de graduação</label>
            <input id="curso" value={form.curso} onChange={set('curso')} placeholder="Ex.: Psicologia" required />
          </div>
          <div>
            <label htmlFor="faculdade">Faculdade</label>
            <input id="faculdade" value={form.faculdade} onChange={set('faculdade')} placeholder="Nome da instituição" required />
          </div>
          <div>
            <label htmlFor="periodo">Período da graduação</label>
            <select id="periodo" value={form.periodo} onChange={set('periodo')} required>
              <option value="">Escolha…</option>
              {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" autoCapitalize="none" required />
          </div>
          <div>
            <label htmlFor="senha">Senha</label>
            <div className="input-com-acao">
              <input id="senha" type={verSenha ? 'text' : 'password'} value={form.senha} onChange={set('senha')} autoComplete="new-password" required />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerSenha((v) => !v)}>{verSenha ? 'Ocultar' : 'Mostrar'}</button>
            </div>
          </div>
          <div>
            <label htmlFor="confirmar">Confirme a senha</label>
            <input id="confirmar" type={verSenha ? 'text' : 'password'} value={form.confirmar} onChange={set('confirmar')} autoComplete="new-password" required />
            {form.confirmar && !confere && <div className="campo-dica dica-erro">As senhas não conferem.</div>}
          </div>
        </div>

        <ChecklistSenha senha={form.senha} usuario={form} />

        <Consentimento checked={consentimento} onChange={setConsentimento} editalSlug={slug} />

        {erro && <div className="alert error">{erro}</div>}

        <button className="btn btn-primary btn-lg" type="submit" disabled={enviando || !consentimento}>
          {enviando ? 'Criando sua conta…' : 'Criar conta e participar'}
        </button>
      </form>
    </div>
  );
}
