// Pontuação do avaliador da revista: total 0–45, três terços de 0–15 e o
// portão (Regras do edital, 0/1/2). A cor vem da POSIÇÃO no lote do edital
// (20% de cima verde, 20% de baixo vermelho), não de uma escala fixa.
const FAIXA_TITULO = {
  topo: 'Entre os 20% mais altos do lote',
  base: 'Entre os 20% mais baixos do lote',
  meio: 'No meio do lote',
};

export function Pontos({ valor, max, faixa, rotulo, tamanho = 'md' }) {
  if (valor === null || valor === undefined) return null;
  return (
    <span className={`pontos pontos-${tamanho} ${faixa ? `faixa-${faixa}` : ''}`} title={faixa ? FAIXA_TITULO[faixa] : 'Cor pela posição no lote: aparece a partir de 5 textos avaliados no edital'}>
      {rotulo && <span className="pontos-rotulo">{rotulo}</span>}
      <strong>{valor}</strong><span className="pontos-max">/{max}</span>
    </span>
  );
}

const PORTAO = {
  0: { cls: 'p0', texto: 'Eliminado nas regras' },
  1: { cls: 'p1', texto: 'Conferir regra' },
  2: { cls: 'p2', texto: 'Regras ok' },
};
export function PortaoPill({ nota }) {
  const p = PORTAO[nota];
  if (!p) return null;
  return <span className={`portao-pill ${p.cls}`}>{p.texto}</span>;
}

export function SugestaoPill({ sugestao }) {
  if (sugestao !== 'descartar') return null;
  return <span className="portao-pill p0" title="Total abaixo do limiar de descarte do edital">abaixo do limiar</span>;
}

// Versão compacta, para as listas.
export function ResumoPontuacao({ p }) {
  if (!p) return null;
  return (
    <span className="resumo-pontuacao">
      {p.eliminado ? <PortaoPill nota={0} /> : (
        <>
          <Pontos valor={p.total} max={p.totalMax} faixa={p.faixaTotal} tamanho="sm" />
          {p.tercos && p.tercos.map((t) => (
            <Pontos key={t.id} valor={t.valor} max={t.max} faixa={t.faixa} rotulo={t.nome.slice(0, 3)} tamanho="xs" />
          ))}
          {p.conferirRegra && <PortaoPill nota={1} />}
          <SugestaoPill sugestao={p.sugestao} />
        </>
      )}
    </span>
  );
}
