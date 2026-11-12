import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import Markdown from '../components/Markdown';
import { SituacaoPill, prazoTexto } from './Home';
import { dataHora } from '../lib/util';

export default function Edital() {
  const { slug } = useParams();
  const [e, setE] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api.edital(slug).then(setE).catch((x) => setErro(x.message)); }, [slug]);

  if (erro) return <div className="site-container estreito"><div className="alert error">{erro}</div><Link to="/">← Ver editais</Link></div>;
  if (!e) return <div className="carregando"><span className="spinner" /></div>;

  const aberto = e.situacao === 'abertas';
  return (
    <div className="site-container estreito">
      <div className="page-header">
        <div className="eyebrow"><Link to="/">Editais</Link>{e.revista ? ` · ${e.revista}` : ''}</div>
        <h2>{e.titulo}</h2>
        {e.chamada && <p>{e.chamada}</p>}
        <div className="ornament" />
      </div>

      <div className="edital-faixa card tight">
        <div>
          <SituacaoPill situacao={e.situacao} />
          <div className="edital-prazos">
            {prazoTexto(e)}
            {e.fechaEm && aberto && <span className="edital-prazo-hora"> (até {dataHora(e.fechaEm)})</span>}
          </div>
          {(e.palavrasMin || e.palavrasMax) && (
            <div className="edital-prazos">
              Extensão: {e.palavrasMin ? `mínimo de ${e.palavrasMin.toLocaleString('pt-BR')}` : ''}
              {e.palavrasMin && e.palavrasMax ? ' e ' : ''}
              {e.palavrasMax ? `máximo de ${e.palavrasMax.toLocaleString('pt-BR')}` : ''} palavras
            </div>
          )}
        </div>
        {aberto && <Link to={`/editais/${e.slug}/participar`} className="btn btn-primary btn-lg">Participar do edital</Link>}
      </div>

      <div className="card edital-corpo">
        {e.corpo ? <Markdown text={e.corpo} /> : <p>O texto completo do edital será publicado em breve.</p>}
      </div>

      {aberto && (
        <div className="edital-cta-final">
          <Link to={`/editais/${e.slug}/participar`} className="btn btn-primary btn-lg">Participar do edital</Link>
        </div>
      )}
    </div>
  );
}
