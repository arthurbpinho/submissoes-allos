import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { data, SITUACAO_EDITAL } from '../lib/util';

export function SituacaoPill({ situacao }) {
  return <span className={`situacao-pill sit-${situacao}`}>{SITUACAO_EDITAL[situacao] || situacao}</span>;
}

export function prazoTexto(e) {
  if (e.situacao === 'em_breve' && e.abreEm) return `Inscrições a partir de ${data(e.abreEm)}`;
  if (e.situacao === 'abertas' && e.fechaEm) return `Inscrições até ${data(e.fechaEm)}`;
  if (e.situacao === 'abertas') return 'Inscrições abertas';
  if (e.situacao === 'encerradas' && e.fechaEm) return `Encerrado em ${data(e.fechaEm)}`;
  return '';
}

export default function Home() {
  const [editais, setEditais] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api.editais().then(setEditais).catch((e) => setErro(e.message)); }, []);

  const abertos = (editais || []).filter((e) => e.situacao !== 'encerradas');
  const encerrados = (editais || []).filter((e) => e.situacao === 'encerradas');

  return (
    <>
      <section className="hero">
        <div className="site-container">
          <div className="hero-eyebrow">Associação Allos · Revistas</div>
          <h1 className="hero-titulo">Publique o seu texto <span className="accent">com a Allos</span></h1>
          <p className="hero-texto">
            Editais de publicação para estudantes de graduação. Escolha um edital, faça a sua inscrição e envie o
            seu texto. Você acompanha cada etapa, da avaliação à publicação, pelo seu painel.
          </p>
          <div className="hero-passos">
            <span>1 · Inscrição</span><span>2 · Envio do texto</span><span>3 · Avaliação</span><span>4 · Revisão</span><span>5 · Publicação</span>
          </div>
        </div>
      </section>

      <div className="site-container" id="editais">
        {erro && <div className="alert error">{erro}</div>}
        {!editais && !erro && <div className="carregando"><span className="spinner" /></div>}

        {editais && (
          <>
            <h2 className="secao-titulo">Editais</h2>
            {!abertos.length && <div className="card vazio">Nenhum edital aberto no momento. Volte em breve.</div>}
            <div className="editais-grid">
              {abertos.map((e) => <CardEdital key={e.id} e={e} />)}
            </div>
            {!!encerrados.length && (
              <>
                <h3 className="secao-subtitulo">Encerrados</h3>
                <div className="editais-grid">
                  {encerrados.map((e) => <CardEdital key={e.id} e={e} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function CardEdital({ e }) {
  return (
    <Link to={`/editais/${e.slug}`} className={`edital-card sit-${e.situacao}`}>
      <div className="edital-card-topo">
        <SituacaoPill situacao={e.situacao} />
        {e.revista && <span className="edital-revista">{e.revista}</span>}
      </div>
      <h3>{e.titulo}</h3>
      {e.chamada && <p>{e.chamada}</p>}
      <div className="edital-card-rodape">
        <span>{prazoTexto(e)}</span>
        <span className="edital-card-seta">{e.situacao === 'abertas' ? 'Participar →' : 'Ver edital →'}</span>
      </div>
    </Link>
  );
}
