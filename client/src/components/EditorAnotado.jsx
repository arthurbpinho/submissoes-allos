import { useEffect, useLayoutEffect, useRef } from 'react';
import { segmentar, estiloDoSegmento, regiaoAlterada, ajustarAnotacoes } from '../lib/anotacoes';

// Editor do autor: um <textarea> transparente sobre um "fundo" que desenha as
// mesmas letras invisíveis com as marcações do revisor. Os dois têm a mesma
// fonte, largura e quebra de linha, então as marcas ficam sob as palavras. A
// cada edição, as anotações se reposicionam (ajustarAnotacoes).
export default function EditorAnotado({ valor, anotacoes, onChange, ativa, onAtivar, irPara }) {
  const ta = useRef(null);
  const fundo = useRef(null);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [valor]);

  // Leva o cursor ao trecho de uma anotação (clique no cartão lateral).
  useEffect(() => {
    if (!irPara || !ta.current) return;
    const a = anotacoes.find((x) => x.id === irPara.id);
    if (!a || a.inicio == null || a.fim <= a.inicio) return;
    const alvo = fundo.current?.querySelector(`[data-ids~="${a.id}"]`);
    if (alvo) alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ta.current.focus({ preventScroll: true });
    ta.current.setSelectionRange(a.inicio, a.fim);
  }, [irPara]); // eslint-disable-line react-hooks/exhaustive-deps

  function mudar(e) {
    const novo = e.target.value;
    const { ini, fimAntigo, tamNovo } = regiaoAlterada(valor, novo);
    onChange(novo, ajustarAnotacoes(anotacoes, ini, fimAntigo, tamNovo));
  }

  function aoMoverCursor() {
    const el = ta.current;
    if (!el || !onAtivar) return;
    const p = el.selectionStart;
    const sob = anotacoes.filter((a) => a.inicio != null && a.inicio <= p && a.fim >= p && a.fim > a.inicio);
    if (sob.length) onAtivar(sob[sob.length - 1].id);
  }

  const segs = segmentar(valor, anotacoes);
  return (
    <div className="editor-anotado">
      <div ref={fundo} className="editor-fundo doc-texto" aria-hidden="true">
        {segs.map((s) => {
          if (!s.anotacoes.length) return s.texto;
          const { className, style } = estiloDoSegmento(s.anotacoes, { ativa });
          return <span key={s.ini} className={className} style={style} data-ids={s.anotacoes.map((a) => a.id).join(' ')}>{s.texto}</span>;
        })}
        {'​'}
      </div>
      <textarea
        ref={ta}
        className="editor-texto doc-texto"
        value={valor}
        onChange={mudar}
        onSelect={aoMoverCursor}
        spellCheck
        aria-label="Texto para corrigir"
      />
    </div>
  );
}
