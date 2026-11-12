require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { DB_FILE } = require('./paths');
const db = require('./db');
const regras = require('./regras');
const pipeline = require('./pipeline');
const avaliacao = require('./avaliacao');
const anotacoes = require('./anotacoes');
const email = require('./email');
const S = require('./servicos');

const { q, tx, agoraISO, json } = db;

db.abrir(process.env.NODE_ENV === 'test' && !process.env.DATA_DIR ? ':memory:' : DB_FILE);

const app = express();
app.set('trust proxy', 1);

// --- Segurança básica (mesma política do all_OS / allosvendas) ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'frame-src': ["'self'"],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
      ...(process.env.NODE_ENV === 'production' ? { 'upgrade-insecure-requests': [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  xFrameOptions: { action: 'sameorigin' },
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
}));
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
}
// O texto enviado chega como JSON (o navegador lê o .txt): folga para 400 KB de texto.
app.use(express.json({ limit: '1mb' }));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET ausente ou curto demais (mínimo 32 chars).');
  console.error('         Gere com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}
const TOKEN_TTL = '7d';
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;
const CONSENTIMENTO_VERSAO = 'v0-provisorio'; // trocar quando política, termos e edital de pesquisa tiverem páginas próprias

const SKIP_RATE_LIMIT = process.env.NODE_ENV === 'test';
const noop = (req, res, next) => next();
const limitador = (opts) => (SKIP_RATE_LIMIT ? noop : rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : S.clientIp(req) || 'desconhecido'),
  ...opts,
}));
const loginLimiter = limitador({ windowMs: 15 * 60 * 1000, max: 10, skipSuccessfulRequests: true, message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' } });
const cadastroLimiter = limitador({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Muitos cadastros a partir desta rede. Tente mais tarde.' } });
const envioLimiter = limitador({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Muitos envios em pouco tempo. Espere um pouco.' } });

avaliacao.configurar({ registrarErro: (err, onde, extra) => S.registrarErro(null, err, onde, { extra }) });

// ---------------------------------------------------------------------------
// Sementes: admin inicial e prompts locais
// ---------------------------------------------------------------------------

(function semearAdmin() {
  if (q.get("SELECT 1 FROM usuarios WHERE papel = 'admin' LIMIT 1")) return;
  const senha = process.env.ADMIN_INITIAL_PASSWORD;
  if (!senha || senha.length < 12) {
    console.error('[FATAL] ADMIN_INITIAL_PASSWORD ausente ou curta demais (mínimo 12 chars).');
    process.exit(1);
  }
  q.run(
    "INSERT INTO usuarios (papel, nome, username, senha_hash) VALUES ('admin', 'Administração Allos', 'admin', ?)",
    bcrypt.hashSync(senha, BCRYPT_ROUNDS),
  );
  console.log('[auth] conta admin criada. Login em /admin: admin / <ADMIN_INITIAL_PASSWORD>');
}());

// .prompts/<slot>.md ou .prompts/<slot>-qualquer-coisa.md → banco, só se o slot estiver vazio.
(function semearPrompts() {
  const origem = path.join(__dirname, '..', '.prompts');
  if (process.env.NODE_ENV === 'test' || !fs.existsSync(origem)) return;
  for (const f of fs.readdirSync(origem).filter((x) => x.endsWith('.md')).sort()) {
    const slot = pipeline.SLOT_IDS.find((id) => f === `${id}.md` || f.startsWith(`${id}-`));
    if (!slot || q.get('SELECT 1 FROM prompts WHERE slot = ?', slot)) continue;
    q.run("INSERT INTO prompts (slot, conteudo, nome_arquivo, por) VALUES (?, ?, ?, 'semente')", slot, fs.readFileSync(path.join(origem, f), 'utf-8').replace(/\r\n/g, '\n'), f);
    console.log(`[prompts] semeado de .prompts/: ${slot} (${f})`);
  }
}());

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

function usuarioPublico(u) {
  return {
    id: u.id,
    papel: u.papel,
    nome: u.nome,
    sobrenome: u.sobrenome,
    email: u.email,
    username: u.username,
    curso: u.curso,
    faculdade: u.faculdade,
    periodo: u.periodo,
  };
}

function assinar(u) {
  return jwt.sign({ id: u.id, papel: u.papel, tv: u.token_versao || 0 }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const expirada = () => res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
  if (!token) return expirada();
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const u = q.get('SELECT * FROM usuarios WHERE id = ?', p.id);
    if (!u || (u.token_versao || 0) !== p.tv) return expirada();
    req.user = u;
    next();
  } catch {
    return expirada();
  }
}
const soAdmin = (req, res, next) => (req.user.papel === 'admin' ? next() : res.status(403).json({ error: 'Acesso restrito à administração.' }));
const soAutor = (req, res, next) => (req.user.papel === 'autor' ? next() : res.status(403).json({ error: 'Esta área é de quem submete textos.' }));

const HASH_FALSO = bcrypt.hashSync('senha-que-nao-existe', 4);

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const login = String(req.body?.login || '').trim();
  const senha = String(req.body?.senha || '');
  const u = login ? q.get('SELECT * FROM usuarios WHERE email = ? OR username = ?', login, login) : null;
  // Compara mesmo sem usuário: o tempo de resposta não revela quem existe.
  const ok = await bcrypt.compare(senha, u ? u.senha_hash : HASH_FALSO);
  if (!u || !ok) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  res.json({ token: assinar(u), user: usuarioPublico(u) });
});

app.get('/api/auth/me', auth, (req, res) => res.json(usuarioPublico(req.user)));

// Inscreve um autor num edital (cria a submissão vazia). Idempotente.
function inscrever(autorId, edital) {
  const existente = q.get('SELECT id FROM submissoes WHERE edital_id = ? AND autor_id = ?', edital.id, autorId);
  if (existente) return existente.id;
  const r = q.run("INSERT INTO submissoes (edital_id, autor_id, status) VALUES (?, ?, 'inscrito')", edital.id, autorId);
  const id = Number(r.lastInsertRowid);
  S.evento(id, 'inscricao', edital.titulo, `autor#${autorId}`);
  return id;
}

function editalAbertoPorSlug(slug) {
  const e = q.get('SELECT * FROM editais WHERE slug = ?', String(slug || ''));
  if (!e) return { erro: 'Edital não encontrado.', status: 404 };
  const sit = regras.situacaoEdital(e);
  if (sit !== 'abertas') {
    return { erro: sit === 'em_breve' ? 'As inscrições deste edital ainda não abriram.' : 'As inscrições deste edital estão encerradas.', status: 409 };
  }
  return { edital: e };
}

const PERIODOS = [...Array.from({ length: 12 }, (_, i) => `${i + 1}º período`), 'Graduação concluída'];

app.post('/api/auth/cadastro', cadastroLimiter, async (req, res) => {
  const b = req.body || {};
  const dados = {
    nome: String(b.nome || '').trim().slice(0, 80),
    sobrenome: String(b.sobrenome || '').trim().slice(0, 120),
    curso: String(b.curso || '').trim().slice(0, 120),
    faculdade: String(b.faculdade || '').trim().slice(0, 160),
    periodo: String(b.periodo || '').trim(),
    email: String(b.email || '').trim().toLowerCase().slice(0, 254),
  };
  const senha = String(b.senha || '');
  if (!dados.nome || !dados.sobrenome) return res.status(400).json({ error: 'Informe nome e sobrenome.' });
  if (!dados.curso) return res.status(400).json({ error: 'Informe o curso de graduação.' });
  if (!dados.faculdade) return res.status(400).json({ error: 'Informe a faculdade.' });
  if (!PERIODOS.includes(dados.periodo)) return res.status(400).json({ error: 'Escolha o período da graduação.' });
  if (!regras.emailValido(dados.email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  const erroSenha = regras.erroDeSenha(senha, dados);
  if (erroSenha) return res.status(400).json({ error: erroSenha });
  if (b.consentimento !== true) return res.status(400).json({ error: 'É preciso concordar com a política de privacidade, os termos de uso e o edital.' });

  let edital = null;
  if (b.editalSlug) {
    const r = editalAbertoPorSlug(b.editalSlug);
    if (r.erro) return res.status(r.status).json({ error: r.erro });
    edital = r.edital;
  }
  const hash = await bcrypt.hash(senha, BCRYPT_ROUNDS);
  try {
    const resultado = tx(() => {
      if (q.get('SELECT 1 FROM usuarios WHERE email = ?', dados.email)) return null;
      const r = q.run(
        `INSERT INTO usuarios (papel, nome, sobrenome, email, curso, faculdade, periodo, senha_hash, consentimento_em, consentimento_versao)
         VALUES ('autor', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        dados.nome, dados.sobrenome, dados.email, dados.curso, dados.faculdade, dados.periodo, hash, agoraISO(), CONSENTIMENTO_VERSAO,
      );
      const id = Number(r.lastInsertRowid);
      const submissaoId = edital ? inscrever(id, edital) : null;
      return { u: q.get('SELECT * FROM usuarios WHERE id = ?', id), submissaoId };
    });
    if (!resultado) return res.status(409).json({ error: 'Já existe uma conta com este e-mail. Entre com a sua senha.' });
    res.status(201).json({ token: assinar(resultado.u), user: usuarioPublico(resultado.u), submissaoId: resultado.submissaoId });
  } catch (err) {
    res.status(500).json(S.falhou(req, err, 'auth/cadastro'));
  }
});

app.get('/api/periodos', (req, res) => res.json(PERIODOS));

// ---------------------------------------------------------------------------
// Público: editais
// ---------------------------------------------------------------------------

const ORDEM_SITUACAO = { abertas: 0, em_breve: 1, encerradas: 2 };

app.get('/api/editais', (req, res) => {
  const lista = q.all('SELECT * FROM editais WHERE publicado = 1')
    .map(S.editalPublico)
    .filter((e) => e.situacao in ORDEM_SITUACAO)
    .map(({ corpo, ...resto }) => resto)
    .sort((a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao]
      || String(a.fechaEm || '9999').localeCompare(String(b.fechaEm || '9999')));
  res.json(lista);
});

app.get('/api/editais/:slug', (req, res) => {
  const e = q.get('SELECT * FROM editais WHERE slug = ? AND publicado = 1', req.params.slug);
  const pub = S.editalPublico(e);
  if (!pub || pub.situacao === 'arquivado') return res.status(404).json({ error: 'Edital não encontrado.' });
  res.json(pub);
});

// ---------------------------------------------------------------------------
// Autor
// ---------------------------------------------------------------------------

app.post('/api/editais/:slug/participar', auth, soAutor, (req, res) => {
  const r = editalAbertoPorSlug(req.params.slug);
  if (r.erro) return res.status(r.status).json({ error: r.erro });
  const id = tx(() => inscrever(req.user.id, r.edital));
  res.status(201).json({ submissaoId: id });
});

app.get('/api/minhas-submissoes', auth, soAutor, (req, res) => {
  const lista = q.all('SELECT * FROM submissoes WHERE autor_id = ? ORDER BY criado_em DESC', req.user.id).map(S.visaoAutor);
  res.json(lista);
});

function minhaSubmissao(req) {
  const s = q.get('SELECT * FROM submissoes WHERE id = ? AND autor_id = ?', Number(req.params.id), req.user.id);
  return s || null;
}

app.post('/api/submissoes/:id/texto', auth, soAutor, envioLimiter, (req, res) => {
  const s = minhaSubmissao(req);
  if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
  if (req.body?.consentimento !== true) return res.status(400).json({ error: 'É preciso concordar com a política de privacidade, os termos de uso e o edital para enviar.' });
  const v = regras.validarTextoEnviado({ conteudo: req.body?.conteudo, nomeArquivo: req.body?.nomeArquivo });
  if (v.erro) return res.status(400).json({ error: v.erro });
  const edital = q.get('SELECT * FROM editais WHERE id = ?', s.edital_id);
  if (regras.situacaoEdital(edital) !== 'abertas') return res.status(409).json({ error: 'O prazo de envio deste edital está encerrado.' });
  try {
    const ok = tx(() => {
      const atual = q.get('SELECT status FROM submissoes WHERE id = ?', s.id);
      if (atual.status !== 'inscrito') return false;
      const agora = agoraISO();
      const rv = q.run(
        "INSERT INTO versoes (submissao_id, numero, conteudo, nome_arquivo, palavras, origem, consentimento_em) VALUES (?, 1, ?, ?, ?, 'envio', ?)",
        s.id, v.texto, String(req.body?.nomeArquivo || '').slice(0, 200) || null, v.palavras, agora,
      );
      const versaoId = Number(rv.lastInsertRowid);
      q.run("UPDATE submissoes SET status = 'enviado', versao_atual_id = ?, enviado_em = ?, atualizado_em = ? WHERE id = ?", versaoId, agora, agora, s.id);
      S.evento(s.id, 'texto_enviado', `${v.palavras} palavras`, S.quem(req.user));
      avaliacao.enfileirar(s.id, versaoId);
      S.enfileirarEmail({
        tipo: 'texto_enviado',
        para: req.user.email,
        submissaoId: s.id,
        mensagem: email.emailTextoEnviado({ nome: req.user.nome, edital: edital.titulo }),
      });
      return true;
    });
    if (!ok) return res.status(409).json({ error: 'O texto desta submissão já foi enviado.' });
    S.despacharEmails();
    avaliacao.cutucar();
    res.status(201).json(S.visaoAutor(q.get('SELECT * FROM submissoes WHERE id = ?', s.id)));
  } catch (err) {
    res.status(500).json(S.falhou(req, err, 'autor/enviar-texto'));
  }
});

// Correções: a rodada aberta, com o texto anotado.
app.get('/api/correcoes', auth, soAutor, (req, res) => {
  const lista = q.all("SELECT * FROM submissoes WHERE autor_id = ? AND status = 'aguardando_correcoes'", req.user.id)
    .map(S.visaoAutor)
    .filter((x) => x.correcaoPendente);
  res.json(lista);
});

app.get('/api/correcoes/:id', auth, soAutor, (req, res) => {
  const s = minhaSubmissao(req);
  if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
  const r = s.status === 'aguardando_correcoes' ? S.rodadaAberta(s.id) : null;
  if (!r) return res.status(409).json({ error: 'Não há correções pendentes neste texto.' });
  const versao = q.get('SELECT conteudo, numero FROM versoes WHERE id = ?', r.versao_id);
  res.json({
    submissao: S.visaoAutor(s),
    rodada: r.numero,
    texto: versao.conteudo,
    anotacoes: json(r.anotacoes, []).map(({ id, inicio, fim, tipo, cor, comentario }) => ({ id, inicio, fim, tipo, cor, comentario })),
    observacoesRevisor: r.observacoes_admin || '',
    enviadaEm: r.enviada_em,
  });
});

app.post('/api/correcoes/:id', auth, soAutor, envioLimiter, (req, res) => {
  const s = minhaSubmissao(req);
  if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
  if (req.body?.consentimento !== true) return res.status(400).json({ error: 'É preciso concordar com a política de privacidade, os termos de uso e o edital para enviar.' });
  const v = regras.validarTextoEnviado({ conteudo: req.body?.conteudo, nomeArquivo: req.body?.nomeArquivo });
  if (v.erro) return res.status(400).json({ error: v.erro });
  const observacoes = String(req.body?.observacoes || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
  try {
    const ok = tx(() => {
      const atual = q.get('SELECT status FROM submissoes WHERE id = ?', s.id);
      const r = atual.status === 'aguardando_correcoes' ? S.rodadaAberta(s.id) : null;
      if (!r) return false;
      const agora = agoraISO();
      const numero = (q.get('SELECT MAX(numero) AS n FROM versoes WHERE submissao_id = ?', s.id).n || 0) + 1;
      const rv = q.run(
        "INSERT INTO versoes (submissao_id, numero, conteudo, nome_arquivo, palavras, origem, consentimento_em) VALUES (?, ?, ?, ?, ?, 'correcao', ?)",
        s.id, numero, v.texto, String(req.body?.nomeArquivo || '').slice(0, 200) || null, v.palavras, agora,
      );
      const versaoId = Number(rv.lastInsertRowid);
      const mescladas = anotacoes.mesclarRespostas(json(r.anotacoes, []), req.body?.anotacoes, v.texto);
      q.run(
        "UPDATE rodadas SET status = 'respondida', resposta_versao_id = ?, anotacoes_resposta = ?, observacoes_autor = ?, respondida_em = ? WHERE id = ?",
        versaoId, JSON.stringify(mescladas), observacoes, agora, r.id,
      );
      q.run("UPDATE submissoes SET status = 'correcoes_enviadas', versao_atual_id = ?, atualizado_em = ? WHERE id = ?", versaoId, agora, s.id);
      S.evento(s.id, 'correcoes_enviadas', `rodada ${r.numero} · versão ${numero}`, S.quem(req.user));
      return true;
    });
    if (!ok) return res.status(409).json({ error: 'Não há correções pendentes neste texto.' });
    res.json(S.visaoAutor(q.get('SELECT * FROM submissoes WHERE id = ?', s.id)));
  } catch (err) {
    res.status(500).json(S.falhou(req, err, 'autor/enviar-correcoes'));
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

require('./rotas-admin')(app, { auth, soAdmin, BCRYPT_ROUNDS });

// --- Front-end (build do Vite) ---
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Erro não tratado numa rota (ex.: JSON malformado): resposta genérica + código.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'O conteúdo enviado é grande demais.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requisição inválida.' });
  res.status(500).json(S.falhou(req, err, 'express'));
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  avaliacao.iniciarVarredor();
  // E-mails que ficaram pendentes (queda no meio do envio) saem no boot.
  S.despacharEmails();
  if (!email.estaConfigurado()) console.warn('[email] Graph não configurado: e-mails ficam registrados em Admin → E-mails, sem envio.');
  app.listen(PORT, () => console.log(`Submissões Allos rodando na porta ${PORT}`));
}

module.exports = { app };
