import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Pontos, PortaoPill, SugestaoPill } from '../../components/Pontuacao';
import Markdown from '../../components/Markdown';
import Modal from '../../components/Modal';
import { dataHora } from '../../lib/util';

const EVENTO = {
  inscricao: 'Inscrição no edital',
  texto_enviado: 'Texto enviado',
  avaliacao_iniciada: 'Avaliação iniciada',
  portao_concluido: 'Regras do edital (portão) avaliadas',
  avaliacao_concluida: 'Avaliação da IA concluída',
  avaliacao_erro: 'Erro na avaliação',
  avaliacao_reenfileirada: 'Avaliação voltou para a fila',
  reavaliacao_pedida: 'Reavaliação pedida',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  correcao_enviada: 'Correção enviada ao autor',
  correcoes_enviadas: 'Autor enviou as correções',
  revisao_aceita: 'Revisão aceita',
  etapa_aguardando_publicacao: 'Diagramado · aguardando publicação',
  etapa_em_diagramacao: 'Voltou para a diagramação',
  etapa_publicado: 'Publicado',
};
const ESTADO_EMAIL = { enviado: 'enviado', falhou: 'falhou', nao_configurado: 'não configurado', pendente: 'pendente' };

export default function SubmissaoDetalhe() {
  const { id } = useParams();
  const [s, setS] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => api.admin.submissao(id).then(setS).catch((e) => setErro(e.message)), [id]);
  useEffect(() => { carregar(); }, [carregar]);

  // Enquanto a IA trabalha, acompanha sozinho.
  useEffect(() => {
    if (!s || !['enviado', 'em_avaliacao'].includes(s.status)) return undefined;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [s, carregar]);

  if (!s) return erro ? <div className="alert error">{erro}</div> : <div className="carregando"><span className="spinner" /></div>;
  const av = s.avaliacoes[0] || null;
  const avPronta = s.avaliacoes.find((a) => a.status === 'concluida') || null;

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow"><Link to="/admin/submissoes">Submissões</Link> · {s.edital.titulo}</div>
        <h2>{s.titulo || 'Sem texto'}</h2>
        <p style={{ margin: 0 }}>
          <strong>{s.autor?.nome}</strong> · {s.autor?.email} · {s.autor?.curso}, {s.autor?.faculdade} ({s.autor?.periodo})
        </p>
        <div className="detalhe-status">
          <span className={`status-pill admin st-${s.status}`}>{s.rotulo}</span>
          {s.palavras && <span className="celula-sub">{s.palavras.toLocaleString('pt-BR')} palavras · versão {s.versao}</span>}
          {['aprovado', 'correcoes_enviadas', 'aguardando_correcoes'].includes(s.status) && <Link className="btn btn-primary btn-sm" to={`/admin/revisao/${s.id}`}>Abrir revisão</Link>}
          {['em_diagramacao', 'aguardando_publicacao', 'publicado'].includes(s.status) && <Link className="btn btn-outline btn-sm" to="/admin/publicacao">Diagramação e publicação</Link>}
        </div>
        <div className="ornament" />
      </div>

      {erro && <div className="alert error">{erro}</div>}

      {s.status === 'avaliado' && avPronta && <Decisao s={s} av={avPronta} onFeito={carregar} />}
      {s.decisao && <DecisaoTomada s={s} />}
      {av && <AvaliacaoIA s={s} av={av} avPronta={avPronta} onMudou={carregar} />}
      {s.texto && <Texto s={s} />}

      <div className="painel-duas">
        <div className="card">
          <h3 className="card-titulo">Linha do tempo</h3>
          <ol className="eventos">
            {s.eventos.map((e, i) => (
              <li key={i}>
                <span className="evento-quando">{dataHora(e.em)}</span>
                <span>{EVENTO[e.tipo] || e.tipo}{e.detalhe ? <span className="celula-sub"> · {e.detalhe}</span> : null}</span>
                <span className="celula-sub">{e.por}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="card">
          <h3 className="card-titulo">E-mails</h3>
          {!s.emails.length && <p className="celula-sub">Nenhum e-mail para esta submissão.</p>}
          {s.emails.map((m) => (
            <div key={m.id} className="email-linha">
              <span>{m.assunto}</span>
              <span className={`email-estado est-${m.estado}`}>{ESTADO_EMAIL[m.estado]}</span>
              <span className="celula-sub">{dataHora(m.criado_em)}</span>
            </div>
          ))}
          {!!s.emails.length && <Link to="/admin/emails" className="celula-sub">Ver na caixa de saída →</Link>}
        </div>
      </div>
    </div>
  );
}

function Decisao({ s, av, onFeito }) {
  const [feedback, setFeedback] = useState(av.feedbackIA || '');
  const [observacoes, setObservacoes] = useState('');
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function abrirPrevia(decisao) {
    setErro('');
    try {
      const p = await api.admin.previaEmail(s.id, { decisao, feedback, observacoes });
      setPrevia({ decisao, ...p });
    } catch (e) { setErro(e.message); }
  }
  async function confirmar() {
    setEnviando(true);
    try {
      await api.admin.decidir(s.id, { decisao: previa.decisao, feedback, observacoes });
      setPrevia(null);
      onFeito();
    } catch (e) { setErro(e.message); setEnviando(false); }
  }

  return (
    <div className="card decisao-card">
      <div className="decisao-topo">
        <div>
          <h3 className="card-titulo">Decisão</h3>
          <p className="campo-ajuda">Revise o feedback que a IA escreveu, edite se quiser e decida. O autor recebe o resultado por e-mail e vê o feedback no painel.</p>
        </div>
        <div className="sugestao-ia">
          <span className="celula-sub">Avaliação da IA</span>
          {av.pontuacao.eliminado
            ? <PortaoPill nota={0} />
            : <Pontos valor={av.pontuacao.total} max={av.pontuacao.totalMax} faixa={av.pontuacao.faixaTotal} tamanho="md" />}
          {av.pontuacao.conferirRegra && <PortaoPill nota={1} />}
          <SugestaoPill sugestao={av.pontuacao.sugestao} />
          <span className="celula-sub">
            {av.pontuacao.loteN >= 5 ? `cor pela posição entre ${av.pontuacao.loteN} textos do edital` : 'sem cor até 5 textos avaliados no edital'}
          </span>
        </div>
      </div>

      <div className="card-titulo-linha">
        <label htmlFor="fb">Feedback ao autor</label>
        {feedback !== av.feedbackIA && <button className="btn btn-ghost btn-sm" onClick={() => setFeedback(av.feedbackIA || '')}>Restaurar o texto da IA</button>}
      </div>
      <textarea id="fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={16} />

      <label htmlFor="obs" style={{ marginTop: 14 }}>Pedidos de correção (opcional · só no e-mail de aprovação)</label>
      <textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={4}
        placeholder="Pontos que os revisores já querem que o autor revise. As marcações no texto você faz depois, na aba Revisão." />

      {erro && <div className="alert error">{erro}</div>}
      <div className="form-acoes">
        <button className="btn btn-danger" onClick={() => abrirPrevia('reprovado')}>Reprovar…</button>
        <button className="btn btn-primary" onClick={() => abrirPrevia('aprovado')}>Aprovar…</button>
      </div>

      {previa && (
        <Modal titulo={previa.decisao === 'aprovado' ? 'Aprovar e enviar o feedback' : 'Reprovar e enviar o feedback'} onClose={() => setPrevia(null)} largo>
          <p className="campo-ajuda">Para: <strong>{previa.para}</strong> · Assunto: <strong>{previa.assunto}</strong></p>
          <pre className="email-previa">{previa.texto}</pre>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setPrevia(null)}>Voltar e editar</button>
            <button className={`btn ${previa.decisao === 'aprovado' ? 'btn-primary' : 'btn-secondary'}`} disabled={enviando} onClick={confirmar}>
              {enviando ? 'Enviando…' : previa.decisao === 'aprovado' ? 'Confirmar aprovação' : 'Confirmar reprovação'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DecisaoTomada({ s }) {
  return (
    <div className="card">
      <h3 className="card-titulo">{s.decisao === 'aprovado' ? 'Aprovado' : 'Reprovado'} <span className="celula-sub">em {dataHora(s.decisaoEm)} por {s.decisaoPor}</span></h3>
      <details>
        <summary>Feedback enviado ao autor</summary>
        <div className="feedback-autor"><Markdown text={s.feedbackFinal} /></div>
        {s.observacoesDecisao && <div className="feedback-observacoes"><div className="feedback-observacoes-titulo">Pedidos de correção</div><Markdown text={s.observacoesDecisao} /></div>}
      </details>
      {s.status === 'publicado' && s.linkPublicacao && <p style={{ marginTop: 12 }}>Publicado: <a href={s.linkPublicacao} target="_blank" rel="noreferrer">{s.linkPublicacao}</a></p>}
    </div>
  );
}

const MODO = { batch: 'Batch API', direto: 'chamadas diretas', demonstracao: 'modo demonstração' };
const FASE = { portao: 'regras do edital (portão)', criterios: 'critérios 1–9' };

function Nota05({ nota }) {
  return (
    <span className="nota-05" title={`${nota} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= nota ? 'on' : ''} />)}
      <span>{nota}/5</span>
    </span>
  );
}

function AvaliacaoIA({ s, av, avPronta, onMudou }) {
  const [erro, setErro] = useState('');
  const emAndamento = ['na_fila', 'em_lote', 'executando'].includes(av.status);
  const podeReavaliar = ['enviado', 'em_avaliacao', 'avaliado'].includes(s.status) && !emAndamento;
  const mostrar = av.status === 'concluida' ? av : avPronta;

  async function reavaliar() {
    if (!window.confirm('Rodar a avaliação da IA de novo sobre a versão atual do texto?')) return;
    setErro('');
    try { await api.admin.reavaliar(s.id); onMudou(); } catch (e) { setErro(e.message); }
  }

  const pt = mostrar && mostrar.pontuacao;
  const portaoNota = mostrar && mostrar.portao ? mostrar.portao.nota : null;
  return (
    <div className="card">
      <div className="card-titulo-linha">
        <h3 className="card-titulo">Avaliação da IA</h3>
        {podeReavaliar && <button className="btn btn-outline btn-sm" onClick={reavaliar}>Reavaliar</button>}
      </div>
      {erro && <div className="alert error">{erro}</div>}

      {emAndamento && (
        <div className="evaluating-line-simples">
          <span className="spinner" />
          <span>
            Fase: {FASE[av.fase]}. {' '}
            {av.status === 'na_fila' && 'Na fila: sai no próximo ciclo do varredor.'}
            {av.status === 'em_lote' && <>No lote <span className="mono">{av.batchId}</span> da OpenAI (até 24h).</>}
            {av.status === 'executando' && 'Rodando agora.'}
            {av.fase === 'criterios' && av.portao && <> Passou nas regras do edital (nota {av.portao.nota}).</>}
          </span>
        </div>
      )}
      {av.status === 'erro' && <div className="alert error">A avaliação falhou na fase “{FASE[av.fase]}”: {av.erro}</div>}

      {mostrar && pt && (
        <>
          <div className="ia-resumo">
            <div>
              <span className="celula-sub">Total</span>
              {pt.eliminado ? <PortaoPill nota={0} /> : <Pontos valor={pt.total} max={pt.totalMax} faixa={pt.faixaTotal} tamanho="xl" />}
            </div>
            <div className="celula-sub">
              {mostrar.modo === 'demonstracao' ? MODO.demonstracao : `${mostrar.modelo} · ${MODO[mostrar.modo] || mostrar.modo}`}<br />
              concluída em {dataHora(mostrar.concluidoEm)}
              {mostrar.uso && mostrar.modo !== 'demonstracao' && <><br />tokens: {mostrar.uso.entrada.toLocaleString('pt-BR')} entrada ({mostrar.uso.cache.toLocaleString('pt-BR')} em cache) · {mostrar.uso.saida.toLocaleString('pt-BR')} saída</>}
            </div>
          </div>

          {mostrar.portao && (
            <div className={`portao-bloco p${portaoNota}`}>
              <div className="anotacao-topo">
                <strong>10. Regras do edital</strong>
                <PortaoPill nota={portaoNota} />
                <span className="celula-sub">nota {portaoNota} de 2</span>
              </div>
              <p>{mostrar.portao.analise}</p>
              {portaoNota === 0 && <p className="celula-sub">Os critérios 1–9 não rodaram. A decisão continua sendo sua.</p>}
            </div>
          )}

          {pt.tercos && (
            <div className="tercos-grade">
              {pt.tercos.map((t) => (
                <div key={t.id} className="terco-bloco">
                  <div className="terco-topo">
                    <strong>{t.nome}</strong>
                    <Pontos valor={t.valor} max={t.max} faixa={t.faixa} tamanho="sm" />
                  </div>
                  <div className="criterios-lista-admin">
                    {mostrar.criterios.filter((c) => c.terco === t.id).map((c) => (
                      <details key={c.numero} className="criterio-admin">
                        <summary>
                          <span className="criterio-num">{c.numero}</span>
                          <span className="criterio-nome-admin">{c.nome}</span>
                          <Nota05 nota={c.nota} />
                        </summary>
                        <p className="criterio-analise">{c.analise}</p>
                        {c.faltou && <p className="criterio-faltou"><strong>Faltou:</strong> {c.faltou}</p>}
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Texto({ s }) {
  const [versaoId, setVersaoId] = useState(s.versaoAtualId);
  const [texto, setTexto] = useState(s.texto);
  useEffect(() => {
    if (versaoId === s.versaoAtualId) { setTexto(s.texto); return; }
    api.admin.versao(versaoId).then((v) => setTexto(v.conteudo)).catch(() => {});
  }, [versaoId, s.versaoAtualId, s.texto]);
  return (
    <div className="card">
      <div className="card-titulo-linha">
        <h3 className="card-titulo">Texto</h3>
        {s.versoes.length > 1 && (
          <select value={versaoId} onChange={(e) => setVersaoId(Number(e.target.value))} className="select-compacto">
            {s.versoes.map((v) => <option key={v.id} value={v.id}>Versão {v.numero} · {v.origem === 'envio' ? 'envio' : 'correção'} · {dataHora(v.criado_em)}</option>)}
          </select>
        )}
      </div>
      <details>
        <summary>Mostrar o texto</summary>
        <div className="papel"><div className="doc-texto">{texto}</div></div>
      </details>
    </div>
  );
}
