// Diferença entre duas versões do texto, para o admin ver o que o autor mudou.
// Primeiro por linha (barato), depois por palavra dentro de cada trecho alterado.

function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ tipo: 'igual', v: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ tipo: 'del', v: a[i] }); i++; }
    else { out.push({ tipo: 'add', v: b[j] }); j++; }
  }
  while (i < n) out.push({ tipo: 'del', v: a[i++] });
  while (j < m) out.push({ tipo: 'add', v: b[j++] });
  return out;
}

const LIMITE = 2_500_000; // células da tabela; acima disso, fica no nível de linha

function juntar(partes) {
  const out = [];
  for (const p of partes) {
    const ult = out[out.length - 1];
    if (ult && ult.tipo === p.tipo) ult.texto += p.texto;
    else out.push({ tipo: p.tipo, texto: p.texto });
  }
  return out;
}

export function diffTextos(antes, depois) {
  const la = String(antes || '').split(/(?<=\n)/);
  const lb = String(depois || '').split(/(?<=\n)/);
  if (la.length * lb.length > LIMITE) {
    return [{ tipo: 'del', texto: antes }, { tipo: 'add', texto: depois }];
  }
  const porLinha = lcs(la, lb);
  const partes = [];
  let dels = [];
  let adds = [];
  const descarregar = () => {
    if (!dels.length && !adds.length) return;
    const a = dels.join('');
    const b = adds.join('');
    // Palavras, espaços e pontuação são peças separadas: "formação:" vira
    // "formação" + ":", e trocar só a pontuação não marca a palavra inteira.
    const pecas = (x) => x.split(/(\s+|[.,;:!?()"“”«»\[\]—–-])/).filter(Boolean);
    const ta = pecas(a);
    const tb = pecas(b);
    if (a && b && ta.length * tb.length <= LIMITE) {
      for (const p of lcs(ta, tb)) partes.push({ tipo: p.tipo, texto: p.v });
    } else {
      if (a) partes.push({ tipo: 'del', texto: a });
      if (b) partes.push({ tipo: 'add', texto: b });
    }
    dels = [];
    adds = [];
  };
  for (const p of porLinha) {
    if (p.tipo === 'igual') { descarregar(); partes.push({ tipo: 'igual', texto: p.v }); }
    else if (p.tipo === 'del') dels.push(p.v);
    else adds.push(p.v);
  }
  descarregar();
  return juntar(partes);
}
