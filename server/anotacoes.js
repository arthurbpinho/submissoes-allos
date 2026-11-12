// Anotações da revisão (destaque, sublinhado, tachado, comentário), em funções
// puras. Uma anotação aponta para um trecho do texto por posição de caractere:
// { id, inicio, fim, tipo, cor, comentario }.
//
// O admin anota uma versão; o autor edita o texto com as anotações à vista e,
// conforme digita, as posições são reajustadas (client/src/lib/anotacoes.js
// tem o mesmo `ajustarAnotacoes`). Aqui o servidor valida o que chega.

const TIPOS = ['destaque', 'sublinhado', 'tachado', 'comentario'];
const CORES = ['amarelo', 'verde', 'azul', 'rosa', 'laranja'];
const MAX_ANOTACOES = 500;
const MAX_COMENTARIO = 5000;
const MAX_RESPOSTA = 3000;

function inteiro(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// Valida as anotações do admin sobre `texto`. Devolve { anotacoes } ou { erro }.
// O `trecho` é recalculado aqui, nunca confiado ao cliente.
function validarAnotacoes(lista, texto, { exigirComentario = true } = {}) {
  if (!Array.isArray(lista)) return { erro: 'Anotações inválidas.' };
  if (lista.length > MAX_ANOTACOES) return { erro: `No máximo ${MAX_ANOTACOES} anotações por rodada.` };
  const t = String(texto || '');
  const ids = new Set();
  const saida = [];
  for (const a of lista) {
    if (!a || typeof a !== 'object') return { erro: 'Anotação inválida.' };
    const id = String(a.id || '').slice(0, 40);
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id) || ids.has(id)) return { erro: 'Anotação com identificador inválido.' };
    ids.add(id);
    const inicio = inteiro(a.inicio);
    const fim = inteiro(a.fim);
    if (inicio === null || fim === null || inicio < 0 || fim <= inicio || fim > t.length) {
      return { erro: 'Uma anotação aponta para um trecho que não existe no texto.' };
    }
    if (!TIPOS.includes(a.tipo)) return { erro: 'Tipo de anotação desconhecido.' };
    const cor = a.tipo === 'destaque' ? (CORES.includes(a.cor) ? a.cor : 'amarelo') : null;
    const comentario = String(a.comentario || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_COMENTARIO);
    if (exigirComentario && a.tipo === 'comentario' && !comentario) return { erro: 'Há um comentário vazio. Escreva o comentário ou apague a marcação.' };
    saida.push({ id, inicio, fim, tipo: a.tipo, cor, comentario, trecho: t.slice(inicio, fim).slice(0, 400) });
  }
  saida.sort((x, y) => x.inicio - y.inicio || x.fim - y.fim);
  return { anotacoes: saida };
}

// Junta as anotações originais (do admin) com o que o autor devolveu: a nova
// posição no texto corrigido e a resposta opcional. Posição inválida vira
// `null` (o trecho foi apagado ou reescrito por inteiro).
function mesclarRespostas(originais, respostas, textoNovo) {
  const porId = new Map((Array.isArray(respostas) ? respostas : []).map((r) => [String(r && r.id), r]));
  const n = String(textoNovo || '').length;
  return originais.map((a) => {
    const r = porId.get(a.id) || {};
    let inicio = inteiro(r.inicio);
    let fim = inteiro(r.fim);
    if (inicio === null || fim === null || inicio < 0 || fim <= inicio || fim > n) { inicio = null; fim = null; }
    const situacao = ['corrigido', 'mantido'].includes(r.situacao) ? r.situacao : null;
    return {
      ...a,
      novoInicio: inicio,
      novoFim: fim,
      situacao,
      resposta: String(r.resposta || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_RESPOSTA),
    };
  });
}

// Reposiciona anotações depois de uma edição que trocou texto[ini, fimAntigo)
// por um trecho de `tamNovo` caracteres. É o mesmo algoritmo do cliente.
//   - anotação toda antes da edição: fica
//   - toda depois: desloca
//   - cruzando a edição: estica/encolhe para cobrir o que sobrou; se sumir, morre (inicio = fim)
function ajustarAnotacoes(anotacoes, ini, fimAntigo, tamNovo) {
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

// Diferença mínima entre duas strings: prefixo e sufixo comuns.
function regiaoAlterada(antes, depois) {
  let p = 0;
  const max = Math.min(antes.length, depois.length);
  while (p < max && antes[p] === depois[p]) p++;
  let s = 0;
  while (s < max - p && antes[antes.length - 1 - s] === depois[depois.length - 1 - s]) s++;
  return { ini: p, fimAntigo: antes.length - s, tamNovo: depois.length - s - p };
}

module.exports = {
  TIPOS,
  CORES,
  validarAnotacoes,
  mesclarRespostas,
  ajustarAnotacoes,
  regiaoAlterada,
};
