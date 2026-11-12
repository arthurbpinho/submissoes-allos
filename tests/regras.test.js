const regras = require('../server/regras');

describe('senha', () => {
  const u = { email: 'maria.souza@exemplo.com', nome: 'Maria', sobrenome: 'Souza' };
  const falhas = (s) => regras.checarSenha(s, u).filter((r) => !r.ok).map((r) => r.id);

  it('aceita uma senha que cumpre todas as regras', () => {
    expect(falhas('Revista#2026')).toEqual([]);
    expect(regras.erroDeSenha('Revista#2026', u)).toBeNull();
  });
  it('aponta cada regra que falta', () => {
    expect(falhas('abc')).toEqual(expect.arrayContaining(['tamanho', 'numero', 'simbolo']));
    expect(falhas('12345678!')).toContain('letra');
    expect(falhas('Revista2026')).toContain('simbolo');
    expect(falhas('Revista?2026')).toContain('simbolo'); // "?" não está na lista
  });
  it('recusa senha com o nome ou a parte local do e-mail, sem diferenciar acento e caixa', () => {
    expect(falhas('maria#2026')).toContain('usuario');
    expect(falhas('SOUZA-1234')).toContain('usuario');
    expect(falhas('x-maria.souza1')).toContain('usuario');
    expect(regras.checarSenha('Joao#2026', { nome: 'João' }).find((r) => r.id === 'usuario').ok).toBe(false);
  });
});

describe('situação do edital', () => {
  const agora = Date.parse('2026-06-15T12:00:00Z');
  const base = { publicado: 1, inscricoes_abertas: 1, abre_em: '2026-06-01T00:00:00Z', fecha_em: '2026-06-30T23:59:00Z' };
  it('calcula pelas datas e pela chave', () => {
    expect(regras.situacaoEdital({ ...base, publicado: 0 }, agora)).toBe('rascunho');
    expect(regras.situacaoEdital(base, agora)).toBe('abertas');
    expect(regras.situacaoEdital(base, Date.parse('2026-05-20T00:00:00Z'))).toBe('em_breve');
    expect(regras.situacaoEdital(base, Date.parse('2026-07-02T00:00:00Z'))).toBe('encerradas');
    expect(regras.situacaoEdital({ ...base, inscricoes_abertas: 0 }, agora)).toBe('encerradas');
    expect(regras.situacaoEdital({ ...base, visivel_ate: '2026-06-10T00:00:00Z' }, agora)).toBe('arquivado');
    expect(regras.situacaoEdital({ publicado: 1, inscricoes_abertas: 1 }, agora)).toBe('abertas');
  });
  it('valida o formulário', () => {
    expect(regras.validarEdital({ titulo: 'Ed' }).erro).toBeTruthy();
    expect(regras.validarEdital({ titulo: 'Edital 1', abre_em: '2026-07-01', fecha_em: '2026-06-01' }).erro).toMatch(/depois/);
    expect(regras.validarEdital({ titulo: 'Edital 1', palavras_min: 500, palavras_max: 100 }).erro).toMatch(/máximo/);
    const ok = regras.validarEdital({ titulo: 'Chamada Clínica & Sociedade' });
    expect(ok.dados.slug).toBe('chamada-clinica-sociedade');
    expect(ok.dados.limiar_descarte).toBeNull();
    expect(regras.validarEdital({ titulo: 'Edital 1', limiar_descarte: 50 }).erro).toMatch(/0 a 45/);
    expect(regras.validarEdital({ titulo: 'Edital 1', limiar_descarte: '12' }).dados.limiar_descarte).toBe(12);
  });
});

describe('texto enviado', () => {
  it('normaliza e conta palavras', () => {
    const v = regras.validarTextoEnviado({ conteudo: '﻿' + 'palavra '.repeat(60) + '\r\nfim  ', nomeArquivo: 'a.txt' });
    expect(v.erro).toBeUndefined();
    expect(v.texto.startsWith('palavra')).toBe(true);
    expect(v.texto.includes('\r')).toBe(false);
    expect(v.palavras).toBe(61);
  });
  it('recusa o que não é .txt ou é curto demais', () => {
    expect(regras.validarTextoEnviado({ conteudo: 'x '.repeat(100), nomeArquivo: 'a.docx' }).erro).toMatch(/\.txt/);
    expect(regras.validarTextoEnviado({ conteudo: 'curto', nomeArquivo: 'a.txt' }).erro).toMatch(/curto/);
  });
  it('mostra "avaliado" ao autor como "em avaliação"', () => {
    expect(regras.statusPublico('avaliado')).toBe('em_avaliacao');
    expect(regras.statusPublico('inscrito')).toBe('nenhum_texto');
  });
});

describe('modo da avaliação', () => {
  it('sem chave: demonstração em dev, desligado em produção (nunca inventa nota no ar)', () => {
    const avaliacao = require('../server/avaliacao');
    const antes = { k: process.env.OPENAI_API_KEY, n: process.env.NODE_ENV };
    delete process.env.OPENAI_API_KEY;
    process.env.NODE_ENV = 'development';
    expect(avaliacao.modoAtual()).toBe('demonstracao');
    process.env.NODE_ENV = 'production';
    expect(avaliacao.modoAtual()).toBe('desligado');
    process.env.OPENAI_API_KEY = 'sk-x';
    expect(avaliacao.modoAtual()).toBe('batch');
    process.env.NODE_ENV = antes.n;
    if (antes.k === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = antes.k;
  });
});
