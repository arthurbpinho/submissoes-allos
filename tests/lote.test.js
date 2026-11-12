// Caminho da Batch API com um cliente OpenAI falso, nas duas fases: lote do
// portão (critério 10) → quem passa volta para a fila → lote dos nove
// critérios → reparo do nó inválido → sintetizador. E as falhas de lote.
process.env.OPENAI_API_KEY = 'sk-teste-falso';
process.env.AVALIACAO_MODO = 'batch';
const h = require('./helpers');
// helpers zera a chave (modo demonstração); aqui o teste precisa dela.
process.env.OPENAI_API_KEY = 'sk-teste-falso';
const { api, bearer, avaliacao, loginAdmin, subirPrompts, textoDeTeste } = h;

const arquivos = new Map();
const entradas = []; // JSONL de cada lote criado, em ordem
let proximoStatus = 'completed';
let erroDoLote = null;
const chamadasDiretas = [];

function saidaDo(chave, developer) {
  if (chave === 'c10') return developer.includes('[[elimina]]') ? 'ANÁLISE: plágio reconhecível em "trecho".\nNOTA: 0' : 'ANÁLISE: nenhuma violação.\nNOTA: 2';
  if (chave === 'c3') return 'resposta sem formato'; // força o reparo síncrono
  return `ANÁLISE: análise de ${chave} com "trecho".\nFALTOU: algo.\nNOTA: 3`;
}

