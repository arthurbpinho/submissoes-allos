// E-mail transacional pela Microsoft Graph API (Microsoft 365 / Entra).
//
// Transporte portado do all_OS (server/email.js de lá tem o histórico das
// decisões: Graph em vez de SMTP, certificado em vez de segredo). A autenticação
// do Entra será configurada depois; até lá `estaConfigurado()` é falso e nenhum
// e-mail sai — o index.js registra cada um na caixa de saída (tabela `emails`)
// com o estado "nao_configurado", visível em Admin → E-mails.
//
// São só os e-mails do fluxo:
//   1. texto enviado com sucesso
//   2. decisão: aprovado (com feedback + pedidos de correção) ou reprovado
//   3. pedido de correção (cada rodada de revisão enviada ao autor)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const env = (k) => process.env[k] || '';

function lerChavePrivada() {
  const arquivo = env('GRAPH_CERT_KEY_FILE');
  if (arquivo) {
    try {
      const alvo = path.isAbsolute(arquivo) ? arquivo : path.join(__dirname, '..', arquivo);
      return fs.readFileSync(alvo, 'utf-8');
    } catch (e) {
      console.error('[email] GRAPH_CERT_KEY_FILE não pôde ser lido:', e && e.message);
      return '';
    }
  }
  const bruto = env('GRAPH_CERT_PRIVATE_KEY').trim();
  if (!bruto) return '';
  // PEM cru, PEM com \n literal, ou base64 do PEM numa linha (recomendado em painel de variáveis).
  if (bruto.includes('-----BEGIN')) return bruto.replace(/\\n/g, '\n');
  try {
    const decodificado = Buffer.from(bruto, 'base64').toString('utf-8');
    if (decodificado.includes('-----BEGIN')) return decodificado;
  } catch { /* cai no aviso abaixo */ }
  console.error(`[email] GRAPH_CERT_PRIVATE_KEY não parece um PEM nem base64 de PEM (${bruto.length} chars).`);
  return '';
}

let _chave;
const chavePrivada = () => (_chave === undefined ? (_chave = lerChavePrivada()) : _chave);
const thumbprint = () => env('GRAPH_CERT_THUMBPRINT').replace(/[^0-9a-fA-F]/g, '');
const usaCertificado = () => !!(chavePrivada() && thumbprint());

function modoCredencial() {
  if (usaCertificado()) return 'certificado';
  if (env('GRAPH_CLIENT_SECRET')) return 'segredo';
  return 'nenhuma';
}

function estaConfigurado() {
  // Sob teste, nunca: a suíte não pode disparar e-mail de verdade.
  if (process.env.NODE_ENV === 'test') return false;
  return !!(env('GRAPH_TENANT_ID') && env('GRAPH_CLIENT_ID') && env('MAIL_FROM') && modoCredencial() !== 'nenhuma');
}

// JWT assinado com a chave do certificado (private_key_jwt), no lugar do client_secret.
function montarClientAssertion(audience) {
  const agora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', x5t: Buffer.from(thumbprint(), 'hex').toString('base64url') };
  const payload = {
    aud: audience, iss: env('GRAPH_CLIENT_ID'), sub: env('GRAPH_CLIENT_ID'),
    jti: crypto.randomUUID(), nbf: agora - 60, iat: agora, exp: agora + 300,
  };
  const cabeca = Buffer.from(JSON.stringify(header)).toString('base64url');
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const assinatura = crypto.createSign('RSA-SHA256').update(`${cabeca}.${corpo}`).sign(chavePrivada()).toString('base64url');
  return `${cabeca}.${corpo}.${assinatura}`;
}

let tokenCache = { value: null, expiraEm: 0 };
async function getAccessToken() {
  const agora = Date.now();
  if (tokenCache.value && agora < tokenCache.expiraEm) return tokenCache.value;
  const url = `https://login.microsoftonline.com/${encodeURIComponent(env('GRAPH_TENANT_ID'))}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env('GRAPH_CLIENT_ID'),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  if (usaCertificado()) {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', montarClientAssertion(url));
  } else {
    body.set('client_secret', env('GRAPH_CLIENT_SECRET'));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Graph token ${res.status}: ${detalhe.slice(0, 300)}`);
  }
  const json = await res.json();
  tokenCache = { value: json.access_token, expiraEm: agora + Math.max(0, (Number(json.expires_in) || 3600) - 300) * 1000 };
  return tokenCache.value;
}

