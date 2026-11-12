import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import EditorAnotado from '../components/EditorAnotado';
import Consentimento from '../components/Consentimento';
import { SeletorTxt, useArquivoTxt } from '../components/EnviarTexto';
import { TIPO_ROTULO, regiaoAlterada, ajustarAnotacoes } from '../lib/anotacoes';
import { dataHora, guardar, recuperar, esquecer, contarPalavras } from '../lib/util';

// O autor corrige o texto no próprio site, com as marcações do revisor à vista.
export default function CorrecaoEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [anotacoes, setAnotacoes] = useState([]);
  const [respostas, setRespostas] = useState({});
  const [observacoes, setObservacoes] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [ativa, setAtiva] = useState(null);
  const [irPara, setIrPara] = useState(null);
  const [recuperado, setRecuperado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [trocar, setTrocar] = useState(false);
  const arquivo = useArquivoTxt();
  const chave = dados ? `correcao-${id}-r${dados.rodada}` : null;
  const carregou = useRef(false);

  useEffect(() => {
    api.correcao(id).then((d) => {
      setDados(d);
      const rasc = recuperar(`correcao-${id}-r${d.rodada}`);
      if (rasc && typeof rasc.texto === 'string') {
        setTexto(rasc.texto);
        setAnotacoes(rasc.anotacoes || d.anotacoes);
        setRespostas(rasc.respostas || {});
        setObservacoes(rasc.observacoes || '');
        setRecuperado(true);
      } else {
        setTexto(d.texto);
        setAnotacoes(d.anotacoes);
      }
      carregou.current = true;
    }).catch((e) => setErro(e.message));
  }, [id]);

  // Rascunho local: fechar a aba não perde o trabalho.
  useEffect(() => {
    if (!carregou.current || !chave) return undefined;
    const t = setTimeout(() => guardar(chave, { texto, anotacoes, respostas, observacoes }), 600);
    return () => clearTimeout(t);
  }, [chave, texto, anotacoes, respostas, observacoes]);

  // Arquivo novo escolhido: substitui o texto (as marcações se reposicionam pelo que sobrou igual).
  useEffect(() => {
    if (!arquivo.arquivo) return;
    if (window.confirm('Substituir o texto do editor pelo conteúdo deste arquivo? As marcações dos trechos que mudaram podem se perder.')) {
      editar(arquivo.arquivo.texto, anotacoesReposicionadas(texto, arquivo.arquivo.texto, anotacoes));
      setTrocar(false);
    }
    arquivo.limpar();
  }, [arquivo.arquivo]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordenadas = useMemo(() => [...anotacoes].sort((a, b) => (a.inicio ?? 0) - (b.inicio ?? 0)), [anotacoes]);

  if (erro) {
    return (
      <div className="site-container estreito">
        <div className="alert error">{erro}</div>
        <Link to="/dashboard">← Voltar ao painel</Link>
      </div>
    );
  }
  if (!dados) return <div className="carregando"><span className="spinner" /></div>;

  function editar(novo, novas) { setTexto(novo); setAnotacoes(novas); }
  const setResp = (aid, campo, valor) => setRespostas((r) => ({ ...r, [aid]: { ...(r[aid] || {}), [campo]: valor } }));
  const original = new Map(dados.anotacoes.map((a) => [a.id, a]));

  function desfazerTudo() {
    if (!window.confirm('Voltar ao texto original e descartar todas as suas alterações?')) return;
    setTexto(dados.texto);
    setAnotacoes(dados.anotacoes);
    setRespostas({});
    setObservacoes('');
    esquecer(chave);
    setRecuperado(false);
  }

  async function enviar() {
    if (texto === dados.texto && !observacoes.trim()
      && !window.confirm('Você não alterou o texto nem escreveu observações. Enviar mesmo assim?')) return;
    if (!window.confirm('Enviar as correções? Depois do envio, o texto vai para os revisores.')) return;
    setEnviando(true);
    setErro('');
    try {
      await api.enviarCorrecao(id, {
        conteudo: texto,
        observacoes,
        consentimento: true,
        anotacoes: anotacoes.map((a) => ({
          id: a.id,
          inicio: a.fim > a.inicio ? a.inicio : null,
          fim: a.fim > a.inicio ? a.fim : null,
          situacao: respostas[a.id]?.situacao || null,
          resposta: respostas[a.id]?.resposta || '',
        })),
      });
      esquecer(chave);
      navigate('/dashboard');
    } catch (e) {
      setErro(e.message);
      setEnviando(false);
    }
  }

  return (
    <div className="site-container largo">
      <div className="page-header">
        <div className="eyebrow"><Link to="/dashboard">Painel</Link> · {dados.submissao.edital.titulo}</div>
        <h2>Correções do <span className="accent">seu texto</span></h2>
        <p>
          Os revisores marcaram trechos do texto{dados.rodada > 1 ? ` (rodada ${dados.rodada})` : ''}. Corrija direto no editor abaixo:
          as marcações acompanham o texto enquanto você digita. Se decidir não fazer alguma correção, marque “Não vou corrigir” e explique.
        </p>
        <div className="ornament" />
      </div>

      {recuperado && <div className="alert">Recuperamos o rascunho que você deixou neste navegador. <button className="btn btn-ghost btn-sm" onClick={desfazerTudo}>Começar do zero</button></div>}

      {dados.observacoesRevisor && (
        <div className="card tight observacoes-revisor">
          <div className="feedback-observacoes-titulo">Observações gerais dos revisores</div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{dados.observacoesRevisor}</p>
        </div>
      )}

      <Legenda />

      <div className="revisao-grade">
        <div className="revisao-doc">
          <div className="doc-barra">
            <span>{contarPalavras(texto).toLocaleString('pt-BR')} palavras</span>
            <span className="doc-barra-acoes">
              <button className="btn btn-ghost btn-sm" onClick={() => setTrocar((v) => !v)}>Substituir por um novo .txt</button>
              <button className="btn btn-ghost btn-sm" onClick={desfazerTudo}>Desfazer tudo</button>
            </span>
          </div>
          {trocar && (
            <div className="doc-trocar">
              <SeletorTxt onEscolher={arquivo.escolher} compacto />
              {arquivo.erro && <div className="alert error">{arquivo.erro}</div>}
            </div>
          )}
          <div className="papel">
            <EditorAnotado
              valor={texto}
              anotacoes={anotacoes}
              onChange={editar}
              ativa={ativa}
              onAtivar={setAtiva}
              irPara={irPara}
            />
          </div>
        </div>

        <aside className="revisao-lateral">
          <div className="lateral-titulo">Marcações ({anotacoes.length})</div>
          {ordenadas.map((a) => {
            const r = respostas[a.id] || {};
            const removido = a.inicio == null || a.fim <= a.inicio;
            const orig = original.get(a.id);
            return (
              <div
                key={a.id}
                className={`anotacao-card ${ativa === a.id ? 'ativa' : ''}`}
                onClick={() => { setAtiva(a.id); if (!removido) setIrPara({ id: a.id, t: Date.now() }); }}
              >
                <div className="anotacao-topo">
                  <TipoChip a={a} />
                  {removido ? <span className="anotacao-estado">trecho removido</span> : a.editada ? <span className="anotacao-estado">trecho editado</span> : null}
                </div>
                <blockquote className="anotacao-trecho">“{trecho(dados.texto, orig)}”</blockquote>
                {a.comentario && <p className="anotacao-comentario">{a.comentario}</p>}
                <div className="anotacao-resposta" onClick={(e) => e.stopPropagation()}>
                  <div className="segmentado">
                    <button className={r.situacao === 'corrigido' ? 'on' : ''} onClick={() => setResp(a.id, 'situacao', r.situacao === 'corrigido' ? null : 'corrigido')}>Corrigi</button>
                    <button className={r.situacao === 'mantido' ? 'on' : ''} onClick={() => setResp(a.id, 'situacao', r.situacao === 'mantido' ? null : 'mantido')}>Não vou corrigir</button>
                  </div>
                  {(r.situacao === 'mantido' || r.resposta) && (
                    <textarea
                      className="anotacao-input"
                      placeholder={r.situacao === 'mantido' ? 'Explique por que você manteve este trecho' : 'Resposta (opcional)'}
                      value={r.resposta || ''}
                      onChange={(e) => setResp(a.id, 'resposta', e.target.value)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </aside>
      </div>

      <div className="card correcao-envio">
        <label htmlFor="obs">Observações adicionais</label>
        <p className="campo-ajuda">Use este espaço para justificar as correções que você decidiu não fazer, ou para comentar qualquer outra mudança.</p>
        <textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={5} />
        <Consentimento checked={consentimento} onChange={setConsentimento} editalSlug={dados.submissao.edital.slug} />
        {erro && <div className="alert error">{erro}</div>}
        <div className="correcao-acoes">
          <span className="campo-ajuda">Revisão enviada em {dataHora(dados.enviadaEm)}. O rascunho fica salvo neste navegador até você enviar.</span>
          <button className="btn btn-primary btn-lg" disabled={!consentimento || enviando} onClick={enviar}>
            {enviando ? 'Enviando…' : 'Enviar correções'}
          </button>
        </div>
      </div>
    </div>
  );
}

function trecho(texto, a) {
  if (!a) return '';
  const t = texto.slice(a.inicio, a.fim);
  return t.length > 180 ? `${t.slice(0, 177)}…` : t;
}

// Troca do texto inteiro (arquivo novo): é uma edição só, com o mesmo
// algoritmo de quando a pessoa digita.
function anotacoesReposicionadas(antes, depois, anotacoes) {
  const { ini, fimAntigo, tamNovo } = regiaoAlterada(antes, depois);
  return ajustarAnotacoes(anotacoes, ini, fimAntigo, tamNovo);
}

export function TipoChip({ a }) {
  return (
    <span className={`tipo-chip tipo-${a.tipo} ${a.tipo === 'destaque' ? `an-cor-${a.cor || 'amarelo'}` : ''}`}>
      {TIPO_ROTULO[a.tipo] || a.tipo}
    </span>
  );
}

export function Legenda() {
  return (
    <div className="legenda">
      <span><span className="an an-cor-amarelo">destaque</span></span>
      <span><span className="an" style={{ textDecorationLine: 'underline' }}>sublinhado</span></span>
      <span><span className="an" style={{ textDecorationLine: 'line-through' }}>cortar</span></span>
      <span><span className="an an-comentario an-com-nota">comentário</span></span>
    </div>
  );
}