const fake = {
  files: {
    async create({ file }) {
      const id = `file-${arquivos.size + 1}`;
      arquivos.set(id, await file.text());
      return { id };
    },
    async content(id) {
      const linhas = arquivos.get(id.replace('out-', '')).trim().split('\n').map((l) => JSON.parse(l)).map((req) => JSON.stringify({
        custom_id: req.custom_id,
        response: { status_code: 200, body: {
          choices: [{ message: { content: saidaDo(req.custom_id.split('::')[1], req.body.messages[0].content) } }],
          usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 900 }, completion_tokens: 50 },
        } },
      }));
      return { text: async () => linhas.join('\n') };
    },
  },
  batches: {
    async create({ input_file_id }) {
      entradas.push(arquivos.get(input_file_id).trim().split('\n').map((l) => JSON.parse(l)));
      return { id: `batch-${input_file_id}`, status: 'validating' };
    },
    async retrieve(id) {
      const fileId = id.replace('batch-', '');
      if (proximoStatus === 'completed') return { id, status: 'completed', output_file_id: `out-${fileId}` };
      return { id, status: proximoStatus, errors: erroDoLote };
    },
  },
  chat: {
    completions: {
      async create(body) {
        chamadasDiretas.push(body);
        const texto = body.messages.length === 1 ? '**Sobre o seu texto**\nFeedback sintetizado.' : 'ANÁLISE: reparada.\nFALTOU: x.\nNOTA: 2';
        return { choices: [{ message: { content: texto } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
      },
    },
  },
};

let admin;
let edital;
beforeAll(async () => {
  avaliacao._setCliente(fake);
  admin = await loginAdmin();
  edital = (await api().post('/api/admin/editais').set(bearer(admin)).send({ titulo: 'Edital Lote', publicado: true })).body;
  await subirPrompts(admin);
});

let n = 0;
async function novoTexto(extra = '') {
  n += 1;
  const r = await api().post('/api/auth/cadastro').send({
    nome: 'Eva', sobrenome: 'Neri', curso: 'Psicologia', faculdade: 'PUC', periodo: '3º período',
    email: `eva${n}@exemplo.com`, senha: 'Revista#2026', consentimento: true, editalSlug: edital.slug,
  });
  await api().post(`/api/submissoes/${r.body.submissaoId}/texto`).set(bearer(r.body.token)).send({ conteudo: textoDeTeste(extra), nomeArquivo: 't.txt', consentimento: true });
  return r.body.submissaoId;
}
const detalhe = async (id) => (await api().get(`/api/admin/submissoes/${id}`).set(bearer(admin))).body;

it('fase 1: lote só com o portão; quem passa vai para o lote dos nove, com o mesmo prefixo', async () => {
  expect(avaliacao.modoAtual()).toBe('batch');
  const a = await novoTexto();
  const b = await novoTexto();
  await avaliacao.ciclo(); // submete o portão, coleta, reenfileira e submete a fase 2
  expect(entradas).toHaveLength(2);
  const [f1, f2] = entradas;
  expect(f1.map((l) => l.custom_id.split('::')[1])).toEqual(['c10', 'c10']);
  expect(f2).toHaveLength(18);
  expect(new Set(f2.map((l) => l.custom_id.split('::')[1]))).toEqual(new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']));
  // Mesmo prefixo (developer) na fase 1 e na fase 2 da mesma submissão, e a mesma cache key.
  const avA = (await detalhe(a)).avaliacoes[0].id;
  const daA = [...f1, ...f2].filter((l) => l.custom_id.startsWith(`av${avA}::`));
  expect(daA).toHaveLength(10);
  expect(new Set(daA.map((l) => l.body.messages[0].content)).size).toBe(1);
  expect(new Set(daA.map((l) => l.body.prompt_cache_key)).size).toBe(1);
  expect((await detalhe(a)).status).toBe('em_avaliacao');

  await avaliacao.ciclo(); // coleta a fase 2
  for (const id of [a, b]) {
    const d = await detalhe(id);
    expect(d.status).toBe('avaliado');
    const av = d.avaliacoes[0];
    expect(av).toMatchObject({ modo: 'batch', fase: 'criterios', status: 'concluida' });
    expect(av.portao.nota).toBe(2);
    expect(av.criterios.find((c) => c.numero === 3)).toMatchObject({ nota: 2, analise: 'reparada.' });
    expect(av.criterios.find((c) => c.numero === 1)).toMatchObject({ nota: 3, faltou: 'algo.' });
    expect(av.pontuacao.total).toBe(8 * 3 + 2);
    expect(av.feedbackIA).toMatch(/Feedback sintetizado/);
    expect(av.uso.cache).toBeGreaterThan(0);
  }
  // Síncronos: só o nó 3 reparado e o sintetizador, uma vez cada por submissão.
  expect(chamadasDiretas).toHaveLength(4);
});

it('portão 0 fecha a avaliação sem lote dos nove', async () => {
  const antes = entradas.length;
  const id = await novoTexto('[[elimina]]');
  await avaliacao.ciclo();
  expect(entradas.length).toBe(antes + 1);
  expect(entradas[entradas.length - 1]).toHaveLength(1);
  const d = await detalhe(id);
  expect(d.status).toBe('avaliado');
  expect(d.avaliacoes[0]).toMatchObject({ fase: 'portao', status: 'concluida', criterios: [] });
  expect(d.avaliacoes[0].pontuacao).toMatchObject({ eliminado: true, sugestao: 'eliminado' });
});

it('lote recusado por fila cheia volta para a fila, na mesma fase, sem contar tentativa', async () => {
  proximoStatus = 'failed';
  erroDoLote = { data: [{ code: 'token_limit_exceeded', message: 'Limit: 2,000,000 enqueued tokens' }] };
  const id = await novoTexto();
  await avaliacao.ciclo();
  let av = (await detalhe(id)).avaliacoes[0];
  expect(av).toMatchObject({ status: 'na_fila', fase: 'portao', tentativas: 0, batchId: null });
  proximoStatus = 'completed';
  await avaliacao.ciclo();
  await avaliacao.ciclo();
  av = (await detalhe(id)).avaliacoes[0];
  expect(av.status).toBe('concluida');
});

it('lote com erro definitivo marca a avaliação como erro', async () => {
  proximoStatus = 'failed';
  erroDoLote = { data: [{ code: 'invalid_request', message: 'modelo inexistente' }] };
  const id = await novoTexto();
  await avaliacao.ciclo();
  const d = await detalhe(id);
  expect(d.avaliacoes[0].status).toBe('erro');
  expect(d.avaliacoes[0].erro).toMatch(/modelo inexistente/);
  expect(d.status).toBe('em_avaliacao');
  proximoStatus = 'completed';
});
