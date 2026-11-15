import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import { platformEmailApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import { emailError, emailTypeCatalog, isConfigurableType, typeStatus } from './emailTemplatePresentation'
import './email-templates.css'

export default function EmailTypes() {
  const { user } = useAuth()
  return <EmailTypesView key={user?.id}/>
}

export function EmailTypesView({ api = platformEmailApi }) {
  const [summaries, setSummaries] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true; const controller = new AbortController()
    setSummaries(null); setError('')
    api.types(controller.signal)
      .then(response => { if (active) setSummaries(response.data.items || []) })
      .catch(reason => { if (active && reason?.code !== 'ERR_CANCELED') setError(emailError(reason)) })
    return () => { active = false; controller.abort() }
  }, [api, reload])

  return <div className="page email-templates">
    <header className="email-heading"><h1>Email</h1></header>
    <section className="email-panel" aria-label="Tipos de email">
      {!summaries && !error && <LoadingIndicator>A carregar os tipos de email…</LoadingIndicator>}
      {error && <div className="alert alert-error" role="alert">{error}
        <button className="btn btn-outline" onClick={() => setReload(value => value + 1)}>Tentar novamente</button>
      </div>}
      {summaries && <div className="table-wrap"><table className="data-table email-types">
        <thead><tr><th scope="col">Tipo</th><th scope="col">Enviado por</th><th scope="col">Âmbito</th><th scope="col">Estado</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{emailTypeCatalog.map(item => {
          const summary = summaries.find(value => value.type === item.type)
          const configurable = isConfigurableType(item.type, summary)
          return <tr key={item.type}>
          <th scope="row">{item.label}</th>
          <td>{item.sender}</td>
          <td>{item.scope}</td>
          <td>{configurable
            ? typeStatus(summary).map(line => <span className="email-type-line" key={line}>{line}</span>)
            : <><span className="badge badge-gray">Ainda não configurável</span><span className="email-type-line email-type-note">{item.note}</span></>}</td>
          <td>{configurable && <Link className="btn btn-outline" to={`/administracao/email/${item.type}`} aria-label={`Configurar ${item.label}`}><Settings size={16} aria-hidden="true"/>Configurar</Link>}</td>
        </tr>})}</tbody>
      </table></div>}
    </section>
  </div>
}
