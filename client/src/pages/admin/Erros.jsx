import { useEffect, useState } from 'react';
import { api } from '../../api';
import { dataHora } from '../../lib/util';

export default function Erros() {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api.admin.erros().then(setLista).catch((e) => setErro(e.message)); }, []);
  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Configuração</div>
        <h2>Erros</h2>
        <p>Falhas registradas pelo servidor nos últimos 30 dias. O código aparece para o usuário junto com a mensagem de erro.</p>
        <div className="ornament" />
      </div>
      {erro && <div className="alert error">{erro}</div>}
      {lista && !lista.length && <div className="card vazio">Nenhum erro registrado.</div>}
      {lista && lista.map((e) => (
        <details key={e.id} className="card tight erro-item">
          <summary><span className="mono">{e.id}</span> · <strong>{e.onde}</strong> · {e.mensagem} <span className="celula-sub">· {dataHora(e.em)}</span></summary>
          <pre className="email-previa">{JSON.stringify(e.dados, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}
