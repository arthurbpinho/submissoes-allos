const fs = require('fs');
const path = require('path');
const p = require('../server/pipeline');

const PROMPTS_DIR = path.join(__dirname, '..', '.prompts');
const temPrompts = fs.existsSync(path.join(PROMPTS_DIR, 'criterios.md'));

// Nomes genéricos: o repositório não carrega nada dos critérios reais (eles
// moram em .prompts/, fora do git, e no banco).
const NOMES = Array.from({ length: 10 }, (_, i) => `Critério de teste ${i + 1}`);
const docCriterios = `# Critérios\n\nIntro.\n\n${NOMES.map((n, i) => `## ${i + 1}. ${n}\n\n**${n}.** Mede algo do critério ${i + 1}.\n\n${'Parágrafo do bloco com conteúdo. '.repeat(6)}\n\nDesconfie de coisas.\n`).join('\n')}`;

describe('critérios', () => {
  it('lê o formato do documento: bloco = seção inteira, definição = 1º parágrafo, terço e portão', () => {
    const cs = p.parseCriterios(docCriterios);
    expect(cs).toHaveLength(10);
    expect(cs[0]).toMatchObject({ numero: 1, nome: 'Critério de teste 1', definicao: 'Mede algo do critério 1.', terco: 'relevancia', portao: false });
    expect(cs[0].bloco.startsWith('**Critério de teste 1.**')).toBe(true);
    expect(cs[0].bloco).toMatch(/Desconfie/);
    expect(cs[4].terco).toBe('rigor');
    expect(cs[8].terco).toBe('escrita');
    expect(cs[9]).toMatchObject({ numero: 10, portao: true, terco: null });
    expect(p.validarSlot('criterios', docCriterios)).toBeNull();
  });
  it('exige 10 critérios numerados de 1 a 10', () => {
    expect(p.validarSlot('criterios', docCriterios.split('## 10.')[0])).toMatch(/10 critérios/);
    expect(p.validarSlot('criterios', docCriterios.replace('## 10.', '## 11.'))).toMatch(/numerados/);
  });
});

describe('saídas dos nós', () => {
  it('critério 0–5: análise, faltou e nota', () => {
    const r = p.parseSaidaCriterio('**ANÁLISE:** O texto "abre bem".\nSegunda linha.\n**FALTOU:** uma objeção.\n**NOTA:** 3');
    expect(r).toMatchObject({ nota: 3, completo: true, faltou: 'uma objeção.' });
    expect(r.analise).toBe('O texto "abre bem".\nSegunda linha.');
    expect(p.parseSaidaCriterio('ANÁLISE: x\nNOTA: 0').nota).toBe(0);
    expect(p.parseSaidaCriterio('ANÁLISE: x\nNOTA: 6').completo).toBe(false);
    expect(p.parseSaidaCriterio('NOTA: 2').completo).toBe(false);
  });
  it('portão 0–2', () => {
    expect(p.parseSaidaCriterio('ANÁLISE: regra X disparou.\nNOTA: 0', 2)).toMatchObject({ nota: 0, completo: true });
    expect(p.parseSaidaCriterio('ANÁLISE: ok\nNOTA: 3', 2).completo).toBe(false);
  });
});

describe('agregador', () => {
  const notas = { 1: 2, 2: 3, 3: 1, 4: 2, 5: 2, 6: 2, 7: 4, 8: 3, 9: 3 };
  it('total 0–45 em três terços; sem nota de corte', () => {
    const a = p.agregar({ notasPorNumero: notas, portao: 2 });
    expect(a).toMatchObject({ total: 22, subtotais: { relevancia: 6, rigor: 6, escrita: 10 }, eliminado: false, conferirRegra: false, sugestao: null });
  });
  it('portão 1 sinaliza; portão 0 elimina; limiar de descarte', () => {
    expect(p.agregar({ notasPorNumero: notas, portao: 1 }).conferirRegra).toBe(true);
    expect(p.agregar({ notasPorNumero: {}, portao: 0 })).toMatchObject({ total: null, eliminado: true, sugestao: 'eliminado' });
    expect(p.agregar({ notasPorNumero: notas, portao: 2, limiarDescarte: 23 }).sugestao).toBe('descartar');
    expect(p.agregar({ notasPorNumero: notas, portao: 2, limiarDescarte: 22 }).sugestao).toBeNull();
  });
  it('faixas pela posição no lote (20% de cima e de baixo); precisa de 5 textos', () => {
    expect(p.faixasDoLote([10, 20, 30])).toBeNull();
    const lim = p.faixasDoLote([5, 10, 15, 20, 25, 30, 35, 40, 45, 12]);
    expect(p.faixa(40, lim)).toBe('topo');
    expect(p.faixa(10, lim)).toBe('base');
    expect(p.faixa(20, lim)).toBe('meio');
  });
});

