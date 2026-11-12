import { checarSenha } from '../lib/senha';

export default function ChecklistSenha({ senha, usuario }) {
  const regras = checarSenha(senha, usuario);
  return (
    <ul className="checklist-senha" aria-live="polite">
      {regras.map((r) => (
        <li key={r.id} className={r.ok ? 'ok' : ''}>
          <span className="checklist-marca" aria-hidden="true">{r.ok ? '✓' : '·'}</span>
          {r.texto}
        </li>
      ))}
    </ul>
  );
}
