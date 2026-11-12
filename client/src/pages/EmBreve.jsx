import { Link } from 'react-router-dom';

// Política de privacidade e termos de uso ainda serão escritos; a rota existe
// para os links do consentimento já apontarem para o lugar certo.
export default function EmBreve({ titulo, naoEncontrada = false }) {
  return (
    <div className="site-container estreito">
      <div className="page-header">
        <div className="eyebrow">Submissões Allos</div>
        <h2>{titulo}</h2>
        <div className="ornament" />
      </div>
      <div className="card">
        <p style={{ marginBottom: 16 }}>
          {naoEncontrada ? 'Não encontramos esta página.' : 'Esta página está sendo preparada e será publicada em breve.'}
        </p>
        <Link to="/" className="btn btn-outline btn-sm">Ver editais</Link>
      </div>
    </div>
  );
}