describe('requisições por fase', () => {
  const prompts = { metacomando: 'META', principios: 'PRINC', regua: 'REGUA-GERAL', regua_portao: 'REGUA-PORTAO', criterios: '', sintetizador: '' };
  const criterios = p.parseCriterios(docCriterios);
  const args = {
    prompts, criterios, edital: { titulo: 'Ed', resumo_ia: 'Resumo', palavras_max: 3000 }, texto: 'TEXTO DO AUTOR', palavras: 3,
    model: 'gpt-6-luna', effort: 'high', cacheKey: 'sub-1',
  };
  const portao = p.requisicoesDaFase('portao', args);
  const nove = p.requisicoesDaFase('criterios', args);

  it('fase 1 só com o critério 10, com a régua do portão', () => {
    expect(portao.map((r) => r.chave)).toEqual(['c10']);
    const user = portao[0].body.messages[1].content;
    expect(user).toMatch(/REGUA-PORTAO/);
    expect(user).not.toMatch(/REGUA-GERAL/);
    expect(user).toMatch(/Critério de teste 10/);
  });
  it('fase 2 com os nove, régua geral, cegos; o mesmo prefixo nas duas fases', () => {
    expect(nove.map((r) => r.chave)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
    for (const r of nove) {
      expect(r.body.messages).toHaveLength(2);
      expect(r.body.messages[1].content).toMatch(/REGUA-GERAL/);
    }
    const devs = new Set([...portao, ...nove].map((r) => r.body.messages[0].content));
    expect(devs.size).toBe(1);
    const dev = [...devs][0];
    expect(dev.indexOf('META')).toBeLessThan(dev.indexOf('PRINC'));
    expect(dev.indexOf('PRINC')).toBeLessThan(dev.indexOf('TEXTO DO AUTOR'));
    expect(dev).toMatch(/máximo de 3000 palavras/);
    expect(nove[0].body).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'high', prompt_cache_key: 'sub-1' });
  });
});

(temPrompts ? describe : describe.skip)('prompts locais (.prompts/)', () => {
  it('todos os slots são válidos e os critérios são os do documento', () => {
    for (const slot of p.SLOT_IDS) {
      const f = fs.readdirSync(PROMPTS_DIR).find((x) => x === `${slot}.md` || x.startsWith(`${slot}-`));
      expect(f, slot).toBeTruthy();
      expect(p.validarSlot(slot, fs.readFileSync(path.join(PROMPTS_DIR, f), 'utf-8')), slot).toBeNull();
    }
    const cs = p.parseCriterios(fs.readFileSync(path.join(PROMPTS_DIR, 'criterios.md'), 'utf-8'));
    expect(cs.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cs[9].portao).toBe(true);
  });
  it('os blocos são o texto do documento, sem alteração', () => {
    const doc = fs.readFileSync(path.join(PROMPTS_DIR, 'Avaliador da revista — critérios.md'), 'utf-8');
    const nosso = p.parseCriterios(fs.readFileSync(path.join(PROMPTS_DIR, 'criterios.md'), 'utf-8'));
    const original = p.parseCriterios(doc.slice(doc.indexOf('## 1.')));
    expect(nosso.map((c) => c.bloco)).toEqual(original.map((c) => c.bloco));
  });
});
