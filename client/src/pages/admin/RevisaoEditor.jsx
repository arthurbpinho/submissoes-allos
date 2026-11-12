import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import TextoAnotado from '../../components/TextoAnotado';
import { TipoChip, Legenda } from '../CorrecaoEditor';
import { CORES, novoId } from '../../lib/anotacoes';
import { diffTextos } from '../../lib/diff';
import { dataHora } from '../../lib/util';

// Revisão estilo Google Docs: o admin não edita o texto do autor; seleciona
// trechos e marca (destaque em cores, sublinhado, cortar) e comenta.
export default function RevisaoEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [anotacoes, setAnotacoes] = useState([]);
  const [observacoes, setObservacoes] = useState('');
  const [ativa, setAtiva] = useState(null);
  const [selecao, setSelecao] = useState(null);
  const [salvoEm, setSalvoEm] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const pronto = useRef(false);
  const focar = useRef(null);

  const carregar = useCallback(() => api.admin.revisao(id).then((r) => {
    setD(r);
    if (r.rodadaAtual) {
      setAnotacoes(r.rodadaAtual.anotacoes);
      setObservacoes(r.rodadaAtual.observacoesAdmin || '');
    }
    pronto.current = true;
  }).catch((e) => setErro(e.message)), [id]);
  useEffect(() => { carregar(); }, [carregar]);

  // Salva o rascunho sozinho, um pouco depois da última mudança.
  useEffect(() => {
    if (!pronto.current || !d?.podeRevisar) return undefined;
    const t = setTimeout(async () => {
      setSalvando(true);
      try {
        await api.admin.salvarRevisao(id, { anotacoes, observacoes });
        setSalvoEm(new Date());
        setErro('');
      } catch (e) { setErro(e.message); } finally { setSalvando(false); }
    }, 1000);
    return () => clearTimeout(t);
  }, [anotacoes, observacoes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const some = () => setSelecao(null);
    window.addEventListener('scroll', some, { passive: true });
    return () => window.removeEventListener('scroll', some);
  }, []);

  const ordenadas = useMemo(() => [...anotacoes].sort((a, b) => a.inicio - b.inicio || a.fim - b.fim), [anotacoes]);

  if (!d) return erro ? <div className="alert error">{erro}</div> : <div className="carregando"><span className="spinner" /></div>;

  function marcar(tipo, cor = null) {
    if (!selecao) return;
    const nova = { id: novoId(), inicio: selecao.inicio, fim: selecao.fim, tipo, cor, comentario: '' };
    setAnotacoes((l) => [...l, nova]);
    setAtiva(nova.id);
    setSelecao(null);
    window.getSelection()?.removeAllRanges();
    if (tipo === 'comentario') focar.current = nova.id;
  }
  const atualizar = (aid, campos) => setAnotacoes((l) => l.map((a) => (a.id === aid ? { ...a, ...campos } : a)));
  const remover = (aid) => setAnotacoes((l) => l.filter((a) => a.id !== aid));

  async function enviar() {
    if (!anotacoes.length && !observacoes.trim()) { setErro('Marque ao menos um trecho ou escreva uma observação antes de enviar.'); return; }
    if (!window.confirm(`Enviar ${anotacoes.length} marcação(ões) ao autor? Ele recebe um e-mail para corrigir o texto em /correcao.`)) return;
    setEnviando(true); setErro('');
    try { await api.admin.enviarRevisao(id, { anotacoes, observacoes }); navigate('/admin/revisao'); } catch (e) { setErro(e.message); setEnviando(false); }
  }
  async function aceitar() {
    const msg = anotacoes.length
      ? 'Aceitar o texto como está e seguir para a diagramação? As marcações deste rascunho NÃO serão enviadas ao autor.'
      : 'Aceitar o texto como está e seguir para a diagramação?';
    if (!window.confirm(msg)) return;
    setEnviando(true); setErro('');
    try { await api.admin.aceitarRevisao(id); navigate('/admin/publicacao'); } catch (e) { setErro(e.message); setEnviando(false); }
  }

  const s = d.submissao;
  const ultima = d.rodadasAnteriores[d.rodadasAnteriores.length - 1];

  return (
    <div className="revisao-pagina">
      <div className="page-header">
        <div className="eyebrow"><Link to="/admin/revisao">Revisão</Link> · {s.edital?.titulo}</div>
        <h2>{s.titulo}</h2>
        <p style={{ margin: 0 }}>
          <Link to={`/admin/submissoes/${s.id}`}>{s.autor?.nome}</Link> · versão {s.versao} · {s.palavras?.toLocaleString('pt-BR')} palavras
        </p>
        <div className="detalhe-status"><span className={`status-pill admin st-${s.status}`}>{s.rotulo}</span></div>
        <div className="ornament" />
      </div>

      {erro && <div className="alert error">{erro}</div>}

      {d.rodadasAnteriores.map((r) => <RodadaAnterior key={r.numero} r={r} aberta={r === ultima && s.status === 'correcoes_enviadas'} />)}

      {!d.podeRevisar && (
        <div className="card">
          {s.status === 'aguardando_correcoes'
            ? <>A rodada {ultima?.numero} foi enviada em {dataHora(ultima?.enviadaEm)} e está com o autor. Quando ele enviar as correções, elas aparecem aqui.</>
            : <>Esta submissão não está em revisão ({s.rotulo}).</>}
        </div>
      )}

      {d.podeRevisar && d.rodadaAtual && (
        <>
          <div className="revisao-instrucao">
            <strong>Rodada {d.rodadaAtual.numero}.</strong> Selecione um trecho do texto para marcar ou comentar.
            O autor vê as marcações e corrige o texto no site.
            <Legenda />
          </div>

          <div className="revisao-grade">
            <div className="revisao-doc">
              <div className="doc-barra">
                <span>{anotacoes.length} marcação(ões)</span>
                <span className="celula-sub">{salvando ? 'Salvando…' : salvoEm ? `Rascunho salvo às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'O rascunho é salvo automaticamente'}</span>
              </div>
              <div className="papel" onClick={() => setAtiva(null)}>
                <TextoAnotado
                  texto={d.texto}
                  anotacoes={anotacoes}
                  ativa={ativa}
                  onAtivar={setAtiva}
                  onSelecionar={setSelecao}
                />
              </div>
            </div>

            <aside className="revisao-lateral">
              <div className="lateral-titulo">Marcações</div>
              {!ordenadas.length && <p className="celula-sub">Nenhuma marcação ainda.</p>}
              {ordenadas.map((a) => (
                <div key={a.id} className={`anotacao-card ${ativa === a.id ? 'ativa' : ''}`} onClick={() => setAtiva(a.id)}>
                  <div className="anotacao-topo">
                    <TipoChip a={a} />
                    {a.tipo === 'destaque' && (
                      <span className="cores-mini">
                        {Object.keys(CORES).map((c) => (
                          <button key={c} className={`cor-bola an-cor-${c} ${a.cor === c ? 'on' : ''}`} title={CORES[c]} onClick={(e) => { e.stopPropagation(); atualizar(a.id, { cor: c }); }} />
                        ))}
                      </span>
                    )}
                    <button className="btn btn-ghost btn-sm anotacao-apagar" title="Apagar marcação" onClick={(e) => { e.stopPropagation(); remover(a.id); }}>✕</button>
                  </div>
                  <blockquote className="anotacao-trecho">“{trechoCurto(d.texto, a)}”</blockquote>
                  <textarea
                    className="anotacao-input"
                    placeholder={a.tipo === 'comentario' ? 'Escreva o comentário' : 'Comentário (opcional)'}
                    value={a.comentario}
                    autoFocus={focar.current === a.id}
                    onFocus={() => { focar.current = null; setAtiva(a.id); }}
                    onChange={(e) => atualizar(a.id, { comentario: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ))}
            </aside>
          </div>

          <div className="card">
            <label htmlFor="obs-gerais">Observações gerais ao autor</label>
            <textarea id="obs-gerais" rows={4} value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Comentários que valem para o texto todo (opcional)." />
            <div className="form-acoes">
              <button className="btn btn-outline" disabled={enviando} onClick={aceitar}>Aceitar o texto e seguir para a diagramação</button>
              <button className="btn btn-primary" disabled={enviando} onClick={enviar}>Enviar correção ao autor</button>
            </div>
          </div>
        </>
      )}

      {selecao && (
        <div
          className="barra-marcacao"
          style={{ top: Math.max(8, selecao.rect.top - 52), left: Math.min(window.innerWidth - 420, Math.max(8, selecao.rect.left + selecao.rect.width / 2 - 200)) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {Object.keys(CORES).map((c) => (
            <button key={c} className={`cor-bola an-cor-${c}`} title={`Destacar em ${CORES[c].toLowerCase()}`} onClick={() => marcar('destaque', c)} />
          ))}
          <span className="barra-sep" />
          <button className="barra-btn barra-sublinhar" title="Sublinhar" onClick={() => marcar('sublinhado')}>Sublinhar</button>
          <button className="barra-btn barra-cortar" title="Cortar (tachar)" onClick={() => marcar('tachado')}>Cortar</button>
          <button className="barra-btn barra-comentar" title="Comentar" onClick={() => marcar('comentario')}>Comentar</button>
        </div>
      )}
    </div>
  );
}

function trechoCurto(texto, a) {
  const t = texto.slice(a.inicio, a.fim);
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

const SITUACAO = { corrigido: 'Corrigi', mantido: 'Não vou corrigir' };

// Uma rodada já enviada: o que o admin marcou e como o autor respondeu.
function RodadaAnterior({ r, aberta }) {
  const [aba, setAba] = useState('marcacoes');
  const respondida = !!r.respondidaEm;
  const diff = useMemo(() => (aba === 'diff' && respondida ? diffTextos(r.textoAnotado, r.textoResposta) : null), [aba, respondida, r]);
  const resp = r.anotacoesResposta || [];
  const noTextoNovo = resp.filter((a) => a.novoInicio != null).map((a) => ({ ...a, inicio: a.novoInicio, fim: a.novoFim }));

  return (
    <details className="card rodada-anterior" open={aberta}>
      <summary>
        <strong>Rodada {r.numero}</strong>
        <span className="celula-sub"> · enviada em {dataHora(r.enviadaEm)} · {r.anotacoes.length} marcação(ões)</span>
        {respondida ? <span className="celula-sub"> · respondida em {dataHora(r.respondidaEm)}</span> : <span className="tag-alerta">com o autor</span>}
      </summary>

      {r.observacoesAdmin && <p className="rodada-obs"><strong>Observações enviadas:</strong> {r.observacoesAdmin}</p>}

      {respondida && (
        <>
          {r.observacoesAutor && (
            <div className="feedback-observacoes"><div className="feedback-observacoes-titulo">Observações do autor</div><p style={{ whiteSpace: 'pre-wrap' }}>{r.observacoesAutor}</p></div>
          )}
          <div className="prep-abas">
            <button className={`prep-aba ${aba === 'marcacoes' ? 'ativa' : ''}`} onClick={() => setAba('marcacoes')}>Respostas às marcações</button>
            <button className={`prep-aba ${aba === 'texto' ? 'ativa' : ''}`} onClick={() => setAba('texto')}>Marcações no texto corrigido</button>
            <button className={`prep-aba ${aba === 'diff' ? 'ativa' : ''}`} onClick={() => setAba('diff')}>O que mudou</button>
          </div>
          {aba === 'marcacoes' && (
            <div className="respostas-lista">
              {resp.map((a) => (
                <div key={a.id} className="resposta-item">
                  <div className="anotacao-topo">
                    <TipoChip a={a} />
                    {a.situacao ? <span className={`situacao-resp sr-${a.situacao}`}>{SITUACAO[a.situacao]}</span> : <span className="celula-sub">sem resposta</span>}
                    {a.novoInicio == null && <span className="anotacao-estado">trecho removido</span>}
                  </div>
                  <blockquote className="anotacao-trecho">“{a.trecho}”</blockquote>
                  {a.comentario && <p className="anotacao-comentario">{a.comentario}</p>}
                  {a.resposta && <p className="anotacao-resposta-autor"><strong>Autor:</strong> {a.resposta}</p>}
                </div>
              ))}
            </div>
          )}
          {aba === 'texto' && <div className="papel"><TextoAnotado texto={r.textoResposta} anotacoes={noTextoNovo} apagado /></div>}
          {aba === 'diff' && diff && (
            <div className="papel"><div className="doc-texto">
              {diff.map((p, i) => (p.tipo === 'igual' ? p.texto : p.tipo === 'add' ? <ins key={i}>{p.texto}</ins> : <del key={i}>{p.texto}</del>))}
            </div></div>
          )}
        </>
      )}
    </details>
  );
}
