// "Concordo com a política de privacidade, os termos de uso e o edital de pesquisa".
// As páginas de política e termos serão escritas depois; os links já apontam para elas.
export default function Consentimento({ checked, onChange, editalSlug, id = 'consentimento' }) {
  return (
    <label className="consentimento-linha" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Concordo com a{' '}
        <a href="/politica-de-privacidade" target="_blank" rel="noreferrer">política de privacidade</a>,{' '}
        os <a href="/termos-de-uso" target="_blank" rel="noreferrer">termos de uso</a> e o{' '}
        <a href={editalSlug ? `/editais/${editalSlug}` : '/'} target="_blank" rel="noreferrer">edital de pesquisa</a>.
      </span>
    </label>
  );
}
