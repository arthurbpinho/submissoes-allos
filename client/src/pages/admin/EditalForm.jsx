import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import Markdown from '../../components/Markdown';
import { Chave } from './Editais';
import { isoParaLocal, localParaIso, SITUACAO_EDITAL } from '../../lib/util';

const VAZIO = {
  titulo: '', slug: '', revista: '', chamada: '', corpo: '', resumo_ia: '',
  palavras_min: '', palavras_max: '', limiar_descarte: '',
  publicado: false, inscricoes_abertas: true, abre_em: '', fecha_em: '', visivel_ate: '',
};

export default function EditalForm() {
  const { id } = useParams();
  const novo = !id;
  const navigate = useNavigate();
  const [f, setF] = useState(novo ? VAZIO : null);
  const [situacao, setSituacao] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [previa, setPrevia] = useState(false);

  useEffect(() => {
    if (novo) return;
    api.admin.edital(id).then((e) => {
      setSituacao(e.situacao);
      setF({
        ...e,
        palavras_min: e.palavras_min ?? '', palavras_max: e.palavras_max ?? '', limiar_descarte: e.limiar_descarte ?? '',
        abre_em: isoParaLocal(e.abre_em), fecha_em: isoParaLocal(e.fecha_em), visivel_ate: isoParaLocal(e.visivel_ate),
      });
    }).catch((e) => setErro(e.message));
  }, [id, novo]);

  if (!f) return erro ? <div className="alert error">{erro}</div> : <div className="carregando"><span className="spinner" /></div>;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function salvar(e) {
    e.preventDefault();
    setErro(''); setAviso('');
    setSalvando(true);
    const corpo = { ...f, abre_em: localParaIso(f.abre_em), fecha_em: localParaIso(f.fecha_em), visivel_ate: localParaIso(f.visivel_ate) };
    try {
      const r = novo ? await api.admin.criarEdital(corpo) : await api.admin.salvarEdital(id, corpo);
      setSituacao(r.situacao);
      if (novo) navigate(`/admin/editais/${r.id}`, { replace: true });
      else { setF((x) => ({ ...x, slug: r.slug })); setAviso('Edital salvo.'); }
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!window.confirm('Excluir este edital? Só é possível enquanto ninguém se inscreveu.')) return;
    try { await api.admin.excluirEdital(id); navigate('/admin/editais'); } catch (x) { setErro(x.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow"><Link to="/admin/editais">Editais</Link>{situacao ? ` · ${SITUACAO_EDITAL[situacao]}` : ''}</div>
        <h2>{novo ? 'Novo edital' : f.titulo}</h2>
        <div className="ornament" />
      </div>

      <form onSubmit={salvar}>
        <div className="card">
          <h3 className="card-titulo">Identificação</h3>
          <div className="form-grid">
            <div className="col-2">
              <label htmlFor="titulo">Título</label>
              <input id="titulo" value={f.titulo} onChange={set('titulo')} required />
            </div>
            <div>
              <label htmlFor="revista">Revista</label>
              <input id="revista" value={f.revista} onChange={set('revista')} placeholder="Nome da revista" />
            </div>
            <div>
              <label htmlFor="slug">Endereço (slug)</label>
              <input id="slug" value={f.slug} onChange={set('slug')} placeholder="gerado a partir do título" />
              <div className="campo-dica">submissao.allos.org.br/editais/{f.slug || '…'}</div>
            </div>
            <div className="col-2">
              <label htmlFor="chamada">Chamada (aparece no card da página inicial)</label>
              <textarea id="chamada" value={f.chamada} onChange={set('chamada')} rows={2} />
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-titulo">Prazos e visibilidade</h3>
          <div className="form-grid">
            <div>
              <label htmlFor="abre">Inscrições abrem em</label>
              <input id="abre" type="datetime-local" value={f.abre_em} onChange={set('abre_em')} />
              <div className="campo-dica">Vazio: abertas assim que publicar.</div>
            </div>
            <div>
              <label htmlFor="fecha">Inscrições e envio fecham em</label>
              <input id="fecha" type="datetime-local" value={f.fecha_em} onChange={set('fecha_em')} />
              <div className="campo-dica">Vazio: sem prazo (feche pela chave).</div>
            </div>
            <div>
              <label htmlFor="visivel">Fica no ar até</label>
              <input id="visivel" type="datetime-local" value={f.visivel_ate} onChange={set('visivel_ate')} />
              <div className="campo-dica">Depois disso o edital sai da página inicial. Vazio: continua listado como encerrado.</div>
            </div>
            <div className="chaves-form">
              <Chave ligada={f.publicado} onClick={() => setF((x) => ({ ...x, publicado: !x.publicado }))} rotulo={f.publicado ? 'Publicado na página inicial' : 'Rascunho (só a equipe vê)'} />
              <Chave ligada={f.inscricoes_abertas} onClick={() => setF((x) => ({ ...x, inscricoes_abertas: !x.inscricoes_abertas }))} rotulo={f.inscricoes_abertas ? 'Inscrições liberadas no prazo' : 'Inscrições fechadas manualmente'} />
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-titulo">Requisitos e avaliação</h3>
          <div className="form-grid tres">
            <div>
              <label htmlFor="pmin">Mínimo de palavras</label>
              <input id="pmin" type="number" min="1" value={f.palavras_min} onChange={set('palavras_min')} />
            </div>
            <div>
              <label htmlFor="pmax">Máximo de palavras</label>
              <input id="pmax" type="number" min="1" value={f.palavras_max} onChange={set('palavras_max')} />
            </div>
            <div>
              <label htmlFor="limiar">Limiar de descarte (0–45, opcional)</label>
              <input id="limiar" type="number" min="0" max="45" step="1" value={f.limiar_descarte} onChange={set('limiar_descarte')} />
              <div className="campo-dica">Textos com total abaixo disso ganham o sinal “abaixo do limiar”. Calibre no primeiro lote. Quem decide é a equipe.</div>
            </div>
          </div>
          <label htmlFor="resumo" style={{ marginTop: 16 }}>Resumo do edital para a IA</label>
          <textarea id="resumo" value={f.resumo_ia} onChange={set('resumo_ia')} rows={6}
            placeholder="Tema, tipo de texto aceito, público, requisitos que o critério Regras do edital deve conferir. Vazio: a IA recebe o edital completo." />
        </div>

        <div className="card">
          <div className="card-titulo-linha">
            <h3 className="card-titulo">Texto do edital</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrevia((v) => !v)}>{previa ? 'Editar' : 'Pré-visualizar'}</button>
          </div>
          {previa
            ? <div className="previa-md"><Markdown text={f.corpo} /></div>
            : <textarea value={f.corpo} onChange={set('corpo')} rows={18} className="mono-leve"
                placeholder={'# Seções com #\n\nParágrafos separados por linha em branco.\n\n- listas com hífen\n- **negrito** e *itálico*'} />}
        </div>

        {erro && <div className="alert error">{erro}</div>}
        {aviso && <div className="alert">{aviso}</div>}
        <div className="form-acoes">
          {!novo && <button type="button" className="btn btn-danger btn-sm" onClick={excluir}>Excluir edital</button>}
          <button className="btn btn-primary" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar edital'}</button>
        </div>
      </form>
    </div>
  );
}
