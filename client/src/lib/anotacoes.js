// Anotações da revisão no navegador. `ajustarAnotacoes` e `regiaoAlterada`
// são as mesmas de server/anotacoes.js (testadas lá).

export const CORES = {
  amarelo: 'Amarelo',
  verde: 'Verde',
  azul: 'Azul',
  rosa: 'Rosa',
  laranja: 'Laranja',
};

export const TIPO_ROTULO = {
  destaque: 'Destaque',
  sublinhado: 'Sublinhado',
  tachado: 'Cortar',
  comentario: 'Comentário',
};

export function novoId() {
  const r = Math.random().toString(36).slice(2, 10);
  return `a${Date.now().toString(36)}${r}`;
}

export function regiaoAlterada(antes, depois) {
  let p = 0;
  const max = Math.min(antes.length, depois.length);
  while (p < max && antes[p] === depois[p]) p++;
  let s = 0;
  while (s < max - p && antes[antes.length - 1 - s] === depois[depois.length - 1 - s]) s++;
  return { ini: p, fimAntigo: antes.length - s, tamNovo: depois.length - s - p };
}

export function ajustarAnotacoes(anotacoes, ini, fimAntigo, tamNovo) {
  const delta = tamNovo - (fimAntigo - ini);
  const insercao = fimAntigo === ini;
  return anotacoes.map((a) => {
    if (a.inicio == null || a.fim <= a.inicio) return a;
    // Toda antes. Digitar logo depois do trecho não o estica, a não ser que a
    // pessoa esteja continuando uma reescrita feita DENTRO dele (selecionou o
    // trecho e digitou por cima: a 1ª tecla substitui tudo, as outras vêm aqui).
    if (a.fim <= ini) {
      if (insercao && a.fim === ini && a.cursor === ini) return { ...a, fim: a.fim + tamNovo, cursor: ini + tamNovo };
      return a;
    }
    // Toda depois (digitar logo antes do trecho o empurra).
    if (a.inicio >= fimAntigo) {
      return { ...a, inicio: a.inicio + delta, fim: a.fim + delta, ...(a.cursor != null ? { cursor: a.cursor + delta } : {}) };
    }
    // Cruza a edição: começa onde começava (ou no começo da edição) e termina
    // onde terminava (deslocado) ou no fim do trecho novo.
    const inicio = a.inicio < ini ? a.inicio : ini;
    const fim = a.fim > fimAntigo ? a.fim + delta : ini + tamNovo;
    return { ...a, inicio, fim: Math.max(fim, inicio), editada: true, cursor: ini + tamNovo };
  });
}

// Corta o texto nos limites das anotações: cada pedaço sabe quais anotações o cobrem.
export function segmentar(texto, anotacoes) {
  const validas = anotacoes.filter((a) => a.inicio != null && a.fim > a.inicio && a.fim <= texto.length);
  const cortes = new Set([0, texto.length]);
  for (const a of validas) { cortes.add(a.inicio); cortes.add(a.fim); }
  const pontos = [...cortes].sort((x, y) => x - y);
  const segs = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const ini = pontos[i];
    const fim = pontos[i + 1];
    if (fim <= ini) continue;
    const cobrem = validas.filter((a) => a.inicio <= ini && a.fim >= fim);
    segs.push({ ini, fim, texto: texto.slice(ini, fim), anotacoes: cobrem });
  }
  return segs;
}

// Estilo de um pedaço coberto por várias anotações: o destaque mais recente
// pinta o fundo; sublinhado e tachado se somam.
export function estiloDoSegmento(anotacoes, { ativa, apagado } = {}) {
  const linhas = [];
  let cor = null;
  let comentario = false;
  for (const a of anotacoes) {
    if (a.tipo === 'destaque') cor = a.cor || 'amarelo';
    if (a.tipo === 'sublinhado') linhas.push('underline');
    if (a.tipo === 'tachado') linhas.push('line-through');
    if (a.tipo === 'comentario') comentario = true;
  }
  const classes = ['an'];
  if (cor) classes.push(`an-cor-${cor}`);
  else if (comentario) classes.push('an-comentario');
  if (anotacoes.some((a) => a.id === ativa)) classes.push('an-ativa');
  if (apagado) classes.push('an-apagada');
  const style = linhas.length ? { textDecorationLine: [...new Set(linhas)].join(' ') } : undefined;
  return { className: classes.join(' '), style };
}

// Posição de um ponto da seleção, contada em caracteres do texto do container.
export function deslocamentoNoContainer(container, node, offset) {
  const r = document.createRange();
  r.setStart(container, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}
