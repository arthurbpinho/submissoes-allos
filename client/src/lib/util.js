// Utilidades pequenas da interface.

export function dataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function data(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ISO ↔ valor de <input type="datetime-local"> (no fuso de quem usa).
export function isoParaLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function localParaIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function contarPalavras(t) {
  const m = String(t || '').match(/\S+/g);
  return m ? m.length : 0;
}

// Lê um .txt. Tenta UTF-8; se o arquivo não for UTF-8 válido (o "ANSI" do
// Bloco de Notas antigo e do Word no Windows), lê como Windows-1252.
export async function lerTxt(arquivo) {
  const buf = await arquivo.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export const SITUACAO_EDITAL = {
  rascunho: 'Rascunho',
  arquivado: 'Fora do ar',
  em_breve: 'Em breve',
  abertas: 'Inscrições abertas',
  encerradas: 'Inscrições encerradas',
};

export function guardar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem storage */ }
}
export function recuperar(chave) {
  try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch { return null; }
}
export function esquecer(chave) {
  try { localStorage.removeItem(chave); } catch { /* sem storage */ }
}
