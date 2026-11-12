import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { ResumoPontuacao } from '../../components/Pontuacao';
import { dataHora } from '../../lib/util';

const MODOS = {
  avaliacao: {
    titulo: 'Avaliação',
    texto: 'Textos avaliados pela IA aguardando a sua decisão. Total de 0 a 45 em três terços (Relevância, Rigor, Escrita), coloridos pela posição no lote do edital. A escolha é comparativa: abra cada um, revise o feedback e decida.',
    grupos: [
      { titulo: 'Aguardando decisão · do maior para o menor total', status: ['avaliado'], porTotal: true },
      { titulo: 'Em processamento', status: ['enviado', 'em_avaliacao'] },
    ],
  },
  revisao: {
    titulo: 'Revisão',
    texto: 'Textos aprovados. Marque trechos, comente e envie as correções ao autor, ou aceite o texto para a diagramação.',
    grupos: [
      { titulo: 'Para revisar', status: ['aprovado', 'correcoes_enviadas'] },
      { titulo: 'Com o autor', status: ['aguardando_correcoes'] },
    ],
  },
  todas: { titulo: 'Todas as submissões', texto: 'Todas as inscrições e textos, de todos os editais.', grupos: null },
};

const STATUS_FILTRO = ['inscrito', 'enviado', 'em_avaliacao', 'avaliado', 'aprovado', 'reprovado', 'aguardando_correcoes', 'correcoes_enviadas', 'em_diagramacao', 'aguardando_publicacao', 'publicado'];

export default function ListaSubmissoes({ modo }) {
  const cfg = MODOS[modo];
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState(null);
  const [editais, setEditais] = useState([]);
  const [rotulos, setRotulos] = useState({});
  const [erro, setErro] = useState('');
  const filtroStatus = params.get('status') || '';
  const filtroEdital = params.get('edital') || '';

  useEffect(() => {
    setLista(null);
    const status = cfg.grupos ? cfg.grupos.flatMap((g) => g.status).join(',') : filtroStatus;
    api.admin.submissoes({ status, edital: filtroEdital }).then(setLista).catch((e) => setErro(e.message));
  }, [modo, filtroStatus, filtroEdital]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.admin.editais().then(setEditais).catch(() => {});
    api.admin.resumo().then((r) => setRotulos(r.rotulos)).catch(() => {});
  }, []);

  const filtro = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Fluxo</div>
        <h2>{cfg.titulo}</h2>
        <p>{cfg.texto}</p>
        <div className="ornament" />
      </div>

      <div className="filtros">
        <select value={filtroEdital} onChange={(e) => filtro('edital', e.target.value)}>
          <option value="">Todos os editais</option>
          {editais.map((e) => <option key={e.id} value={e.id}>{e.titulo}</option>)}
        </select>
        {!cfg.grupos && (
          <select value={filtroStatus} onChange={(e) => filtro('status', e.target.value)}>
            <option value="">Todos os status</option>
            {STATUS_FILTRO.map((s) => <option key={s} value={s}>{rotulos[s] || s}</option>)}
          </select>
        )}
      </div>

      {erro && <div className="alert error">{erro}</div>}
      {!lista && !erro && <div className="carregando"><span className="spinner" /></div>}
      {lista && (cfg.grupos
        ? cfg.grupos.map((g) => {
          const itens = lista.filter((s) => g.status.includes(s.status));
          return <Tabela key={g.titulo} titulo={g.titulo} itens={g.porTotal ? [...itens].sort(porTotal) : itens} modo={modo} />;
        })
        : <Tabela itens={lista} modo={modo} />)}
    </div>
  );
}

// As notas servem para ordenar o lote (guia de implementação): maior total
// primeiro; eliminados pelas regras do edital no fim.
function porTotal(a, b) {
  const t = (s) => {
    const p = s.avaliacao && s.avaliacao.pontuacao;
    if (!p) return -2;
    return p.eliminado ? -1 : p.total;
  };
  return t(b) - t(a);
}

function Tabela({ titulo, itens, modo }) {
  const destino = (s) => (modo === 'revisao' ? `/admin/revisao/${s.id}` : `/admin/submissoes/${s.id}`);
  return (
    <div className="lista-grupo">
      {titulo && <h3 className="lista-grupo-titulo">{titulo} <span className="contador">{itens.length}</span></h3>}
      {!itens.length ? <div className="card vazio tight">Nada aqui.</div> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="admin-table">
            <thead><tr><th>Autor</th><th>Texto</th><th>Edital</th><th>Status</th><th>Avaliação da IA</th><th>Atualizado</th></tr></thead>
            <tbody>
              {itens.map((s) => (
                <tr key={s.id}>
                  <td><Link to={destino(s)}><strong>{s.autor?.nome}</strong></Link><div className="celula-sub">{s.autor?.email}</div></td>
                  <td className="celula-titulo">{s.titulo || <span className="celula-sub">sem texto</span>}{s.versao > 1 && <span className="celula-sub"> · v{s.versao}</span>}</td>
                  <td className="celula-sub">{s.edital?.titulo}</td>
                  <td><span className={`status-pill admin st-${s.status}`}>{s.rotulo}</span></td>
                  <td>
                    {s.avaliacao?.status === 'concluida' && <ResumoPontuacao p={s.avaliacao.pontuacao} />}
                    {s.avaliacao?.status === 'erro' && <span className="tag-alerta">erro</span>}
                    {['na_fila', 'em_lote', 'executando'].includes(s.avaliacao?.status) && (
                      <span className="celula-sub">{s.avaliacao.fase === 'portao' ? 'portão' : 'critérios 1–9'} · {s.avaliacao.status.replace('_', ' ')}</span>
                    )}
                  </td>
                  <td className="celula-sub">{dataHora(s.atualizadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
