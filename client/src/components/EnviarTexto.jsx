import { useRef, useState } from 'react';
import Consentimento from './Consentimento';
import { contarPalavras, lerTxt } from '../lib/util';

const LIMITE_BYTES = 400 * 1024;

// Anexo do texto em .txt + consentimento. Usado no painel (primeiro envio) e
// na correção (substituir o texto por um arquivo novo).
export function useArquivoTxt() {
  const [arquivo, setArquivo] = useState(null); // { nome, texto, palavras }
  const [erro, setErro] = useState('');

  async function escolher(file) {
    setErro('');
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) { setErro('O arquivo precisa ser .txt (texto sem formatação).'); return; }
    if (file.size > LIMITE_BYTES) { setErro('O arquivo é grande demais (limite de 400 KB).'); return; }
    const texto = (await lerTxt(file)).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!texto.trim()) { setErro('O arquivo está vazio.'); return; }
    setArquivo({ nome: file.name, texto, palavras: contarPalavras(texto) });
  }
  return { arquivo, erro, escolher, limpar: () => setArquivo(null), setErro };
}

export function SeletorTxt({ onEscolher, compacto = false }) {
  const input = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  return (
    <div
      className={`drop-txt ${arrastando ? 'arrastando' : ''} ${compacto ? 'compacto' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); onEscolher(e.dataTransfer.files[0]); }}
    >
      <input ref={input} type="file" accept=".txt,text/plain" hidden onChange={(e) => { onEscolher(e.target.files[0]); e.target.value = ''; }} />
      <p>{compacto ? 'Arraste um .txt ou' : 'Arraste o arquivo .txt para cá ou'}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()}>Escolher arquivo</button>
    </div>
  );
}

export function ComoSalvarTxt() {
  return (
    <details className="como-salvar">
      <summary>Como salvar o texto em .txt?</summary>
      <ul>
        <li><strong>Word:</strong> Arquivo → Salvar como → em “Tipo”, escolha <em>Texto sem formatação (.txt)</em>. Se perguntar a codificação, escolha <em>Unicode (UTF-8)</em>.</li>
        <li><strong>Google Docs:</strong> Arquivo → Fazer download → <em>Texto sem formatação (.txt)</em>.</li>
        <li><strong>LibreOffice:</strong> Arquivo → Salvar como → <em>Texto (.txt)</em>.</li>
      </ul>
    </details>
  );
}

export default function EnviarTexto({ edital, onEnviar }) {
  const { arquivo, erro, escolher, limpar, setErro } = useArquivoTxt();
  const [consentimento, setConsentimento] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const fora = arquivo && ((edital.palavrasMin && arquivo.palavras < edital.palavrasMin) || (edital.palavrasMax && arquivo.palavras > edital.palavrasMax));

  async function enviar() {
    if (!window.confirm('Enviar este texto? Depois do envio ele segue para avaliação e não pode ser trocado.')) return;
    setEnviando(true);
    setErro('');
    try {
      await onEnviar({ conteudo: arquivo.texto, nomeArquivo: arquivo.nome, consentimento: true });
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="enviar-texto">
      <div className="aviso-txt">
        <strong>Envie o texto em formato .txt.</strong> A formatação e a diagramação ficam por nossa conta:
        mesmo que você formate o texto, queremos apenas o texto escrito.
      </div>
      <ComoSalvarTxt />

      {!arquivo && <SeletorTxt onEscolher={escolher} />}

      {arquivo && (
        <div className="arquivo-escolhido">
          <div className="arquivo-topo">
            <div>
              <strong>{arquivo.nome}</strong>
              <span className="arquivo-meta"> · {arquivo.palavras.toLocaleString('pt-BR')} palavras</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={limpar}>Trocar arquivo</button>
          </div>
          {fora && (
            <div className="alert warn">
              O edital pede {edital.palavrasMin ? `no mínimo ${edital.palavrasMin}` : ''}
              {edital.palavrasMin && edital.palavrasMax ? ' e ' : ''}
              {edital.palavrasMax ? `no máximo ${edital.palavrasMax}` : ''} palavras. Confira antes de enviar.
            </div>
          )}
          <pre className="arquivo-previa">{arquivo.texto.slice(0, 1500)}{arquivo.texto.length > 1500 ? '\n…' : ''}</pre>
        </div>
      )}

      {erro && <div className="alert error">{erro}</div>}

      <Consentimento checked={consentimento} onChange={setConsentimento} editalSlug={edital.slug} id={`consent-envio-${edital.slug}`} />

      <button className="btn btn-primary" disabled={!arquivo || !consentimento || enviando} onClick={enviar}>
        {enviando ? 'Enviando…' : 'Enviar texto'}
      </button>
    </div>
  );
}
