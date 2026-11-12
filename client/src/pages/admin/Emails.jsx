import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import Modal from '../../components/Modal';
import { dataHora } from '../../lib/util';

const ESTADO = { enviado: 'Enviado', falhou: 'Falhou', nao_configurado: 'Não configurado', pendente: 'Pendente' };
const TIPO = { texto_enviado: 'Texto recebido', decisao_aprovado: 'Aprovado', decisao_reprovado: 'Reprovado', correcao: 'Pedido de correção' };

export default function Emails() {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);
  const carregar = () => api.admin.emails().then(setD).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  async function abrir(id) {
    try { setAberto(await api.admin.email(id)); } catch (e) { setErro(e.message); }
  }
  async function reenviar(id) {
    setErro('');
    try { await api.admin.reenviarEmail(id); carregar(); } catch (e) { setErro(e.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Configuração</div>
        <h2>E-mails</h2>
        <p>Caixa de saída: todo e-mail do fluxo fica registrado aqui, enviado ou não.</p>
        <div className="ornament" />
      </div>
      {d && !d.configurado && (
        <div className="alert warn">
          O envio pela Microsoft Graph (Entra) ainda não está configurado. Os e-mails ficam registrados como “não configurado”
          e podem ser reenviados daqui depois que as variáveis <code>GRAPH_*</code> e <code>MAIL_FROM</code> forem preenchidas.
        </div>
      )}
      {erro && <div className="alert error">{erro}</div>}
      {d && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="admin-table">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Para</th><th>Assunto</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {!d.emails.length && <tr><td colSpan={6} className="celula-sub">Nenhum e-mail ainda.</td></tr>}
              {d.emails.map((m) => (
                <tr key={m.id}>
                  <td className="celula-sub">{dataHora(m.criado_em)}</td>
                  <td>{TIPO[m.tipo] || m.tipo}</td>
                  <td>{m.para}</td>
                  <td>{m.submissao_id ? <Link to={`/admin/submissoes/${m.submissao_id}`}>{m.assunto}</Link> : m.assunto}</td>
                  <td><span className={`email-estado est-${m.estado}`} title={m.erro || ''}>{ESTADO[m.estado]}</span></td>
                  <td className="actions">
                    <button className="btn btn-outline btn-sm" onClick={() => abrir(m.id)}>Ver</button>
                    {['falhou', 'nao_configurado'].includes(m.estado) && <button className="btn btn-outline btn-sm" onClick={() => reenviar(m.id)}>Reenviar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aberto && (
        <Modal titulo={aberto.assunto} onClose={() => setAberto(null)} largo>
          <p className="campo-ajuda">Para {aberto.para} · {ESTADO[aberto.estado]}{aberto.erro ? ` · ${aberto.erro}` : ''}</p>
          <iframe title="Prévia do e-mail" className="email-iframe" sandbox="" srcDoc={aberto.html} />
          <details><summary>Versão em texto</summary><pre className="email-previa">{aberto.texto}</pre></details>
        </Modal>
      )}
    </div>
  );
}
