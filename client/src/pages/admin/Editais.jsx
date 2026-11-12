import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { data, SITUACAO_EDITAL } from '../../lib/util';

export default function Editais() {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = () => api.admin.editais().then(setLista).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  async function alternar(e, campo) {
    setErro('');
    try { await api.admin.alternarEdital(e.id, { [campo]: !e[campo] }); carregar(); } catch (x) { setErro(x.message); }
  }

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <div className="eyebrow">Administração</div>
          <h2>Editais</h2>
          <p>Crie editais, defina os prazos e controle o que aparece na página inicial.</p>
          <div className="ornament" />
        </div>
        <Link to="/admin/editais/novo" className="btn btn-primary">Novo edital</Link>
      </div>

      <div className="card em-breve-card">
        <div>
          <strong>Gerador de edital com IA</strong>
          <p>Gerar editais de pesquisa a partir de algumas informações básicas. Em construção.</p>
        </div>
        <span className="situacao-pill sit-em_breve">Em breve</span>
      </div>

      {erro && <div className="alert error">{erro}</div>}
      {!lista && !erro && <div className="carregando"><span className="spinner" /></div>}
      {lista && !lista.length && <div className="card vazio">Nenhum edital ainda.</div>}
      {lista && !!lista.length && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="admin-table">
            <thead><tr><th>Edital</th><th>Situação</th><th>Prazo</th><th>Inscritos</th><th>Na home</th><th>Inscrições</th><th /></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td><Link to={`/admin/editais/${e.id}`}><strong>{e.titulo}</strong></Link><div className="celula-sub">/{e.slug}</div></td>
                  <td><span className={`situacao-pill sit-${e.situacao}`}>{SITUACAO_EDITAL[e.situacao]}</span></td>
                  <td className="celula-sub">{e.abre_em ? `${data(e.abre_em)} → ` : ''}{e.fecha_em ? data(e.fecha_em) : 'sem prazo'}</td>
                  <td>{e.inscritos} <span className="celula-sub">({e.textos} textos)</span></td>
                  <td><Chave ligada={e.publicado} onClick={() => alternar(e, 'publicado')} rotulo={e.publicado ? 'Publicado' : 'Rascunho'} /></td>
                  <td><Chave ligada={e.inscricoes_abertas} onClick={() => alternar(e, 'inscricoes_abertas')} rotulo={e.inscricoes_abertas ? 'Abertas' : 'Fechadas'} /></td>
                  <td className="actions">
                    {e.publicado && <a className="btn btn-outline btn-sm" href={`/editais/${e.slug}`} target="_blank" rel="noreferrer">Ver</a>}
                    <Link className="btn btn-outline btn-sm" to={`/admin/editais/${e.id}`}>Editar</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="campo-ajuda">
        A situação é calculada pelas datas: antes da abertura o edital aparece como “em breve”; depois do prazo, as inscrições
        fecham sozinhas. A chave “Inscrições” fecha (ou pausa) antes do prazo, como no processo seletivo.
      </p>
    </div>
  );
}

export function Chave({ ligada, onClick, rotulo }) {
  return (
    <button type="button" className={`chave ${ligada ? 'ligada' : ''}`} onClick={onClick} aria-pressed={!!ligada}>
      <span className="chave-trilho"><span className="chave-bola" /></span>
      <span className="chave-rotulo">{rotulo}</span>
    </button>
  );
}
