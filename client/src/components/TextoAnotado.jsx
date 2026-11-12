import { useRef } from 'react';
import { segmentar, estiloDoSegmento, deslocamentoNoContainer } from '../lib/anotacoes';

// Texto somente leitura com as anotações pintadas por cima. Com `onSelecionar`,
// avisa o trecho selecionado (posições em caracteres) para o admin anotar.
// O container só tem o texto: nada de marcador dentro dele, senão as posições
// da seleção deixariam de bater com o texto (os marcadores são ::after no CSS).
export default function TextoAnotado({ texto, anotacoes = [], ativa, onAtivar, onSelecionar, apagado = false, className = '' }) {
  const ref = useRef(null);
  const segs = segmentar(texto || '', anotacoes);

  function aoSoltar() {
    if (!onSelecionar) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { onSelecionar(null); return; }
    const r = sel.getRangeAt(0);
    const c = ref.current;
    if (!c || !c.contains(r.startContainer) || !c.contains(r.endContainer)) return;
    let inicio = deslocamentoNoContainer(c, r.startContainer, r.startOffset);
    let fim = deslocamentoNoContainer(c, r.endContainer, r.endOffset);
    while (inicio < fim && /\s/.test(texto[inicio])) inicio++;
    while (fim > inicio && /\s/.test(texto[fim - 1])) fim--;
    if (fim <= inicio) { onSelecionar(null); return; }
    onSelecionar({ inicio, fim, rect: r.getBoundingClientRect() });
  }

  return (
    <div ref={ref} className={`doc-texto ${className}`} onMouseUp={aoSoltar} onKeyUp={aoSoltar}>
      {segs.map((s) => {
        if (!s.anotacoes.length) return s.texto;
        const { className: cls, style } = estiloDoSegmento(s.anotacoes, { ativa, apagado });
        const comNota = s.anotacoes.some((a) => a.comentario && a.fim === s.fim);
        const topo = s.anotacoes[s.anotacoes.length - 1];
        return (
          <span
            key={s.ini}
            className={`${cls}${comNota ? ' an-com-nota' : ''}`}
            style={style}
            data-ids={s.anotacoes.map((a) => a.id).join(' ')}
            onClick={onAtivar ? (e) => {
              if (!window.getSelection()?.isCollapsed) return;
              e.stopPropagation();
              onAtivar(topo.id);
            } : undefined}
          >
            {s.texto}
          </span>
        );
      })}
    </div>
  );
}
