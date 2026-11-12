const { api, bearer, avaliacao, loginAdmin, subirPrompts, textoDeTeste } = require('./helpers');

let admin;
let edital;

const cadastro = (over = {}) => ({
  nome: 'Ana', sobrenome: 'Lima', curso: 'Psicologia', faculdade: 'UFMG', periodo: '5º período',
  email: 'ana.lima@exemplo.com', senha: 'Revista#2026', consentimento: true, ...over,
});

async function cadastrar(over) {
  const r = await api().post('/api/auth/cadastro').send(cadastro({ editalSlug: edital.slug, ...over }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function enviarTexto(token, id, conteudo = textoDeTeste()) {
  return api().post(`/api/submissoes/${id}/texto`).set(bearer(token)).send({ conteudo, nomeArquivo: 'meu-texto.txt', consentimento: true });
}
const minhas = async (token) => (await api().get('/api/minhas-submissoes').set(bearer(token))).body;
const detalhe = async (id) => (await api().get(`/api/admin/submissoes/${id}`).set(bearer(admin))).body;

beforeAll(async () => {
  admin = await loginAdmin();
  const r = await api().post('/api/admin/editais').set(bearer(admin)).send({
    titulo: 'Edital Revista Allos 2026', revista: 'Revista Allos', chamada: 'Chamada de ensaios',
    corpo: '# Edital\n\nEnsaios sobre clínica.', resumo_ia: 'Ensaios sobre clínica psicológica.',
    palavras_min: 100, palavras_max: 5000, publicado: true,
  });
  expect(r.status).toBe(201);
  edital = r.body;
});

describe('editais e cadastro', () => {
  it('rascunho não aparece; publicado aparece na home', async () => {
    await api().post('/api/admin/editais').set(bearer(admin)).send({ titulo: 'Rascunho secreto' });
    const r = await api().get('/api/editais');
    expect(r.body.map((e) => e.titulo)).toEqual(['Edital Revista Allos 2026']);
    expect(r.body[0].situacao).toBe('abertas');
    expect((await api().get('/api/editais/rascunho-secreto')).status).toBe(404);
  });

  it('cadastro exige consentimento e senha forte', async () => {
    let r = await api().post('/api/auth/cadastro').send(cadastro({ editalSlug: edital.slug, consentimento: false }));
    expect(r.status).toBe(400);
    r = await api().post('/api/auth/cadastro').send(cadastro({ editalSlug: edital.slug, senha: 'ana#2026x' }));
    expect(r.body.error).toMatch(/nome de usuário/);
    r = await api().post('/api/auth/cadastro').send(cadastro({ editalSlug: edital.slug, periodo: '99º' }));
    expect(r.status).toBe(400);
  });

  it('edital fechado na chave recusa inscrição', async () => {
    await api().patch(`/api/admin/editais/${edital.id}`).set(bearer(admin)).send({ inscricoes_abertas: false });
    const r = await api().post('/api/auth/cadastro').send(cadastro({ editalSlug: edital.slug, email: 'x@exemplo.com' }));
    expect(r.status).toBe(409);
    await api().patch(`/api/admin/editais/${edital.id}`).set(bearer(admin)).send({ inscricoes_abertas: true });
  });
});

describe('fluxo completo: envio → avaliação → aprovação → revisão → correção → publicação', () => {
  let autor;
  let subId;

  it('cadastra e inscreve no edital', async () => {
    const r = await cadastrar();
    autor = r.token;
    subId = r.submissaoId;
    const [s] = await minhas(autor);
    expect(s).toMatchObject({ status: 'nenhum_texto', podeEnviarTexto: true });
    // e-mail repetido
    const dup = await api().post('/api/auth/cadastro').send(cadastro({ editalSlug: edital.slug }));
    expect(dup.status).toBe(409);
  });

  it('envia o .txt (com consentimento) e recebe o e-mail 1', async () => {
    let r = await api().post(`/api/submissoes/${subId}/texto`).set(bearer(autor)).send({ conteudo: textoDeTeste(), nomeArquivo: 'a.txt' });
    expect(r.status).toBe(400);
    r = await api().post(`/api/submissoes/${subId}/texto`).set(bearer(autor)).send({ conteudo: textoDeTeste(), nomeArquivo: 'a.docx', consentimento: true });
    expect(r.body.error).toMatch(/\.txt/);
    r = await enviarTexto(autor, subId);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('enviado');
    expect((await enviarTexto(autor, subId)).status).toBe(409);
    const d = await detalhe(subId);
    expect(d.emails.map((e) => e.tipo)).toEqual(['texto_enviado']);
  });

  it('fila parada sem prompts; com prompts a avaliação roda e para em "aguardando decisão"', async () => {
    await avaliacao.ciclo();
    expect((await detalhe(subId)).status).toBe('enviado');
    await subirPrompts(admin);
    await avaliacao.ciclo();
    const d = await detalhe(subId);
    expect(d.status).toBe('avaliado');
    const av = d.avaliacoes[0];
    expect(av.status).toBe('concluida');
    expect(av.portao.nota).toBe(2);
    expect(av.criterios).toHaveLength(9);
    expect(av.criterios.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(av.criterios[0].faltou).toBeTruthy();
    const pt = av.pontuacao;
    expect(pt.totalMax).toBe(45);
    expect(pt.tercos.map((t) => t.id)).toEqual(['relevancia', 'rigor', 'escrita']);
    expect(pt.total).toBe(pt.tercos.reduce((s, t) => s + t.valor, 0));
    expect(pt).toMatchObject({ portao: 2, eliminado: false, conferirRegra: false, faixaTotal: null }); // lote de 1: sem cor
    expect(av.feedbackIA).toBeTruthy();
    expect(d.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(['portao_concluido', 'avaliacao_concluida']));
    // O autor ainda vê "em avaliação" e nenhum feedback.
    const [s] = await minhas(autor);
    expect(s).toMatchObject({ status: 'em_avaliacao', feedback: null });
  });

  it('admin aprova com feedback editado: autor vê o feedback e recebe o e-mail 2', async () => {
    const previa = await api().post(`/api/admin/submissoes/${subId}/previa-email`).set(bearer(admin))
      .send({ decisao: 'aprovado', feedback: 'Feedback editado pela equipe, com detalhes.', observacoes: 'Revise a conclusão.' });
    expect(previa.body.texto).toMatch(/Revise a conclusão/);
    const r = await api().post(`/api/admin/submissoes/${subId}/decisao`).set(bearer(admin))
      .send({ decisao: 'aprovado', feedback: 'Feedback editado pela equipe, com detalhes.', observacoes: 'Revise a conclusão.' });
    expect(r.status).toBe(200);
    const [s] = await minhas(autor);
    expect(s).toMatchObject({ status: 'aprovado', decisao: 'aprovado', feedback: 'Feedback editado pela equipe, com detalhes.', observacoes: 'Revise a conclusão.' });
    expect((await api().post(`/api/admin/submissoes/${subId}/decisao`).set(bearer(admin)).send({ decisao: 'reprovado', feedback: 'x'.repeat(30) })).status).toBe(409);
  });

  let texto;
  let anotacoes;
  it('admin anota e envia a correção (e-mail 3)', async () => {
    const rev = await api().get(`/api/admin/revisao/${subId}`).set(bearer(admin));
    expect(rev.body.podeRevisar).toBe(true);
    texto = rev.body.texto;
    const i = texto.indexOf('Esta é uma frase');
    anotacoes = [
      { id: 'anot0001', inicio: i, fim: i + 4, tipo: 'destaque', cor: 'azul', comentario: 'Troque "Esta" por "Esta aqui".' },
      { id: 'anot0002', inicio: 0, fim: 6, tipo: 'comentario', comentario: '' },
    ];
    // rascunho aceita comentário vazio; envio não
    expect((await api().put(`/api/admin/revisao/${subId}`).set(bearer(admin)).send({ anotacoes, observacoes: 'Bom texto.' })).status).toBe(200);
    let r = await api().post(`/api/admin/revisao/${subId}/enviar`).set(bearer(admin)).send({ anotacoes, observacoes: 'Bom texto.' });
    expect(r.status).toBe(400);
    anotacoes[1].comentario = 'Título pode ser mais específico.';
    r = await api().post(`/api/admin/revisao/${subId}/enviar`).set(bearer(admin)).send({ anotacoes, observacoes: 'Bom texto.' });
    expect(r.status).toBe(200);
    const d = await detalhe(subId);
    expect(d.status).toBe('aguardando_correcoes');
    expect(d.emails.map((e) => e.tipo)).toEqual(['texto_enviado', 'decisao_aprovado', 'correcao']);
  });

  it('autor vê as marcações em /correcao e envia o texto corrigido', async () => {
    const lista = await api().get('/api/correcoes').set(bearer(autor));
    expect(lista.body.map((s) => s.id)).toEqual([subId]);
    const c = await api().get(`/api/correcoes/${subId}`).set(bearer(autor));
    expect(c.body.anotacoes).toHaveLength(2);
    expect(c.body.observacoesRevisor).toBe('Bom texto.');
    const novo = texto.replace('Esta é uma frase', 'Esta aqui é uma frase');
    const r = await api().post(`/api/correcoes/${subId}`).set(bearer(autor)).send({
      conteudo: novo, consentimento: true, observacoes: 'Mantive o título: ele segue o edital.',
      anotacoes: [
        { id: 'anot0001', inicio: anotacoes[0].inicio, fim: anotacoes[0].inicio + 9, situacao: 'corrigido' },
        { id: 'anot0002', inicio: 0, fim: 6, situacao: 'mantido', resposta: 'O título segue o edital.' },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('correcoes_enviadas');
    expect((await api().get(`/api/correcoes/${subId}`).set(bearer(autor))).status).toBe(409);
  });

  it('admin vê a resposta, aceita e leva até a publicação', async () => {
    const rev = (await api().get(`/api/admin/revisao/${subId}`).set(bearer(admin))).body;
    expect(rev.rodadasAnteriores).toHaveLength(1);
    const r1 = rev.rodadasAnteriores[0];
    expect(r1.observacoesAutor).toMatch(/Mantive/);
    expect(r1.anotacoesResposta.map((a) => a.situacao)).toEqual(['mantido', 'corrigido']);
    expect(r1.textoResposta).toMatch(/Esta aqui é uma frase/);
    expect(rev.rodadaAtual.numero).toBe(2);
    expect((await api().post(`/api/admin/revisao/${subId}/aceitar`).set(bearer(admin))).status).toBe(200);

    expect((await api().post(`/api/admin/submissoes/${subId}/etapa`).set(bearer(admin)).send({ status: 'publicado', link: 'https://x.org' })).status).toBe(409);
    expect((await api().post(`/api/admin/submissoes/${subId}/etapa`).set(bearer(admin)).send({ status: 'aguardando_publicacao' })).status).toBe(200);
    expect((await api().post(`/api/admin/submissoes/${subId}/etapa`).set(bearer(admin)).send({ status: 'publicado' })).status).toBe(400);
    expect((await api().post(`/api/admin/submissoes/${subId}/etapa`).set(bearer(admin)).send({ status: 'publicado', link: 'https://revista.allos.org.br/artigo/1' })).status).toBe(200);
    const [s] = await minhas(autor);
    expect(s).toMatchObject({ status: 'publicado', linkPublicacao: 'https://revista.allos.org.br/artigo/1' });
    const d = await detalhe(subId);
    expect(d.versoes.map((v) => v.origem)).toEqual(['envio', 'correcao']);
    // A rodada 2 vazia não fica pendurada.
    expect(d.rodadas.map((r) => r.status)).toEqual(['encerrada']);
  });
});

describe('portão (regras do edital) e reprovação', () => {
  it('portão 1 segue para os nove critérios, com sinal para conferir a regra', async () => {
    const { token, submissaoId } = await cadastrar({ email: 'lia@exemplo.com', nome: 'Lia', sobrenome: 'Rios' });
    await enviarTexto(token, submissaoId, textoDeTeste('[[alerta]]'));
    await avaliacao.ciclo();
    const av = (await detalhe(submissaoId)).avaliacoes[0];
    expect(av.criterios).toHaveLength(9);
    expect(av.pontuacao).toMatchObject({ portao: 1, conferirRegra: true, eliminado: false });
    const lista = (await api().get('/api/admin/submissoes?status=avaliado').set(bearer(admin))).body;
    expect(lista.find((x) => x.id === submissaoId).avaliacao.pontuacao.conferirRegra).toBe(true);
  });

  it('portão 0 elimina sem rodar os nove; o admin ainda decide; reprovado é final', async () => {
    const { token, submissaoId } = await cadastrar({ email: 'bruno@exemplo.com', nome: 'Bruno', sobrenome: 'Melo' });
    await enviarTexto(token, submissaoId, textoDeTeste('[[elimina]]'));
    await avaliacao.ciclo();
    const d = await detalhe(submissaoId);
    const av = d.avaliacoes[0];
    expect(d.status).toBe('avaliado'); // não reprova sozinho
    expect(av.criterios).toEqual([]);
    expect(av.portao.nota).toBe(0);
    expect(av.pontuacao).toMatchObject({ total: null, eliminado: true, sugestao: 'eliminado' });
    expect(av.feedbackIA).toBeTruthy();
    await api().post(`/api/admin/submissoes/${submissaoId}/decisao`).set(bearer(admin)).send({ decisao: 'reprovado', feedback: 'Encontramos referências que não pudemos confirmar.' });
    const [s] = await minhas(token);
    expect(s).toMatchObject({ status: 'reprovado', feedback: 'Encontramos referências que não pudemos confirmar.', observacoes: null });
    expect((await api().get(`/api/admin/revisao/${submissaoId}`).set(bearer(admin))).body.podeRevisar).toBe(false);
    const emails = (await api().get('/api/admin/emails').set(bearer(admin))).body;
    expect(emails.configurado).toBe(false);
    expect(emails.emails.find((e) => e.tipo === 'decisao_reprovado').estado).toBe('nao_configurado');
  });

  it('reavaliar só antes da decisão', async () => {
    const { token, submissaoId } = await cadastrar({ email: 'caio@exemplo.com', nome: 'Caio', sobrenome: 'Reis' });
    await enviarTexto(token, submissaoId);
    await avaliacao.ciclo();
    expect((await api().post(`/api/admin/submissoes/${submissaoId}/reavaliar`).set(bearer(admin))).status).toBe(200);
    expect((await detalhe(submissaoId)).status).toBe('enviado');
    await avaliacao.ciclo();
    const d = await detalhe(submissaoId);
    expect(d.status).toBe('avaliado');
    expect(d.avaliacoes).toHaveLength(2);
  });
});

describe('acesso', () => {
  it('autor não vê submissão alheia nem rotas de admin; sem token, 401', async () => {
    const { token } = await cadastrar({ email: 'dora@exemplo.com', nome: 'Dora', sobrenome: 'Paz' });
    expect((await api().get('/api/admin/submissoes').set(bearer(token))).status).toBe(403);
    expect((await api().get('/api/correcoes/1').set(bearer(token))).status).toBe(404);
    expect((await api().post('/api/submissoes/1/texto').set(bearer(token)).send({ conteudo: textoDeTeste(), consentimento: true })).status).toBe(404);
    expect((await api().get('/api/minhas-submissoes')).status).toBe(401);
    expect((await api().get('/api/minhas-submissoes').set(bearer(admin))).status).toBe(403);
  });

  it('login errado não diz se o e-mail existe', async () => {
    const a = await api().post('/api/auth/login').send({ login: 'ana.lima@exemplo.com', senha: 'errada' });
    const b = await api().post('/api/auth/login').send({ login: 'ninguem@exemplo.com', senha: 'errada' });
    expect(a.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });
});