// Nunca lança. { ok } | { ok:false, naoConfigurado:true } | { ok:false, erro }.
async function enviarEmail({ to, subject, html }) {
  if (!estaConfigurado()) return { ok: false, naoConfigurado: true };
  try {
    const token = await getAccessToken();
    const from = env('MAIL_FROM');
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          from: { emailAddress: { address: from, name: env('MAIL_FROM_NAME') || 'Submissões Allos' } },
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`Graph sendMail ${res.status}: ${detalhe.slice(0, 300)}`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: (err && err.message) || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Templates — HTML com tudo inline (cliente de e-mail ignora <style>).
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function baseUrl() {
  return (env('APP_BASE_URL') || 'https://submissao.allos.org.br').replace(/\/+$/, '');
}
function url(caminho) { return `${baseUrl()}${caminho}`; }
// O endereço como as pessoas falam dele, sem protocolo.
function urlVisivel(caminho) { return url(caminho).replace(/^https?:\/\//, ''); }

// Markdown mínimo do feedback (negrito, itálico, parágrafos, listas com "-") → HTML seguro.
function mdParaHtml(texto) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  const blocos = String(texto || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return blocos.map((b) => {
    const linhas = b.split('\n').filter((l) => l.trim());
    if (!linhas.length) return '';
    if (linhas.every((l) => /^\s*[-*]\s+/.test(l))) {
      return `<ul style="margin:0 0 14px;padding-left:20px;">${linhas.map((l) => `<li style="margin-bottom:4px;">${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 14px;">${linhas.map(inline).join('<br>')}</p>`;
  }).join('');
}

function layout({ titulo, corpoHtml, botao }) {
  const botaoHtml = botao ? `
        <tr><td style="padding:8px 0 24px;">
          <a href="${esc(botao.href)}" style="display:inline-block;background:#008f8f;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;font-size:15px;">${esc(botao.label)}</a>
        </td></tr>` : '';
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#F5F0E8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#FDFBF7;border:1px solid #E8E2D7;border-radius:8px;padding:32px;font-family:Georgia,'Times New Roman',serif;">
        <tr><td style="padding-bottom:6px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#006a6a;">Associação Allos</td></tr>
        <tr><td style="padding-bottom:22px;font-size:26px;color:#14564E;">Submissões <span style="color:#B85A40;font-style:italic;">Allos</span></td></tr>
        <tr><td style="padding-bottom:14px;font-size:20px;color:#14564E;">${esc(titulo)}</td></tr>
        <tr><td style="padding-bottom:10px;color:#2D2D2D;font-size:15.5px;line-height:1.65;">${corpoHtml}</td></tr>
        ${botaoHtml}
        <tr><td style="border-top:1px solid #E8E2D7;padding-top:18px;color:#8a8a83;font-size:12px;line-height:1.6;">
          E-mail automático da plataforma Submissões Allos. Não responda a esta mensagem.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

// 1. Texto enviado com sucesso.
function emailTextoEnviado({ nome, edital }) {
  const painel = urlVisivel('/dashboard');
  const assunto = 'Recebemos o seu texto · Submissões Allos';
  const texto = [
    `Olá, ${primeiroNome(nome)}.`,
    '',
    `Seu texto para o edital "${edital}" foi enviado com sucesso.`,
    `Acompanhe cada etapa em ${painel}.`,
  ].join('\n');
  const html = layout({
    titulo: 'Seu texto foi enviado com sucesso',
    corpoHtml: `<p style="margin:0 0 14px;">Olá, ${esc(primeiroNome(nome))}.</p>
      <p style="margin:0 0 14px;">Recebemos o seu texto para o edital <strong>${esc(edital)}</strong>.</p>
      <p style="margin:0 0 14px;">Acompanhe o andamento em <a href="${esc(url('/dashboard'))}" style="color:#006a6a;">${esc(painel)}</a>.</p>`,
    botao: { href: url('/dashboard'), label: 'Acompanhar minha submissão' },
  });
  return { assunto, texto, html };
}

// 2. Decisão: aprovado ou reprovado, com o feedback.
function emailDecisao({ nome, edital, aprovado, feedback, observacoes }) {
  const n = primeiroNome(nome);
  if (aprovado) {
    const assunto = 'Seu texto foi aprovado · Submissões Allos';
    const obs = String(observacoes || '').trim();
    const texto = [
      `Olá, ${n}.`, '',
      `Seu texto para o edital "${edital}" foi aprovado.`, '',
      'Retorno da avaliação:', '', feedback, '',
      ...(obs ? ['Pontos que os revisores pediram para revisar:', '', obs, ''] : []),
      'Nas próximas etapas, os revisores podem pedir correções pontuais no texto.',
      'Quando isso acontecer, você recebe um aviso para fazer as correções no próprio site.',
      `Acompanhe em ${urlVisivel('/dashboard')}.`,
    ].join('\n');
    const html = layout({
      titulo: 'Seu texto foi aprovado',
      corpoHtml: `<p style="margin:0 0 14px;">Olá, ${esc(n)}.</p>
        <p style="margin:0 0 18px;">Seu texto para o edital <strong>${esc(edital)}</strong> foi aprovado.</p>
        <div style="border-left:3px solid #008f8f;padding:2px 0 2px 16px;margin:0 0 18px;">${mdParaHtml(feedback)}</div>
        ${obs ? `<p style="margin:0 0 8px;font-weight:bold;color:#14564E;">Pontos que os revisores pediram para revisar</p>
        <div style="border-left:3px solid #B85A40;padding:2px 0 2px 16px;margin:0 0 18px;">${mdParaHtml(obs)}</div>` : ''}
        <p style="margin:0 0 14px;">Nas próximas etapas, os revisores podem pedir correções pontuais no texto. Quando isso acontecer, você recebe um aviso para fazer as correções no próprio site.</p>`,
      botao: { href: url('/dashboard'), label: 'Acompanhar minha submissão' },
    });
    return { assunto, texto, html };
  }
  const assunto = 'Resultado da avaliação do seu texto · Submissões Allos';
  const texto = [
    `Olá, ${n}.`, '',
    `Agradecemos o envio do seu texto para o edital "${edital}". Desta vez, ele não foi aprovado.`, '',
    'Retorno da avaliação:', '', feedback, '',
    `Esperamos receber um novo texto seu. Continue acompanhando nossos editais em ${urlVisivel('/')}.`,
  ].join('\n');
  const html = layout({
    titulo: 'Resultado da avaliação',
    corpoHtml: `<p style="margin:0 0 14px;">Olá, ${esc(n)}.</p>
      <p style="margin:0 0 18px;">Agradecemos o envio do seu texto para o edital <strong>${esc(edital)}</strong>. Desta vez, ele não foi aprovado.</p>
      <div style="border-left:3px solid #c4baa8;padding:2px 0 2px 16px;margin:0 0 18px;">${mdParaHtml(feedback)}</div>
      <p style="margin:0 0 14px;">Esperamos receber um novo texto seu. Continue acompanhando nossos editais em <a href="${esc(url('/'))}" style="color:#006a6a;">${esc(urlVisivel('/'))}</a>.</p>`,
    botao: { href: url('/'), label: 'Ver editais abertos' },
  });
  return { assunto, texto, html };
}

// 3. Pedido de correção (rodada de revisão).
function emailCorrecao({ nome, edital, rodada }) {
  const n = primeiroNome(nome);
  const assunto = 'Correções no seu texto · Submissões Allos';
  const primeira = rodada <= 1;
  const texto = [
    `Olá, ${n}.`, '',
    `Os revisores ${primeira ? 'marcaram' : 'marcaram novos'} pontos para corrigir no seu texto do edital "${edital}".`,
    `Entre em ${urlVisivel('/correcao')} para ver os comentários e corrigir o texto ali mesmo.`,
    'Se decidir não fazer alguma correção, explique o motivo nas observações antes de enviar.',
  ].join('\n');
  const html = layout({
    titulo: primeira ? 'Hora de revisar o seu texto' : 'Novas correções no seu texto',
    corpoHtml: `<p style="margin:0 0 14px;">Olá, ${esc(n)}.</p>
      <p style="margin:0 0 14px;">Os revisores ${primeira ? 'marcaram' : 'marcaram novos'} pontos para corrigir no seu texto do edital <strong>${esc(edital)}</strong>.</p>
      <p style="margin:0 0 14px;">Entre em <a href="${esc(url('/correcao'))}" style="color:#006a6a;">${esc(urlVisivel('/correcao'))}</a> para ver os comentários e corrigir o texto ali mesmo. Se decidir não fazer alguma correção, explique o motivo nas observações antes de enviar.</p>`,
    botao: { href: url('/correcao'), label: 'Fazer as correções' },
  });
  return { assunto, texto, html };
}

module.exports = {
  estaConfigurado,
  modoCredencial,
  enviarEmail,
  emailTextoEnviado,
  emailDecisao,
  emailCorrecao,
  mdParaHtml,
};
