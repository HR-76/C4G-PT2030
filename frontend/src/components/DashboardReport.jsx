import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import InfoTooltip from './InfoTooltip'
import { exactMoney, applicationMetrics } from '../api/organizationDashboard'
import { applicationStatusLabels, applicationStatusChips } from '../utils/applicationStatuses'
import { dashboardApi } from '../api/api'
import './DashboardReport.css'

export function BudgetValue({ value }) {
  return <>{exactMoney(value.total)}{value.missing > 0 && <small className="text-muted" style={{ display: 'block' }}>{value.missing} sem valor</small>}</>
}

export default function DashboardReport({ dashboard, exporting, exportError, onExport }) {
  const [view, setView] = useState('units')
  const [page, setPage] = useState(null)
  const [pageError, setPageError] = useState('')
  const [pageLoading, setPageLoading] = useState(false)
  const controller = useRef(null)
  const report = dashboard.report
  useEffect(() => { setPage(null); setPageError(''); return () => controller.current?.abort() }, [report])
  const detail = page || report
  const loadPage = async cursor => {
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setPageLoading(true); setPageError('')
    try {
      const { data } = await dashboardApi.reportPage({ organizationId: report.organizationId, cursor, signal: request.signal })
      if (request.signal.aborted) return
      if (data.organizationId !== report.organizationId || data.digest !== report.digest) throw new Error('stale')
      setPage(data)
    } catch { if (!request.signal.aborted) setPageError('Não foi possível ler esta página. Atualize os indicadores e tente novamente.') }
    finally { if (!request.signal.aborted) setPageLoading(false) }
  }
  const metrics = dashboard.applications
  const states = Object.entries(applicationStatusLabels).map(([status, label]) => ({ status, label, ...(report.states ? report.states[status] || applicationMetrics([]) : applicationMetrics(report.items.filter(item => item.status === status))) }))
  const row = item => <><td>{item.total}</td><td>{item.active}</td><td>{item.submitted}</td><td>{item.approved}</td><td><BudgetValue value={item.totalBudget} /></td><td><BudgetValue value={item.organizationBudget} /></td><td><BudgetValue value={item.approvedBudget} /></td></>
  return <section className="dash-section dashboard-report">
    <div className="section-hd"><div className="heading-with-info"><h2>Relatório de candidaturas</h2><InfoTooltip label="Informação sobre o relatório">Submetidas/decididas inclui submetidas, aprovadas e rejeitadas. Por unidade, cada candidatura pertence à unidade principal do responsável, sem somar subunidades. Os valores são orçamentos em euros, não financiamento concedido.</InfoTooltip></div><button className="btn btn-outline btn-sm" disabled={exporting} onClick={onExport}><Download size={13} />{exporting ? 'A preparar Excel…' : 'Exportar candidaturas para Excel'}</button></div>
    {exportError && <div className="alert alert-error" role="alert">{exportError}</div>}
    <div className="dashboard-subtabs">
      {[['units', 'Por unidade'], ['states', 'Por estado'], ['applications', 'Candidaturas']].map(([key,label]) => <button key={key} className={`tab-btn${view === key ? ' active' : ''}`} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
    </div>
    {view === 'units' && !dashboard.unit_totals ? <p role="status">Sem acesso aos indicadores do diretório. Pode consultar o relatório por estado e as candidaturas autorizadas.</p> : view !== 'applications' ? <div className="table-wrap dashboard-table-wrap"><table className={`data-table dashboard-report-table${view === 'units' ? ' dashboard-units-table' : ''}`}>
      <caption className="sr-only">{view === 'units' ? 'Indicadores por unidade' : 'Indicadores por estado'}</caption>
      <thead><tr><th>{view === 'units' ? 'Departamento / Unidade' : 'Estado'}</th>{view === 'units' && <th>Pessoas</th>}<th>Candidaturas</th><th>Ativas</th><th>Submetidas/<wbr/>decididas</th><th>Aprovadas</th><th>Orç. total dos projetos</th><th>Orç. da organização</th><th>Orç. org. em aprovadas</th></tr></thead>
      <tbody>{(view === 'units' ? dashboard.unit_totals : states).map(item => <tr key={view === 'units' ? item.unitId || 'unassigned' : item.status}><td>{item.label}{item.lifecycle === 'ARCHIVED' && ' (arquivada)'}</td>{view === 'units' && <td>{item.people}</td>}{row(item)}</tr>)}</tbody>
      <tfoot><tr><th>Total acessível</th>{view === 'units' && <td>{dashboard.unit_totals.reduce((total,item) => total+item.people,0)}</td>}{row(metrics)}</tr></tfoot>
    </table></div> : <div className="table-wrap dashboard-table-wrap"><table className="data-table dashboard-report-table">
      <caption className="sr-only">Candidaturas incluídas nos indicadores e na exportação</caption>
      <thead><tr><th>Candidatura</th><th>Oportunidade</th><th>Estado</th><th>Responsável</th><th>Unidade principal</th><th>Prazo interno</th><th>Orç. total</th><th>Orç. organização</th></tr></thead>
      <tbody>{detail.items.map(item => <tr key={item.applicationId}><td><Link className="link-cell" to={`/candidaturas/${item.applicationId}`}>{item.title}</Link></td><td>{item.opportunityTitle || 'Não indicado'}</td><td><span className={`chip ${applicationStatusChips[item.status] || 'chip-grey'}`}>{applicationStatusLabels[item.status] || item.status}</span></td><td>{item.responsibleName || 'Não indicado'}</td><td>{report.unitsAvailable ? report.units.find(unit => unit.unitId === item.unitId)?.label || 'Sem unidade atribuída' : 'Sem acesso ao diretório'}</td><td>{item.deadline || 'Não indicado'}</td><td>{exactMoney(item.totalBudget)}</td><td>{exactMoney(item.organizationBudget)}</td></tr>)}</tbody>
    </table>{!detail.items.length && <p className="empty">Sem candidaturas acessíveis.</p>}
    {pageError && <p role="alert">{pageError}</p>}
    {(detail.previousCursor || detail.nextCursor) && <nav aria-label="Páginas do relatório"><button className="btn btn-secondary btn-sm" disabled={pageLoading || !detail.previousCursor} onClick={() => loadPage(detail.previousCursor)}>Anterior</button><span> Página {detail.page} · {detail.total} candidaturas </span><button className="btn btn-secondary btn-sm" disabled={pageLoading || !detail.nextCursor} onClick={() => loadPage(detail.nextCursor)}>Seguinte</button></nav>}
    </div>}
  </section>
}
