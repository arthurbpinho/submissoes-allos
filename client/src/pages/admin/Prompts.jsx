import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { dataHora } from '../../lib/util';

// Os prompts do pipeline moram no banco (nunca no repositório). O admin edita
// aqui ou sobe um .md. Cada salvamento vira uma versão nova; as avaliações
// gravam qual versão usaram.
export default function Prompts() {
  const [st, setSt] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);
  const carregar = () => api.admin.prompts().then(setSt).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  if (!st) return erro ? <div className="alert error">{erro}</div> : <div className="carregando"><span className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Configuração</div>
        <h2>Prompts da IA</h2>
        <p>
          Pipeline: metacomando → princípios → [edital + texto] (prefixo comum, cacheado) → fase 1: critério {st.portao}
          (Regras do edital, régua 0–2; nota 0 elimina e os outros não rodam) → fase 2: critérios 1–9 cegos em paralelo
          (régua 0–5) → total 0–45 em três terços → sintetizador.
        </p>
        <div className="ornament" />
      </div>
      {erro && <div className="alert error">{erro}</div>}

      <div className="prompts-slots">
        {st.slots.map((s) => (
          <div key={s.id} className="prompt-slot">
            <div className="prompt-slot-info">
              <div className="prompt-slot-nome">
                {s.nome}
                <span className={`prompt-status ${s.carregado && !s.problema ? 'ok' : 'falta'}`}>{!s.carregado ? 'falta' : s.problema ? 'com problema' : 'ok'}</span>
              </div>
              <div className="prompts-ajuda">{s.descricao}{s.exige.length ? <> Precisa conter: {s.exige.map((x) => <code key={x}>{x}</code>).reduce((a, b) => [a, ' ', b])}.</> : null}</div>
              {s.problema && <div className="prompt-problema">{s.problema}</div>}
              {s.carregado && <div className="prompt-enviado">{s.nomeArquivo ? `${s.nomeArquivo} · ` : ''}{s.por} · {dataHora(s.em)} · {s.tamanho.toLocaleString('pt-BR')} caracteres</div>}
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setAberto(aberto === s.id ? null : s.id)}>{aberto === s.id ? 'Fechar' : 'Editar'}</button>
            {aberto === s.id && <EditorPrompt slot={s} onSalvo={() => carregar()} />}
          </div>
        ))}
      </div>

      {!!st.criterios.length && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3 className="card-titulo">Critérios carregados</h3>
          <ol className="criterios-carregados">
            {st.criterios.map((c) => (
              <li key={c.numero}>
                <strong>{c.nome}</strong>
                <span className="celula-sub"> · {c.portao ? 'portão (régua 0–2)' : (st.tercos.find((t) => t.id === c.terco) || {}).nome}</span>
                <div className="celula-sub">{c.definicao}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function EditorPrompt({ slot, onSalvo }) {
  const [p, setP] = useState(null);
  const [texto, setTexto] = useState('');
  const [nomeArquivo, setNomeArquivo] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const input = useRef(null);

  const abrir = (versao) => api.admin.prompt(slot.id, versao).then((r) => { setP(r); setTexto(r.conteudo); setNomeArquivo(null); }).catch((e) => setErro(e.message));
  useEffect(() => { abrir(); }, [slot.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function salvar() {
    setErro(''); setAviso('');
    setSalvando(true);
    try {
      const r = await api.admin.salvarPrompt(slot.id, texto, nomeArquivo);
      setAviso(r.semMudanca ? 'Nada mudou.' : 'Salvo como nova versão. Vale para as próximas avaliações.');
      onSalvo();
      abrir();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }
  async function carregarArquivo(f) {
    if (!f) return;
    setTexto((await f.text()).replace(/\r\n/g, '\n'));
    setNomeArquivo(f.name);
  }

  if (!p) return <div className="prompt-editor"><span className="spinner" /></div>;
  return (
    <div className="prompt-editor">
      <div className="prompt-editor-barra">
        {p.historico.length > 0 && (
          <select className="select-compacto" value={p.versaoId || ''} onChange={(e) => abrir(e.target.value)}>
            {p.historico.map((h, i) => <option key={h.id} value={h.id}>{i === 0 ? 'Atual · ' : ''}{dataHora(h.criado_em)} · {h.por}{h.nome_arquivo ? ` · ${h.nome_arquivo}` : ''}</option>)}
          </select>
        )}
        <input ref={input} type="file" accept=".md,.txt,text/markdown,text/plain" hidden onChange={(e) => { carregarArquivo(e.target.files[0]); e.target.value = ''; }} />
        <button className="btn btn-ghost btn-sm" onClick={() => input.current?.click()}>Carregar .md</button>
      </div>
      <textarea className="prompt-textarea" value={texto} onChange={(e) => setTexto(e.target.value)} spellCheck={false} />
      {erro && <div className="alert error">{erro}</div>}
      {aviso && <div className="alert">{aviso}</div>}
      <div className="form-acoes">
        <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar nova versão'}</button>
      </div>
    </div>
  );
}
