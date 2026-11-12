import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { dataHora, SITUACAO_EDITAL } from '../../lib/util';

const BLOCOS = [
  { titulo: 'Avaliação', link: '/admin/avaliacao', status: ['enviado', 'em_avaliacao', 'avaliado'], destaque: 'avaliado' },
  { titulo: 'Revisão', link: '/admin/revisao', status: ['aprovado', 'aguardando_correcoes', 'correcoes_enviadas'], destaque: 'correcoes_enviadas' },
  { titulo: 'Diagramação e publicação', link: '/admin/publicacao', status: ['em_diagramacao', 'aguardando_publicacao', 'publicado'] },
  { titulo: 'Encerradas', link: '/admin/submissoes?status=reprovado', status: ['reprovado'] },
];

const MODO = { batch: 'Batch API (lote)', direto: 'Chamadas diretas', demonstracao: 'Demonstração (sem chave)', desligado: 'Desligada: falta a OPENAI_API_KEY' };

export default function Painel() {
  const [r, setR] = useState(null);
  const [erro, setErro] = useState('');
  const [rodando, setRodando] = useState(false);
  const carregar = () => api.admin.resumo().then(setR).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  if (!r) return erro ? <div className="alert error">{erro}</div> : <div className="carregando"><span className="spinner" /></div>;
  const n = (s) => r.porStatus[s] || 0;
  const m = r.motor;

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Administração</div>
        <h2>Painel</h2>
        <p>Onde está cada texto agora, e o estado da avaliação por IA.</p>
        <div className="ornament" />
      </div>

      {m.modo === 'desligado' && (
        <div className="alert error">
          A avaliação por IA está desligada: falta a variável <code>OPENAI_API_KEY</code> no servidor. Os textos enviados ficam na fila e são avaliados assim que a chave for configurada.
        </div>
      )}
      {m.promptsFaltando.length > 0 && (
        <div className="alert warn">
          A avaliação está parada: faltam prompts válidos ({m.promptsFaltando.join(', ')}). <Link to="/admin/prompts">Abrir prompts</Link>.
        </div>
      )}

      <div className="painel-blocos">
        {BLOCOS.map((b) => (
          <Link key={b.titulo} to={b.link} className="card painel-bloco">
            <div className="painel-bloco-titulo">{b.titulo}</div>
            {b.status.map((s) => (
              <div key={s} className={`painel-linha ${b.destaque === s && n(s) ? 'chama' : ''}`}>
                <span>{r.rotulos[s]}</span><strong>{n(s)}</strong>
              </div>
            ))}
          </Link>
        ))}
      </div>

      <div className="painel-duas">
        <div className="card">
          <h3 className="card-titulo">Avaliação por IA</h3>
          <dl className="dl-linhas">
            <dt>Modo</dt><dd>{MODO[m.modo] || m.modo}</dd>
            {m.modelo && <><dt>Modelo</dt><dd>{m.modelo} · esforço {m.effort.no || '—'} / sintetizador {m.effort.sintetizador || '—'}</dd></>}
            <dt>Na fila</dt><dd>{m.fila.na_fila || 0}</dd>
            <dt>Em andamento</dt><dd>{m.emAndamentoPorFase.portao || 0} no portão (regras do edital) · {m.emAndamentoPorFase.criterios || 0} nos critérios 1–9</dd>
            <dt>Em lote</dt><dd>{m.fila.em_lote || 0} ({m.lotesEmVoo.length} lote{m.lotesEmVoo.length === 1 ? '' : 's'} em andamento)</dd>
            <dt>Com erro</dt><dd>{m.fila.erro || 0}</dd>
            <dt>Último ciclo</dt><dd>{dataHora(m.ultimoCiclo)}{m.rodando ? ' · rodando agora' : ''}</dd>
          </dl>
          {m.ultimoErro && <div className="alert error">Último erro do varredor: {m.ultimoErro}</div>}
          {m.lotesEmVoo.length > 0 && (
            <table className="admin-table compacta">
              <thead><tr><th>Lote</th><th>Requisições</th><th>Status</th><th>Criado</th></tr></thead>
              <tbody>{m.lotesEmVoo.map((l) => <tr key={l.batch_id}><td className="mono">{l.batch_id}</td><td>{l.requisicoes}</td><td>{l.status}</td><td>{dataHora(l.criado_em)}</td></tr>)}</tbody>
            </table>
          )}
          <button
            className="btn btn-outline btn-sm"
            disabled={rodando}
            onClick={async () => { setRodando(true); try { await api.admin.rodarCiclo(); await carregar(); } finally { setRodando(false); } }}
          >
            {rodando ? 'Rodando…' : 'Submeter e coletar agora'}
          </button>
          <p className="campo-ajuda" style={{ marginTop: 8 }}>
            O varredor roda sozinho de tempos em tempos: submete à OpenAI o que está na fila e coleta os lotes prontos.
          </p>
        </div>

        <div className="card">
          <h3 className="card-titulo">Editais</h3>
          {!r.editais.length && <p>Nenhum edital ainda. <Link to="/admin/editais/novo">Criar o primeiro</Link>.</p>}
          {r.editais.map((e) => (
            <Link key={e.id} to={`/admin/editais/${e.id}`} className="painel-edital">
              <span>{e.titulo}</span>
              <span className={`situacao-pill sit-${e.situacao}`}>{SITUACAO_EDITAL[e.situacao]}</span>
              <span className="painel-edital-num">{e.inscritos} inscritos · {e.textos} textos</span>
            </Link>
          ))}
          <h3 className="card-titulo" style={{ marginTop: 22 }}>E-mail</h3>
          <p>
            {r.emails.configurado ? 'Envio pela Microsoft Graph configurado.' : 'Envio ainda não configurado (Microsoft Entra): os e-mails ficam registrados, sem sair.'}
            {r.emails.naoEnviados > 0 && <> <Link to="/admin/emails">{r.emails.naoEnviados} e-mail(s) não enviados</Link>.</>}
          </p>
        </div>
      </div>
    </div>
  );
}
