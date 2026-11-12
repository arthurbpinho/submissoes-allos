import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { dataHora } from '../../lib/util';

const GRUPOS = [
  { status: 'em_diagramacao', titulo: 'Em diagramação' },
  { status: 'aguardando_publicacao', titulo: 'Aguardando publicação' },
  { status: 'publicado', titulo: 'Publicados' },
];

export default function Publicacao() {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = () => api.admin.submissoes({ status: GRUPOS.map((g) => g.status).join(',') }).then(setLista).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  async function mover(s, status) {
    let link;
    if (status === 'publicado') {
      link = window.prompt('Link da publicação na revista (começando com http):', '');
      if (!link) return;
    }
    setErro('');
    try { await api.admin.etapa(s.id, status, link); carregar(); } catch (e) { setErro(e.message); }
  }
  async function trocarLink(s) {
    const link = window.prompt('Novo link da publicação:', '');
    if (!link) return;
    try { await api.admin.corrigirLink(s.id, link); carregar(); } catch (e) { setErro(e.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Fluxo</div>
        <h2>Diagramação e publicação</h2>
        <p>Textos aceitos na revisão. Por enquanto, as etapas avançam à mão: a publicação na revista é manual e o link é colado aqui.</p>
        <div className="ornament" />
      </div>
      <div className="card em-breve-card">
        <div><strong>Sistema de formatação e diagramação</strong><p>Formatação automática do texto para a revista. Em construção.</p></div>
        <span className="situacao-pill sit-em_breve">Em breve</span>
      </div>
      {erro && <div className="alert error">{erro}</div>}
      {!lista && !erro && <div className="carregando"><span className="spinner" /></div>}
      {lista && GRUPOS.map((g) => {
        const itens = lista.filter((s) => s.status === g.status);
        return (
          <div key={g.status} className="lista-grupo">
            <h3 className="lista-grupo-titulo">{g.titulo} <span className="contador">{itens.length}</span></h3>
            {!itens.length ? <div className="card vazio tight">Nada aqui.</div> : (
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead><tr><th>Texto</th><th>Autor</th><th>Edital</th><th>Atualizado</th><th /></tr></thead>
                  <tbody>
                    {itens.map((s) => (
                      <tr key={s.id}>
                        <td className="celula-titulo"><Link to={`/admin/submissoes/${s.id}`}>{s.titulo}</Link></td>
                        <td>{s.autor?.nome}</td>
                        <td className="celula-sub">{s.edital?.titulo}</td>
                        <td className="celula-sub">{dataHora(s.atualizadoEm)}</td>
                        <td className="actions">
                          {s.status === 'em_diagramacao' && <button className="btn btn-primary btn-sm" onClick={() => mover(s, 'aguardando_publicacao')}>Diagramado</button>}
                          {s.status === 'aguardando_publicacao' && <>
                            <button className="btn btn-outline btn-sm" onClick={() => mover(s, 'em_diagramacao')}>Voltar</button>
                            <button className="btn btn-primary btn-sm" onClick={() => mover(s, 'publicado')}>Publicar (link)</button>
                          </>}
                          {s.status === 'publicado' && <>
                            <button className="btn btn-outline btn-sm" onClick={() => trocarLink(s)}>Trocar link</button>
                            <button className="btn btn-outline btn-sm" onClick={() => mover(s, 'aguardando_publicacao')}>Despublicar</button>
                          </>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
