import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { platformEmailApi } from '../../api/api'
import LoadingIndicator from '../../components/LoadingIndicator'
import './email-templates.css'

const labels = { 'member-invitation': 'Convite de colaborador', 'password-reset': 'Reposição de palavra-passe' }
const states = { ACCEPTED: 'Aceite pelo serviço de envio', UNCONFIRMED: 'Envio não confirmado', NOT_CONFIGURED: 'Serviço não configurado' }
const dateFormat = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'medium' })

export default function EmailHistory({ api = platformEmailApi }) {
  const [type, setType] = useState(''), [status, setStatus] = useState('')
  const [cursors, setCursors] = useState(['']), [reload, setReload] = useState(0)
  const [data, setData] = useState(null), [error, setError] = useState('')
  const cursor = cursors[cursors.length - 1]
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setData(null); setError('')
    api.history({ type, status, cursor }, controller.signal)
      .then(response => { if (active) setData(response.data) })
      .catch(reason => { if (active && reason?.code !== 'ERR_CANCELED') setError('Não foi possível carregar o histórico de envios.') })
    return () => { active = false; controller.abort() }
  }, [api, type, status, cursor, reload])
  function change(setter, value) { setter(value); setCursors(['']) }
  return <div className="page email-templates">
    <header className="email-heading"><h1>Histórico de envios</h1><Link className="btn btn-outline" to="/administracao/email">Configuração de emails</Link></header>
    <section className="email-panel" aria-label="Histórico de envios">
      <div className="email-history-filters">
        <label>Tipo<select value={type} onChange={event => change(setType, event.target.value)}><option value="">Todos</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Resultado<select value={status} onChange={event => change(setStatus, event.target.value)}><option value="">Todos</option>{Object.entries(states).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <p>A aceitação pelo serviço de envio não confirma a entrega na caixa de correio. Os endereços são removidos do histórico após 90 dias.</p>
      {!data && !error && <LoadingIndicator>A carregar o histórico…</LoadingIndicator>}
      {error && <div className="alert alert-error" role="alert">{error} <button className="btn btn-outline" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
      {data && <>
        {(data.recordingFailures > 0 || data.retentionHealthy === false) && <div className="alert alert-error" role="alert">A recolha ou a limpeza do histórico precisa de atenção. Alguns resultados podem não estar confirmados.</div>}
        {data.items.length === 0 ? <p>Não existem envios registados para estes filtros.</p> : <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Data (Lisboa)</th><th>Tipo</th><th>Origem</th><th>Entidade</th><th>Destinatário</th><th>Resultado</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={`${item.source}:${item.id}`}>
            <td>{dateFormat.format(new Date(item.occurredAt))}</td>
            <td>{labels[item.type]}{item.test && ' (teste)'}</td>
            <td>{item.source === 'KEYCLOAK' ? 'Serviço de autenticação' : 'Aplicação'}</td>
            <td>{item.organizationName || 'Global'}</td>
            <td>{item.recipient || 'Endereço não conservado'}</td>
            <td>{states[item.status] || 'Envio não confirmado'}</td>
          </tr>)}</tbody>
        </table></div>}
        <nav className="email-history-pagination" aria-label="Paginação do histórico">
          <button className="btn btn-outline" disabled={cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Anterior</button>
          <span>Página {cursors.length}</span>
          <button className="btn btn-outline" disabled={!data.nextCursor} onClick={() => setCursors(values => [...values, data.nextCursor])}>Seguinte</button>
        </nav>
      </>}
    </section>
  </div>
}
