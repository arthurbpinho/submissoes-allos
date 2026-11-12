// Etapas que o autor acompanha no painel.
const ETAPAS = [
  { id: 'enviado', rotulo: 'Texto enviado' },
  { id: 'em_avaliacao', rotulo: 'Em avaliação' },
  { id: 'resultado', rotulo: 'Resultado' },
  { id: 'correcoes', rotulo: 'Correções' },
  { id: 'em_diagramacao', rotulo: 'Diagramação' },
  { id: 'aguardando_publicacao', rotulo: 'Aguardando publicação' },
  { id: 'publicado', rotulo: 'Publicado' },
];

const INDICE = {
  nenhum_texto: -1,
  enviado: 0,
  em_avaliacao: 1,
  aprovado: 2,
  reprovado: 2,
  aguardando_correcoes: 3,
  correcoes_enviadas: 3,
  em_diagramacao: 4,
  aguardando_publicacao: 5,
  publicado: 6,
};

export default function StatusTimeline({ status }) {
  const atual = INDICE[status] ?? -1;
  const reprovado = status === 'reprovado';
  const etapas = reprovado ? ETAPAS.slice(0, 3) : ETAPAS;
  return (
    <ol className="timeline" aria-label="Etapas da submissão">
      {etapas.map((e, i) => {
        let estado = 'futura';
        if (i < atual || (i === atual && (status === 'publicado' || status === 'aprovado'))) estado = 'feita';
        else if (i === atual) estado = 'atual';
        if (reprovado && i === 2) estado = 'reprovada';
        const rotulo = e.id === 'resultado' && (status === 'aprovado' || atual > 2) ? 'Aprovado'
          : e.id === 'resultado' && reprovado ? 'Reprovado' : e.rotulo;
        return (
          <li key={e.id} className={`timeline-etapa ${estado}`}>
            <span className="timeline-ponto" aria-hidden="true" />
            <span className="timeline-rotulo">{rotulo}</span>
          </li>
        );
      })}
    </ol>
  );
}
