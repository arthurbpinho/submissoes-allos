import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusTimeline from '../components/StatusTimeline';
import EnviarTexto from '../components/EnviarTexto';
import Markdown from '../components/Markdown';
import { data, dataHora } from '../lib/util';

export default function Dashboard({ user }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => api.minhasSubmissoes().then(setLista).catch((e) => setErro(e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="site-container">
      <div className="page-header">
        <div className="eyebrow">Painel de submissão</div>
        <h2>Olá, <span className="accent">{user?.nome}</span></h2>
        <p>Acompanhe aqui cada etapa dos seus textos, do envio à publicação.</p>
        <div className="ornament" />
      </div>

      {erro && <div className="alert error">{erro}</div>}
      {!lista && !erro && <div className="carregando"><span className="spinner" /></div>}
      {lista && !lista.length && (
        <div className="card vazio">
          Você ainda não participa de nenhum edital. <Link to="/">Veja os editais abertos</Link>.
        </div>
      )}
      {lista && lista.map((s) => <CartaoSubmissao key={s.id} s={s} onMudou={carregar} />)}
    </div>
  );
}

function CartaoSubmissao({ s, onMudou }) {
  const [aviso, setAviso] = useState('');
  return (
    <section className="card submissao-card">
      <div className="submissao-topo">
        <div>
          <div className="eyebrow-mini">{s.edital.revista || 'Edital'}</div>
          <h3><Link to={`/editais/${s.edital.slug}`}>{s.edital.titulo}</Link></h3>
        </div>
        <span className={`status-pill st-${s.status}`}>{s.rotulo}</span>
      </div>

      {s.status !== 'nenhum_texto' && <StatusTimeline status={s.status} />}
      {aviso && <div className="alert">{aviso}</div>}

      <div className="submissao-corpo">
        <Conteudo s={s} onEnviado={() => { setAviso('Texto enviado! Você vai receber a confirmação por e-mail.'); onMudou(); }} />
      </div>
    </section>
  );
}

function Conteudo({ s, onEnviado }) {
  switch (s.status) {
    case 'nenhum_texto':
      if (!s.podeEnviarTexto) {
        return <p className="status-explica">Nenhum texto enviado. O prazo de envio deste edital {s.edital.situacao === 'em_breve' ? 'ainda não começou' : 'está encerrado'}.</p>;
      }
      return (
        <>
          <p className="status-explica">
            Nenhum texto enviado ainda.{s.edital.fechaEm ? <> O prazo vai até <strong>{dataHora(s.edital.fechaEm)}</strong>.</> : null}
          </p>
          <EnviarTexto edital={s.edital} onEnviar={async (d) => { await api.enviarTexto(s.id, d); onEnviado(); }} />
        </>
      );
    case 'enviado':
      return <p className="status-explica">Recebemos o seu texto em {dataHora(s.enviadoEm)}. Ele está na fila e a avaliação começa em breve.</p>;
    case 'em_avaliacao':
      return <p className="status-explica">O seu texto está em avaliação. Quando a equipe concluir, você recebe o resultado por e-mail e ele aparece aqui.</p>;
    case 'reprovado':
      return (
        <>
          <p className="status-explica">Agradecemos o envio. Desta vez, o texto não foi aprovado. Leia o retorno abaixo: ele foi escrito para ajudar no seu próximo texto.</p>
          <Feedback texto={s.feedback} />
          <p className="status-explica">Continue acompanhando <Link to="/">nossos editais</Link>: esperamos receber um novo texto seu.</p>
        </>
      );
    case 'aprovado':
      return (
        <>
          <p className="status-explica destaque">Parabéns! O seu texto foi aprovado em {data(s.decisaoEm)}.</p>
          <Feedback texto={s.feedback} observacoes={s.observacoes} />
          <p className="status-explica">Agora os revisores leem o texto com atenção. Se pedirem correções, você recebe um e-mail e faz as correções aqui no site.</p>
        </>
      );
    case 'aguardando_correcoes':
      return (
        <>
          <p className="status-explica destaque">Os revisores marcaram pontos para corrigir no seu texto.</p>
          <Link to={`/correcao/${s.id}`} className="btn btn-primary">Fazer as correções</Link>
          <Feedback texto={s.feedback} observacoes={s.observacoes} recolhido />
        </>
      );
    case 'correcoes_enviadas':
      return (
        <>
          <p className="status-explica">Recebemos as suas correções. Os revisores estão conferindo e podem pedir novos ajustes.</p>
          <Feedback texto={s.feedback} observacoes={s.observacoes} recolhido />
        </>
      );
    case 'em_diagramacao':
      return <><p className="status-explica">Texto aceito! Agora ele está sendo diagramado para a revista.</p><Feedback texto={s.feedback} recolhido /></>;
    case 'aguardando_publicacao':
      return <><p className="status-explica">O texto está diagramado e aguarda a publicação na revista.</p><Feedback texto={s.feedback} recolhido /></>;
    case 'publicado':
      return (
        <>
          <p className="status-explica destaque">O seu texto foi publicado!</p>
          {s.linkPublicacao && <a href={s.linkPublicacao} target="_blank" rel="noreferrer" className="btn btn-primary">Acessar a publicação</a>}
          <Feedback texto={s.feedback} recolhido />
        </>
      );
    default:
      return null;
  }
}

function Feedback({ texto, observacoes, recolhido = false }) {
  if (!texto) return null;
  const corpo = (
    <div className="feedback-autor">
      <Markdown text={texto} />
      {observacoes && (
        <div className="feedback-observacoes">
          <div className="feedback-observacoes-titulo">Pontos que os revisores pediram para revisar</div>
          <Markdown text={observacoes} />
        </div>
      )}
    </div>
  );
  if (!recolhido) return <><div className="feedback-titulo">Retorno da avaliação</div>{corpo}</>;
  return <details className="feedback-recolhido"><summary>Ver o retorno da avaliação</summary>{corpo}</details>;
}
