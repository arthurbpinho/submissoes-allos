// Rotas do painel de administração (submissao.allos.org.br/admin).
const bcrypt = require('bcryptjs');
const { q, tx, agoraISO, json } = require('./db');
const regras = require('./regras');
const pipeline = require('./pipeline');
const avaliacao = require('./avaliacao');
const anotacoes = require('./anotacoes');
const email = require('./email');
const S = require('./servicos');

module.exports = function rotasAdmin(app, { auth, soAdmin, BCRYPT_ROUNDS }) {
  const A = [auth, soAdmin];
  const idParam = (req) => Number.parseInt(req.params.id, 10);
  const submissao = (id) => q.get('SELECT * FROM submissoes WHERE id = ?', id);

  // -------------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------------

  app.get('/api/admin/resumo', ...A, (req, res) => {
    const porStatus = Object.fromEntries(q.all('SELECT status, COUNT(*) AS n FROM submissoes GROUP BY status').map((r) => [r.status, r.n]));
    res.json({
      porStatus,
      rotulos: regras.STATUS_ADMIN_ROTULO,
      motor: avaliacao.resumo(),
      emails: {
        configurado: email.estaConfigurado(),
        naoEnviados: q.get("SELECT COUNT(*) AS n FROM emails WHERE estado IN ('falhou', 'nao_configurado')").n,
      },
      editais: q.all('SELECT * FROM editais ORDER BY criado_em DESC').map((e) => ({
        id: e.id, titulo: e.titulo, situacao: regras.situacaoEdital(e),
        inscritos: q.get('SELECT COUNT(*) AS n FROM submissoes WHERE edital_id = ?', e.id).n,
        textos: q.get("SELECT COUNT(*) AS n FROM submissoes WHERE edital_id = ? AND status <> 'inscrito'", e.id).n,
      })),
    });
  });

  app.post('/api/admin/avaliacao/ciclo', ...A, async (req, res) => {
    await avaliacao.ciclo();
    res.json(avaliacao.resumo());
  });

  // -------------------------------------------------------------------------
  // Editais
  // -------------------------------------------------------------------------

  const editalAdmin = (e) => ({ ...e, publicado: !!e.publicado, inscricoes_abertas: !!e.inscricoes_abertas, situacao: regras.situacaoEdital(e) });

  app.get('/api/admin/editais', ...A, (req, res) => {
    res.json(q.all('SELECT * FROM editais ORDER BY criado_em DESC').map((e) => ({
      ...editalAdmin(e),
      inscritos: q.get('SELECT COUNT(*) AS n FROM submissoes WHERE edital_id = ?', e.id).n,
      textos: q.get("SELECT COUNT(*) AS n FROM submissoes WHERE edital_id = ? AND status <> 'inscrito'", e.id).n,
    })));
  });

  app.get('/api/admin/editais/:id', ...A, (req, res) => {
    const e = q.get('SELECT * FROM editais WHERE id = ?', idParam(req));
    if (!e) return res.status(404).json({ error: 'Edital não encontrado.' });
    res.json(editalAdmin(e));
  });

  function slugLivre(slug, ignorarId = null) {
    let s = slug;
    for (let i = 2; q.get('SELECT 1 FROM editais WHERE slug = ? AND id IS NOT ?', s, ignorarId); i++) s = `${slug}-${i}`;
    return s;
  }

  app.post('/api/admin/editais', ...A, (req, res) => {
    const v = regras.validarEdital(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro });
    const d = { ...v.dados, slug: slugLivre(v.dados.slug) };
    const r = q.run(
      `INSERT INTO editais (slug, titulo, revista, chamada, corpo, resumo_ia, palavras_min, palavras_max, limiar_descarte,
         publicado, inscricoes_abertas, abre_em, fecha_em, visivel_ate)
       VALUES (:slug, :titulo, :revista, :chamada, :corpo, :resumo_ia, :palavras_min, :palavras_max, :limiar_descarte,
         :publicado, :inscricoes_abertas, :abre_em, :fecha_em, :visivel_ate)`,
      d,
    );
    res.status(201).json(editalAdmin(q.get('SELECT * FROM editais WHERE id = ?', Number(r.lastInsertRowid))));
  });

  app.put('/api/admin/editais/:id', ...A, (req, res) => {
    const id = idParam(req);
    if (!q.get('SELECT 1 FROM editais WHERE id = ?', id)) return res.status(404).json({ error: 'Edital não encontrado.' });
    const v = regras.validarEdital(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro });
    const d = { ...v.dados, slug: slugLivre(v.dados.slug, id), id, agora: agoraISO() };
    q.run(
      `UPDATE editais SET slug = :slug, titulo = :titulo, revista = :revista, chamada = :chamada, corpo = :corpo,
         resumo_ia = :resumo_ia, palavras_min = :palavras_min, palavras_max = :palavras_max, limiar_descarte = :limiar_descarte,
         publicado = :publicado, inscricoes_abertas = :inscricoes_abertas, abre_em = :abre_em, fecha_em = :fecha_em,
         visivel_ate = :visivel_ate, atualizado_em = :agora
       WHERE id = :id`,
      d,
    );
    res.json(editalAdmin(q.get('SELECT * FROM editais WHERE id = ?', id)));
  });

  // Chaves rápidas da lista: publicar/despublicar e abrir/fechar inscrições.
  app.patch('/api/admin/editais/:id', ...A, (req, res) => {
    const id = idParam(req);
    const e = q.get('SELECT * FROM editais WHERE id = ?', id);
    if (!e) return res.status(404).json({ error: 'Edital não encontrado.' });
    const pub = req.body?.publicado === undefined ? e.publicado : !!req.body.publicado;
    const abertas = req.body?.inscricoes_abertas === undefined ? e.inscricoes_abertas : !!req.body.inscricoes_abertas;
    q.run('UPDATE editais SET publicado = ?, inscricoes_abertas = ?, atualizado_em = ? WHERE id = ?', pub, abertas, agoraISO(), id);
    res.json(editalAdmin(q.get('SELECT * FROM editais WHERE id = ?', id)));
  });

  app.delete('/api/admin/editais/:id', ...A, (req, res) => {
    const id = idParam(req);
    if (q.get('SELECT 1 FROM submissoes WHERE edital_id = ? LIMIT 1', id)) {
      return res.status(409).json({ error: 'Este edital já tem inscritos. Despublique em vez de excluir.' });
    }
    const r = q.run('DELETE FROM editais WHERE id = ?', id);
    if (!r.changes) return res.status(404).json({ error: 'Edital não encontrado.' });
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Submissões
  // -------------------------------------------------------------------------

  app.get('/api/admin/submissoes', ...A, (req, res) => {
    const conds = [];
    const params = [];
    if (req.query.status) {
      const lista = String(req.query.status).split(',').filter((s) => regras.STATUS.includes(s));
      if (lista.length) { conds.push(`status IN (${lista.map(() => '?').join(',')})`); params.push(...lista); }
    }
    if (req.query.edital) { conds.push('edital_id = ?'); params.push(Number(req.query.edital)); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const cache = new Map();
    res.json(q.all(`SELECT * FROM submissoes ${where} ORDER BY atualizado_em DESC LIMIT 1000`, ...params).map((s) => S.resumoAdmin(s, cache)));
  });

  app.get('/api/admin/submissoes/:id', ...A, (req, res) => {
    const s = submissao(idParam(req));
    if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
    const autor = q.get('SELECT * FROM usuarios WHERE id = ?', s.autor_id);
    const edital = q.get('SELECT * FROM editais WHERE id = ?', s.edital_id);
    const versaoAtual = s.versao_atual_id ? q.get('SELECT * FROM versoes WHERE id = ?', s.versao_atual_id) : null;
    const decisor = s.decisao_por ? q.get('SELECT nome, username FROM usuarios WHERE id = ?', s.decisao_por) : null;
    res.json({
      ...S.resumoAdmin(s),
      autor: autor ? {
        id: autor.id, nome: S.nomeCompleto(autor), email: autor.email,
        curso: autor.curso, faculdade: autor.faculdade, periodo: autor.periodo, criadoEm: autor.criado_em,
      } : null,
      edital: { id: edital.id, titulo: edital.titulo, slug: edital.slug, limiarDescarte: edital.limiar_descarte, palavrasMin: edital.palavras_min, palavrasMax: edital.palavras_max },
      texto: versaoAtual ? versaoAtual.conteudo : null,
      versaoAtualId: s.versao_atual_id,
      versoes: q.all('SELECT id, numero, nome_arquivo, palavras, origem, criado_em FROM versoes WHERE submissao_id = ? ORDER BY numero', s.id),
      avaliacoes: (() => {
        const limites = S.limitesDoLote(s.edital_id);
        return q.all('SELECT * FROM avaliacoes WHERE submissao_id = ? ORDER BY id DESC', s.id).map((a) => S.avaliacaoAdmin(a, limites));
      })(),
      decisao: s.decisao,
      decisaoEm: s.decisao_em,
      decisaoPor: decisor ? (decisor.username || decisor.nome) : null,
      feedbackFinal: s.feedback_final,
      observacoesDecisao: s.observacoes_decisao,
      linkPublicacao: s.link_publicacao,
      publicadoEm: s.publicado_em,
      rodadas: q.all('SELECT * FROM rodadas WHERE submissao_id = ? ORDER BY numero', s.id).map(S.rodadaAdmin),
      eventos: q.all('SELECT tipo, detalhe, por, em FROM eventos WHERE submissao_id = ? ORDER BY id', s.id),
      emails: q.all('SELECT id, tipo, assunto, estado, criado_em, enviado_em FROM emails WHERE submissao_id = ? ORDER BY id', s.id),
    });
  });

  app.get('/api/admin/versoes/:id', ...A, (req, res) => {
    const v = q.get('SELECT * FROM versoes WHERE id = ?', idParam(req));
    if (!v) return res.status(404).json({ error: 'Versão não encontrada.' });
    res.json(v);
  });

  // Roda o pipeline de novo sobre a versão atual (erro, prompts novos…).
  app.post('/api/admin/submissoes/:id/reavaliar', ...A, (req, res) => {
    const s = submissao(idParam(req));
    if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
    if (!['enviado', 'em_avaliacao', 'avaliado'].includes(s.status)) {
      return res.status(409).json({ error: 'Só dá para reavaliar antes da decisão.' });
    }
    if (q.get("SELECT 1 FROM avaliacoes WHERE submissao_id = ? AND status IN ('na_fila', 'em_lote', 'executando')", s.id)) {
      return res.status(409).json({ error: 'Já existe uma avaliação em andamento para este texto.' });
    }
    tx(() => {
      avaliacao.enfileirar(s.id, s.versao_atual_id);
      q.run("UPDATE submissoes SET status = 'enviado', atualizado_em = ? WHERE id = ?", agoraISO(), s.id);
      S.evento(s.id, 'reavaliacao_pedida', null, S.quem(req.user));
    });
    avaliacao.cutucar();
    res.json({ ok: true });
  });

  function lerDecisao(body) {
    const decisao = body?.decisao;
    if (!['aprovado', 'reprovado'].includes(decisao)) return { erro: 'Escolha aprovar ou reprovar.' };
    const feedback = String(body?.feedback || '').replace(/\r\n/g, '\n').trim().slice(0, 30000);
    if (feedback.length < 20) return { erro: 'Escreva o feedback para o autor (o da IA pode ser usado como base).' };
    const observacoes = decisao === 'aprovado' ? String(body?.observacoes || '').replace(/\r\n/g, '\n').trim().slice(0, 20000) : '';
    return { decisao, feedback, observacoes };
  }

  app.post('/api/admin/submissoes/:id/previa-email', ...A, (req, res) => {
    const s = submissao(idParam(req));
    if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
    const d = lerDecisao(req.body);
    if (d.erro) return res.status(400).json({ error: d.erro });
    const autor = q.get('SELECT * FROM usuarios WHERE id = ?', s.autor_id);
    const edital = q.get('SELECT titulo FROM editais WHERE id = ?', s.edital_id);
    const m = email.emailDecisao({ nome: autor.nome, edital: edital.titulo, aprovado: d.decisao === 'aprovado', feedback: d.feedback, observacoes: d.observacoes });
    res.json({ para: autor.email, ...m });
  });

  // Aprovar/reprovar: libera o feedback no painel do autor e manda o e-mail 2.
  app.post('/api/admin/submissoes/:id/decisao', ...A, (req, res) => {
    const id = idParam(req);
    const d = lerDecisao(req.body);
    if (d.erro) return res.status(400).json({ error: d.erro });
    try {
      const r = tx(() => {
        const s = submissao(id);
        if (!s) return 'nao_existe';
        if (s.status !== 'avaliado') return 'status';
        const agora = agoraISO();
        q.run(
          `UPDATE submissoes SET status = ?, decisao = ?, decisao_em = ?, decisao_por = ?, feedback_final = ?,
             observacoes_decisao = ?, atualizado_em = ? WHERE id = ?`,
          d.decisao, d.decisao, agora, req.user.id, d.feedback, d.observacoes || null, agora, id,
        );
        S.evento(id, d.decisao === 'aprovado' ? 'aprovado' : 'reprovado', null, S.quem(req.user));
        const autor = q.get('SELECT * FROM usuarios WHERE id = ?', s.autor_id);
        const edital = q.get('SELECT titulo FROM editais WHERE id = ?', s.edital_id);
        S.enfileirarEmail({
          tipo: `decisao_${d.decisao}`,
          para: autor.email,
          submissaoId: id,
          mensagem: email.emailDecisao({ nome: autor.nome, edital: edital.titulo, aprovado: d.decisao === 'aprovado', feedback: d.feedback, observacoes: d.observacoes }),
        });
        return 'ok';
      });
      if (r === 'nao_existe') return res.status(404).json({ error: 'Submissão não encontrada.' });
      if (r === 'status') return res.status(409).json({ error: 'Esta submissão não está aguardando decisão.' });
      S.despacharEmails();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json(S.falhou(req, err, 'admin/decisao'));
    }
  });

  // -------------------------------------------------------------------------
  // Revisão (anotações estilo Google Docs)
  // -------------------------------------------------------------------------

  const EM_REVISAO = ['aprovado', 'correcoes_enviadas'];

  // Abre (ou retoma) o rascunho da próxima rodada sobre a versão atual.
  function rascunhoDaRodada(s) {
    const aberto = q.get("SELECT * FROM rodadas WHERE submissao_id = ? AND status = 'rascunho'", s.id);
    if (aberto) return aberto;
    const numero = (q.get('SELECT MAX(numero) AS n FROM rodadas WHERE submissao_id = ?', s.id).n || 0) + 1;
    const r = q.run("INSERT INTO rodadas (submissao_id, numero, versao_id, status) VALUES (?, ?, ?, 'rascunho')", s.id, numero, s.versao_atual_id);
    return q.get('SELECT * FROM rodadas WHERE id = ?', Number(r.lastInsertRowid));
  }

  app.get('/api/admin/revisao/:id', ...A, (req, res) => {
    const s = submissao(idParam(req));
    if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
    const rodadas = q.all('SELECT * FROM rodadas WHERE submissao_id = ? ORDER BY numero', s.id);
    let atual = null;
    if (EM_REVISAO.includes(s.status)) atual = tx(() => rascunhoDaRodada(s));
    const versoes = q.all('SELECT id, numero, palavras, origem, criado_em FROM versoes WHERE submissao_id = ? ORDER BY numero', s.id);
    const conteudo = (vid) => (vid ? (q.get('SELECT conteudo FROM versoes WHERE id = ?', vid) || {}).conteudo : null);
    const anteriores = rodadas.filter((r) => r.status !== 'rascunho').map((r) => ({
      ...S.rodadaAdmin(r),
      textoAnotado: conteudo(r.versao_id),
      textoResposta: conteudo(r.resposta_versao_id),
    }));
    res.json({
      submissao: S.resumoAdmin(s),
      feedbackFinal: s.feedback_final,
      observacoesDecisao: s.observacoes_decisao,
      podeRevisar: EM_REVISAO.includes(s.status),
      texto: conteudo(s.versao_atual_id),
      versoes,
      rodadaAtual: atual ? S.rodadaAdmin(q.get('SELECT * FROM rodadas WHERE id = ?', atual.id)) : null,
      rodadasAnteriores: anteriores,
    });
  });

  function salvarRascunho(s, body, { final = false } = {}) {
    const r = q.get("SELECT * FROM rodadas WHERE submissao_id = ? AND status = 'rascunho'", s.id);
    if (!r) return { erro: 'Não há rodada de revisão aberta.', status: 409 };
    const texto = q.get('SELECT conteudo FROM versoes WHERE id = ?', r.versao_id).conteudo;
    const v = anotacoes.validarAnotacoes(body?.anotacoes || [], texto, { exigirComentario: final });
    if (v.erro) return { erro: v.erro, status: 400 };
    const obs = String(body?.observacoes || '').replace(/\r\n/g, '\n').slice(0, 20000);
    q.run('UPDATE rodadas SET anotacoes = ?, observacoes_admin = ? WHERE id = ?', JSON.stringify(v.anotacoes), obs, r.id);
    return { rodada: q.get('SELECT * FROM rodadas WHERE id = ?', r.id) };
  }

  app.put('/api/admin/revisao/:id', ...A, (req, res) => {
    const s = submissao(idParam(req));
    if (!s) return res.status(404).json({ error: 'Submissão não encontrada.' });
    if (!EM_REVISAO.includes(s.status)) return res.status(409).json({ error: 'Esta submissão não está em revisão.' });
    const r = tx(() => salvarRascunho(s, req.body));
    if (r.erro) return res.status(r.status).json({ error: r.erro });
    res.json({ ok: true, salvoEm: agoraISO(), anotacoes: json(r.rodada.anotacoes, []) });
  });

  // "Enviar correção": a rodada vai para o autor, com e-mail.
  app.post('/api/admin/revisao/:id/enviar', ...A, (req, res) => {
    const id = idParam(req);
    try {
      const r = tx(() => {
        const s = submissao(id);
        if (!s) return { erro: 'Submissão não encontrada.', status: 404 };
        if (!EM_REVISAO.includes(s.status)) return { erro: 'Esta submissão não está em revisão.', status: 409 };
        const salvo = salvarRascunho(s, req.body, { final: true });
        if (salvo.erro) return salvo;
        const rod = salvo.rodada;
        if (!json(rod.anotacoes, []).length && !String(rod.observacoes_admin || '').trim()) {
          return { erro: 'Marque ao menos um trecho ou escreva uma observação antes de enviar.', status: 400 };
        }
        const agora = agoraISO();
        q.run("UPDATE rodadas SET status = 'enviada', enviada_em = ?, enviada_por = ? WHERE id = ?", agora, req.user.id, rod.id);
        q.run("UPDATE submissoes SET status = 'aguardando_correcoes', atualizado_em = ? WHERE id = ?", agora, id);
        S.evento(id, 'correcao_enviada', `rodada ${rod.numero} · ${json(rod.anotacoes, []).length} marcação(ões)`, S.quem(req.user));
        const autor = q.get('SELECT * FROM usuarios WHERE id = ?', s.autor_id);
        const edital = q.get('SELECT titulo FROM editais WHERE id = ?', s.edital_id);
        S.enfileirarEmail({
          tipo: 'correcao', para: autor.email, submissaoId: id,
          mensagem: email.emailCorrecao({ nome: autor.nome, edital: edital.titulo, rodada: rod.numero }),
        });
        return { ok: true };
      });
      if (r.erro) return res.status(r.status).json({ error: r.erro });
      S.despacharEmails();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json(S.falhou(req, err, 'admin/enviar-correcao'));
    }
  });

  // Aceitar o texto como está: segue para a diagramação.
  app.post('/api/admin/revisao/:id/aceitar', ...A, (req, res) => {
    const id = idParam(req);
    const r = tx(() => {
      const s = submissao(id);
      if (!s) return 404;
      if (!EM_REVISAO.includes(s.status)) return 409;
      // O rascunho vazio some; um com marcações fica guardado como encerrado.
      const rasc = q.get("SELECT * FROM rodadas WHERE submissao_id = ? AND status = 'rascunho'", id);
      if (rasc) {
        if (!json(rasc.anotacoes, []).length && !String(rasc.observacoes_admin || '').trim()) q.run('DELETE FROM rodadas WHERE id = ?', rasc.id);
        else q.run("UPDATE rodadas SET status = 'encerrada' WHERE id = ?", rasc.id);
      }
      q.run("UPDATE rodadas SET status = 'encerrada' WHERE submissao_id = ? AND status = 'respondida'", id);
      q.run("UPDATE submissoes SET status = 'em_diagramacao', atualizado_em = ? WHERE id = ?", agoraISO(), id);
      S.evento(id, 'revisao_aceita', null, S.quem(req.user));
      return 200;
    });
    if (r === 404) return res.status(404).json({ error: 'Submissão não encontrada.' });
    if (r === 409) return res.status(409).json({ error: 'Esta submissão não está em revisão.' });
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Diagramação e publicação (manuais por enquanto)
  // -------------------------------------------------------------------------

  const PASSOS = {
    em_diagramacao: ['aguardando_publicacao'],
    aguardando_publicacao: ['publicado', 'em_diagramacao'],
    publicado: ['aguardando_publicacao'],
  };

  app.post('/api/admin/submissoes/:id/etapa', ...A, (req, res) => {
    const id = idParam(req);
    const para = req.body?.status;
    const link = String(req.body?.link || '').trim();
    if (para === 'publicado' && !/^https?:\/\/\S+$/i.test(link)) return res.status(400).json({ error: 'Informe o link da publicação (começando com http).' });
    const r = tx(() => {
      const s = submissao(id);
      if (!s) return 404;
      if (!(PASSOS[s.status] || []).includes(para)) return 409;
      const agora = agoraISO();
      if (para === 'publicado') {
        q.run("UPDATE submissoes SET status = 'publicado', link_publicacao = ?, publicado_em = ?, atualizado_em = ? WHERE id = ?", link, agora, agora, id);
      } else {
        q.run('UPDATE submissoes SET status = ?, atualizado_em = ? WHERE id = ?', para, agora, id);
      }
      S.evento(id, `etapa_${para}`, para === 'publicado' ? link : null, S.quem(req.user));
      return 200;
    });
    if (r === 404) return res.status(404).json({ error: 'Submissão não encontrada.' });
    if (r === 409) return res.status(409).json({ error: 'Essa mudança de etapa não é possível a partir do status atual.' });
    res.json({ ok: true });
  });

  // Corrige o link de uma publicação já feita.
  app.put('/api/admin/submissoes/:id/link', ...A, (req, res) => {
    const link = String(req.body?.link || '').trim();
    if (!/^https?:\/\/\S+$/i.test(link)) return res.status(400).json({ error: 'Informe um link começando com http.' });
    const r = q.run("UPDATE submissoes SET link_publicacao = ?, atualizado_em = ? WHERE id = ? AND status = 'publicado'", link, agoraISO(), idParam(req));
    if (!r.changes) return res.status(409).json({ error: 'A submissão não está publicada.' });
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Prompts do pipeline
  // -------------------------------------------------------------------------

  app.get('/api/admin/prompts', ...A, (req, res) => {
    const ativos = avaliacao.promptsAtivos();
    res.json({
      totalCriterios: pipeline.TOTAL_CRITERIOS,
      slots: pipeline.SLOTS.map((s) => {
        const p = ativos[s.id];
        return {
          id: s.id, nome: s.nome, descricao: s.descricao, exige: s.exige,
          carregado: !!p,
          tamanho: p ? p.conteudo.length : 0,
          problema: p ? pipeline.validarSlot(s.id, p.conteudo) : null,
          versaoId: p ? p.id : null,
          nomeArquivo: p ? p.nome_arquivo : null,
          por: p ? p.por : null,
          em: p ? p.criado_em : null,
        };
      }),
      criterios: ativos.criterios ? pipeline.parseCriterios(ativos.criterios.conteudo).map(({ bloco, ...c }) => c) : [],
      tercos: pipeline.TERCOS,
      portao: pipeline.PORTAO,
    });
  });

  app.get('/api/admin/prompts/:slot', ...A, (req, res) => {
    const slot = req.params.slot;
    if (!pipeline.SLOT_IDS.includes(slot)) return res.status(404).json({ error: 'Prompt desconhecido.' });
    const historico = q.all('SELECT id, nome_arquivo, por, criado_em, length(conteudo) AS tamanho FROM prompts WHERE slot = ? ORDER BY id DESC LIMIT 30', slot);
    const id = req.query.versao ? Number(req.query.versao) : (historico[0] && historico[0].id);
    const p = id ? q.get('SELECT * FROM prompts WHERE id = ? AND slot = ?', id, slot) : null;
    res.json({ slot, conteudo: p ? p.conteudo : '', versaoId: p ? p.id : null, historico });
  });

  app.put('/api/admin/prompts/:slot', ...A, (req, res) => {
    const slot = req.params.slot;
    if (!pipeline.SLOT_IDS.includes(slot)) return res.status(404).json({ error: 'Prompt desconhecido.' });
    const conteudo = String(req.body?.conteudo || '').replace(/\r\n/g, '\n');
    if (conteudo.length > 300000) return res.status(400).json({ error: 'Prompt grande demais.' });
    const problema = pipeline.validarSlot(slot, conteudo);
    if (problema) return res.status(400).json({ error: problema });
    const atual = avaliacao.promptsAtivos()[slot];
    if (atual && atual.conteudo === conteudo) return res.json({ ok: true, semMudanca: true });
    q.run('INSERT INTO prompts (slot, conteudo, nome_arquivo, por) VALUES (?, ?, ?, ?)',
      slot, conteudo, String(req.body?.nomeArquivo || '').slice(0, 120) || null, S.quem(req.user));
    avaliacao.cutucar(); // se a fila estava parada por falta de prompt, anda
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // E-mails, erros, equipe
  // -------------------------------------------------------------------------

  app.get('/api/admin/emails', ...A, (req, res) => {
    res.json({
      configurado: email.estaConfigurado(),
      credencial: email.modoCredencial(),
      emails: q.all('SELECT id, tipo, para, assunto, estado, erro, submissao_id, criado_em, enviado_em FROM emails ORDER BY id DESC LIMIT 300'),
    });
  });

  app.get('/api/admin/emails/:id', ...A, (req, res) => {
    const m = q.get('SELECT * FROM emails WHERE id = ?', idParam(req));
    if (!m) return res.status(404).json({ error: 'E-mail não encontrado.' });
    res.json(m);
  });

  app.post('/api/admin/emails/:id/reenviar', ...A, async (req, res) => {
    const r = q.run("UPDATE emails SET estado = 'pendente' WHERE id = ? AND estado IN ('falhou', 'nao_configurado')", idParam(req));
    if (!r.changes) return res.status(409).json({ error: 'Só dá para reenviar e-mail que não saiu.' });
    await S.despacharEmails();
    res.json(q.get('SELECT id, estado, erro, enviado_em FROM emails WHERE id = ?', idParam(req)));
  });

  app.get('/api/admin/erros', ...A, (req, res) => {
    res.json(q.all('SELECT * FROM erros ORDER BY em DESC LIMIT 200').map((e) => ({ ...e, dados: json(e.dados, {}) })));
  });

  app.get('/api/admin/equipe', ...A, (req, res) => {
    res.json(q.all("SELECT id, nome, username, email, criado_em FROM usuarios WHERE papel = 'admin' ORDER BY id"));
  });

  app.post('/api/admin/equipe', ...A, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const nome = String(req.body?.nome || '').trim().slice(0, 80);
    const mail = String(req.body?.email || '').trim().toLowerCase() || null;
    const senha = String(req.body?.senha || '');
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Usuário: 3 a 30 caracteres (letras, números, ponto, hífen ou sublinhado).' });
    if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
    if (mail && !regras.emailValido(mail)) return res.status(400).json({ error: 'E-mail inválido.' });
    const erroSenha = regras.erroDeSenha(senha, { email: username, nome });
    if (erroSenha) return res.status(400).json({ error: erroSenha });
    const hash = await bcrypt.hash(senha, BCRYPT_ROUNDS);
    const r = tx(() => {
      if (q.get('SELECT 1 FROM usuarios WHERE username = ? OR (email IS NOT NULL AND email = ?)', username, mail)) return null;
      return q.run("INSERT INTO usuarios (papel, nome, username, email, senha_hash) VALUES ('admin', ?, ?, ?, ?)", nome, username, mail, hash);
    });
    if (!r) return res.status(409).json({ error: 'Já existe uma conta com esse usuário ou e-mail.' });
    res.status(201).json({ ok: true });
  });

  app.put('/api/admin/equipe/:id/senha', ...A, async (req, res) => {
    const u = q.get("SELECT * FROM usuarios WHERE id = ? AND papel = 'admin'", idParam(req));
    if (!u) return res.status(404).json({ error: 'Conta não encontrada.' });
    const erroSenha = regras.erroDeSenha(req.body?.senha, { email: u.username, nome: u.nome });
    if (erroSenha) return res.status(400).json({ error: erroSenha });
    const hash = await bcrypt.hash(String(req.body.senha), BCRYPT_ROUNDS);
    q.run('UPDATE usuarios SET senha_hash = ?, token_versao = token_versao + 1 WHERE id = ?', hash, u.id);
    res.json({ ok: true });
  });

  app.delete('/api/admin/equipe/:id', ...A, (req, res) => {
    const id = idParam(req);
    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
    const r = q.run("DELETE FROM usuarios WHERE id = ? AND papel = 'admin'", id);
    if (!r.changes) return res.status(404).json({ error: 'Conta não encontrada.' });
    res.json({ ok: true });
  });
};
