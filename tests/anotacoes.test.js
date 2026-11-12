const { ajustarAnotacoes, regiaoAlterada, validarAnotacoes, mesclarRespostas } = require('../server/anotacoes');

// Aplica uma edição como a tela faz: compara antes/depois e reposiciona.
function editar(antes, depois, anotacoes) {
  const { ini, fimAntigo, tamNovo } = regiaoAlterada(antes, depois);
  return ajustarAnotacoes(anotacoes, ini, fimAntigo, tamNovo);
}
const trecho = (t, a) => t.slice(a.inicio, a.fim);

describe('reposicionamento das anotações', () => {
  const t = 'O gato subiu no telhado ontem.';
  const a = { id: 'a1', inicio: 2, fim: 6 }; // "gato"

  it('digitar antes do trecho empurra a anotação', () => {
    const depois = `Ontem, ${t}`;
    const [r] = editar(t, depois, [a]);
    expect(trecho(depois, r)).toBe('gato');
  });
  it('digitar depois do trecho não mexe nele', () => {
    const depois = t.replace('ontem', 'anteontem');
    const [r] = editar(t, depois, [a]);
    expect(r).toEqual(a);
  });
  it('trocar a palavra marcada mantém a marcação sobre a palavra nova', () => {
    const depois = t.replace('gato', 'cachorro');
    const [r] = editar(t, depois, [a]);
    expect(trecho(depois, r)).toBe('cachorro');
    expect(r.editada).toBe(true);
  });
  it('inserir no meio do trecho estica a marcação', () => {
    const b = { id: 'b', inicio: 2, fim: 15 }; // "gato subiu no"
    const depois = t.replace('subiu', 'subiu rápido');
    const [r] = editar(t, depois, [b]);
    expect(trecho(depois, r)).toBe('gato subiu rápido no');
  });
  it('selecionar o trecho e digitar por cima, tecla a tecla, mantém a marcação sobre o texto novo', () => {
    let txt = t;
    let anots = [a];
    const passos = ['c', 'ca', 'cac', 'caco'];
    for (const p of passos) {
      const depois = `O ${p} subiu no telhado ontem.`;
      anots = editar(txt, depois, anots);
      txt = depois;
    }
    expect(trecho(txt, anots[0])).toBe('caco');
    // Depois de sair dali, digitar após o trecho em outro momento não o estica.
    const outro = { id: 'x', inicio: 2, fim: 6 };
    const [r] = editar(t, t.replace('gato', 'gato!'), [outro]);
    expect(trecho(t.replace('gato', 'gato!'), r)).toBe('gato');
  });
  it('apagar o trecho inteiro faz a marcação sumir (início = fim)', () => {
    const depois = t.replace('gato ', '');
    const [r] = editar(t, depois, [{ id: 'c', inicio: 2, fim: 7 }]);
    expect(r.fim).toBe(r.inicio);
  });
});

describe('validação e respostas', () => {
  const t = 'Um texto qualquer para anotar.';
  it('valida, recalcula o trecho e ordena', () => {
    const v = validarAnotacoes([
      { id: 'zz11', inicio: 9, fim: 17, tipo: 'destaque', cor: 'verde', trecho: 'mentira' },
      { id: 'aa11', inicio: 0, fim: 2, tipo: 'sublinhado' },
    ], t);
    expect(v.anotacoes.map((a) => a.id)).toEqual(['aa11', 'zz11']);
    expect(v.anotacoes[1].trecho).toBe('qualquer');
    expect(v.anotacoes[0].cor).toBeNull();
  });
  it('recusa posição fora do texto, tipo desconhecido e comentário vazio no envio', () => {
    expect(validarAnotacoes([{ id: 'aaaa', inicio: 0, fim: 999, tipo: 'destaque' }], t).erro).toBeTruthy();
    expect(validarAnotacoes([{ id: 'aaaa', inicio: 0, fim: 2, tipo: 'negrito' }], t).erro).toBeTruthy();
    expect(validarAnotacoes([{ id: 'aaaa', inicio: 0, fim: 2, tipo: 'comentario', comentario: ' ' }], t).erro).toMatch(/vazio/);
    expect(validarAnotacoes([{ id: 'aaaa', inicio: 0, fim: 2, tipo: 'comentario', comentario: '' }], t, { exigirComentario: false }).erro).toBeUndefined();
  });
  it('mescla a resposta do autor e anula posição inválida', () => {
    const orig = [{ id: 'a1', inicio: 0, fim: 2, tipo: 'destaque' }, { id: 'a2', inicio: 3, fim: 8, tipo: 'tachado' }];
    const m = mesclarRespostas(orig, [
      { id: 'a1', inicio: 0, fim: 2, situacao: 'corrigido' },
      { id: 'a2', inicio: null, fim: null, situacao: 'mantido', resposta: 'É uma citação literal.' },
    ], 'Um novo');
    expect(m[0]).toMatchObject({ novoInicio: 0, novoFim: 2, situacao: 'corrigido' });
    expect(m[1]).toMatchObject({ novoInicio: null, situacao: 'mantido', resposta: 'É uma citação literal.' });
  });
});
