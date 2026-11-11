import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { privateApplicationsApi as api } from '../../api/api'
import { opportunityDate } from './OpportunityPresentation'
import { applicationStatusLabels as labels, applicationStatusChips } from '../../utils/applicationStatuses'

export default function OpportunityApplications({ opportunityId, organizationId }) {
  return <ApplicationList key={`${organizationId}:${opportunityId}`} opportunityId={opportunityId} organizationId={organizationId} />
}
function ApplicationList({ opportunityId, organizationId }) {
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [next, setNext] = useState(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true; setLoading(true); setError(false)
    api.list({ opportunityId, ...(cursor ? { cursor } : {}) }).then(r => {
      if (!active) return
      setItems(old => cursor ? [...old, ...r.data.items.filter(item => !old.some(previous => previous.applicationId === item.applicationId))] : r.data.items)
      setNext(r.data.nextCursor)
    }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [opportunityId, organizationId, cursor, retry])
  return <section className="detail-section opportunity-applications" aria-label="Candidaturas da organização"><div className="section-hd"><h2 className="opportunity-section-title">Candidaturas da organização</h2><Link className="btn btn-outline btn-sm" to={`/candidaturas?oportunidade=${opportunityId}`}>Consultar candidaturas desta oportunidade</Link></div>
    {loading && <p role="status">A consultar candidaturas…</p>}
    {error && <p role="alert">Não foi possível consultar candidaturas ou não tem permissão. <button className="btn btn-outline btn-sm" onClick={() => setRetry(v => v + 1)}>Repetir consulta de candidaturas</button></p>}
    {!loading && !error && items.length === 0 && <p className="text-muted">Sem candidaturas associadas nesta organização.</p>}
    {!error && items.length > 0 && <div className="table-wrap"><table role="table" className="data-table mobile-card-table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Título</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Prazo da candidatura</th></tr></thead><tbody role="rowgroup">{items.map(item => <tr role="row" key={item.applicationId}><td role="cell" data-label="Título"><Link to={`/candidaturas/${item.applicationId}`}>{item.title}</Link></td><td role="cell" data-label="Estado"><span className={`chip ${applicationStatusChips[item.status] || 'chip-grey'}`}>{labels[item.status] || item.status}</span></td><td role="cell" data-label="Prazo">{opportunityDate(item.deadline)}</td></tr>)}</tbody></table></div>}
    {next && !error && <button className="btn btn-secondary" disabled={loading} onClick={() => setCursor(next)}>Mais candidaturas</button>}
  </section>
}
