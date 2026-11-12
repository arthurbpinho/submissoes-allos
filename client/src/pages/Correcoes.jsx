import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';

// submissao.allos.org.br/correcao: o link do e-mail. Com uma correção pendente,
// vai direto para ela; com várias, lista.
export default function Correcoes() {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api.correcoes().then(setLista).catch((e) => setErro(e.message)); }, []);

  if (lista && lista.length === 1) return <Navigate to={`/correcao/${lista[0].id}`} replace />;
  return (
    <div className="site-container estreito">
      <div className="page-header">
        <div className="eyebrow">Revisão</div>
        <h2>Correções</h2>
        <div className="ornament" />
      </div>
      {erro && <div className="alert error">{erro}</div>}
      {!lista && !erro && <div className="carregando"><span className="spinner" /></div>}
      {lista && !lista.length && (
        <div className="card vazio">Você não tem correções pendentes. Acompanhe os seus textos no <Link to="/dashboard">painel</Link>.</div>
      )}
      {lista && lista.length > 1 && lista.map((s) => (
        <Link key={s.id} to={`/correcao/${s.id}`} className="card lista-link">
          <strong>{s.edital.titulo}</strong>
          <span>Fazer as correções →</span>
        </Link>
      ))}
    </div>
  );
}
