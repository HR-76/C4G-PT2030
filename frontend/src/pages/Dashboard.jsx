import DashboardDeadlines from '../components/DashboardDeadlines'
import LoadingIndicator from '../components/LoadingIndicator'
import '../dashboard-palette.css'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BarChart3, CalendarClock, FolderKanban, RefreshCw, Search } from 'lucide-react'
import { exactMoney } from '../api/organizationDashboard'
import ApprovalTimeline, { approvalSummary, emptyPeriod } from '../components/ApprovalTimeline'
import DashboardCharts from '../components/DashboardCharts'
import DashboardReport from '../components/DashboardReport'
import DashboardBudgetStates from '../components/DashboardBudgetStates'
import EmptyStatePanel from '../components/EmptyStatePanel'
import InfoTooltip from '../components/InfoTooltip'
import { useAuth } from '../contexts/AuthContext'
import { applicationStatusLabels } from '../utils/applicationStatuses'
import { getSourceName } from '../utils/sourceUi'
import { catalogPeriodDates, catalogFilterParams } from './Opportunities/catalogFilters'
import useOrganizationDashboard from '../hooks/useOrganizationDashboard'
import TechnicianDashboard from './TechnicianDashboard'
import { usesTechnicianDashboard } from '../utils/dashboardVariant'

function Stat({ label, value, detail, to, action }) {
  const content = <><strong className="stat-num">{value ?? '—'}</strong><span className="stat-lbl">{label}</span>{detail && <small>{detail}</small>}{action && <span className="dashboard-stat-action">{action} <ArrowRight size={13} aria-hidden="true"/></span>}</>
  if (to?.startsWith("#")) return <a className="stat-item" href={to}>{content}</a>
  return to ? <Link className="stat-item" to={to}>{content}</Link> : <div className="stat-item">{content}</div>
}

function Kpi({ tone, icon: Icon, label, value, detail, to }) {
  const content = <><Icon size={20} aria-hidden="true" /><strong>{value ?? '—'}</strong><span>{label}</span><small>{detail}</small></>
  return to.startsWith('#') ? <a className="dashboard-kpi" data-tone={tone} href={to}>{content}</a> : <Link className="dashboard-kpi" data-tone={tone} to={to}>{content}</Link>
}

function StatusRows({ values = {} }) {
  const rows = Object.entries(applicationStatusLabels).map(([status, label]) => ({ status, label, total: values[status] || 0 })).filter(row => row.total)
  const max = Math.max(0, ...rows.map(row => row.total))
  if (!rows.length) return <EmptyStatePanel title="Sem candidaturas acessíveis" description="Ainda não existem candidaturas neste âmbito." />
  return <div className="metric-stack">{rows.map(row => <Link to={`/candidaturas?status=${row.status}`} className="metric-row application-state-row" data-status={row.status} key={row.status}>
    <span>{row.label}</span><div className="metric-bar"><i style={{ width: `${max ? Math.max(4, row.total / max * 100) : 0}%` }} /></div><strong>{row.total}</strong>
  </Link>)}</div>
}

export default function Dashboard() {
  const { user, organization } = useAuth()
  if (usesTechnicianDashboard(organization)) return <TechnicianDashboard key={`${user?.id}:${organization.id}`} organization={organization} />
  return <OrganizationDashboard key={JSON.stringify([user?.id, organization?.id])} user={user} organization={organization} />
}

function OrganizationDashboard({ user, organization }) {
  const [params, setParams] = useSearchParams()
  const view = ({indicadores:'operational', relatorio:'report'})[params.get('vista')] || 'charts'
  function setView(key) {
    const next = new URLSearchParams(params)
    if (key === 'charts') next.delete('vista')
    else next.set('vista', key === 'operational' ? 'indicadores' : 'relatorio')
    setParams(next, {replace:true})
  }
  const { dashboard, loading, error, exporting, exportError, refresh, exportReport } = useOrganizationDashboard({ organizationId: organization?.id, userId: user?.id })
  const sources = dashboard?.source_totals || []
  if (!organization) return <EmptyStatePanel title="Entidade não associada" description="Esta conta não tem acesso operacional a uma entidade." />
  const { opportunities = {}, applications = {}, budget = {}, deadlines = [], recent_opportunities: recent = [] } = dashboard || {}
  const generatedAt = dashboard?.report?.generatedAt
  const history = dashboard?.report?.approvalHistory
  const year = dashboard?.today?.slice(0, 4)
  const current = history && (history[year] || emptyPeriod)
  const catalog = dashboard?.catalogIndicators
  const catalogLink = period => '/catalogo?' + new URLSearchParams(catalogFilterParams({
    temporalState: 'OPEN', ...catalogPeriodDates(period, catalog?.asOfDay)
  }, period))
  return <div className="organization-dashboard">
    <header className="dashboard-intro">
      <div><p className="eyebrow">{organization.displayName || organization.name || 'Organização ativa'}</p>
        <div className="heading-with-info"><h1>Dashboard operacional</h1>{generatedAt && <InfoTooltip label="Informação sobre o dashboard">Atualizado em {new Date(generatedAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}.</InfoTooltip>}</div>
      </div>
      <div className="dashboard-actions"><Link className="btn btn-primary" to="/catalogo">Ver oportunidades</Link><Link className="btn btn-outline" to="/candidaturas">Acompanhar candidaturas</Link><button className="btn btn-outline" onClick={refresh}><RefreshCw size={14} /> Atualizar</button></div>
    </header>

    <div className="dashboard-tabs">{[['charts', 'Gráficos'], ['operational', 'Indicadores operacionais'], ['report', 'Relatório da organização']].map(([key, label]) => <button key={key} className={`tab-btn${view === key ? ' active' : ''}`} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>

    {loading ? <LoadingIndicator>A carregar os indicadores da organização…</LoadingIndicator>
      : error ? <div className="alert alert-error" role="alert">{error} <button className="btn btn-outline" onClick={refresh}>Tentar novamente</button></div>
      : !dashboard ? <EmptyStatePanel title="Indicadores indisponíveis" description="Atualize o Dashboard para consultar os dados da organização." actionLabel="Atualizar" onAction={refresh}/> : view === 'charts' ? <><section className="dashboard-kpis" aria-label="Indicadores principais">
        <Kpi tone="portfolio" icon={FolderKanban} value={applications.total} label="Candidaturas acessíveis" detail={`${applications.active || 0} ativas`} to="/candidaturas" />
        <Kpi tone="open" icon={Search} value={opportunities.open} label="Oportunidades abertas" detail="Catálogo e oportunidades privadas" to={catalogLink('all')} />
        <Kpi tone="deadline" icon={CalendarClock} value={opportunities.closing_soon} label="Fecham em 14 dias" detail="Oportunidades abertas com fecho próximo" to={catalogLink('14')} />
        <Kpi icon={BarChart3} value={history ? exactMoney(history.all.total) : null} label="Orçamento global aprovado" detail={current ? `${year} · ${exactMoney(current.total)}` : 'Histórico indisponível'} to="#approval-timeline" />
      </section><DashboardDeadlines deadlines={deadlines} total={dashboard.deadline_total} /><DashboardCharts dashboard={dashboard} /></> : view === 'report' ? <DashboardReport dashboard={dashboard} exporting={exporting} exportError={exportError} onExport={exportReport} /> : <>
      <div className="dashboard-indicator-context"><span>Indicadores da entidade</span><InfoTooltip label="Âmbito dos indicadores">O catálogo da plataforma inclui todos os estados do catálogo central. As oportunidades abertas incluem as acessíveis do catálogo e privadas. As candidaturas e os respetivos orçamentos consideram apenas os registos acessíveis nesta entidade. O orçamento aprovado é o valor dos projetos no momento da aprovação; não representa financiamento recebido. Valores em falta são indicados.</InfoTooltip></div>
      <section className="stats-strip dashboard-stats">
        <Stat label="Orçamento global aprovado" value={exactMoney(history?.all?.total)}
          detail={current ? `${year} · ${exactMoney(current.total)} · ${approvalSummary(current)}${history.all.missing ? ` · Histórico: ${history.all.missing} sem valor` : ''}` : 'Histórico indisponível'}
          to="#approval-timeline" action="Ver evolução" />
        <Stat label="Oportunidades da plataforma" value={catalog?.total} detail="Todos os estados do catálogo central" to="/catalogo" action="Ver catálogo" />
        <Stat label="Oportunidades abertas" value={opportunities.open} detail="Catálogo e oportunidades privadas" to={catalogLink('all')} action={catalog ? `Ver no catálogo (${catalog.open})` : 'Ver abertas no catálogo'} />
        <Stat label="Fecham em 14 dias" value={opportunities.closing_soon} detail="Oportunidades abertas com fecho próximo" to={catalogLink('14')} action={catalog ? `Ver no catálogo (${catalog.closingSoon})` : 'Ver prazos no catálogo'} />
        <Stat label="Candidaturas acessíveis" value={applications.total} detail={`${applications.active || 0} ativas`} to="/candidaturas" action="Ver candidaturas" />
        <Stat label="Orçamento da organização" value={exactMoney(budget.total)} detail={`${budget.missing || 0} sem valor`} to="#dashboard-budget-title" action="Ver por estado" />
      </section>

      <ApprovalTimeline history={history} year={year}/>
      <DashboardBudgetStates states={dashboard.report?.states}/>

      <div className="dashboard-grid">
        <section className="dash-section"><div className="section-hd"><FolderKanban size={16} /><h2>Pipeline de candidaturas</h2><Link to="/candidaturas">Ver todas</Link></div><StatusRows values={applications.by_status} /></section>
        <DashboardDeadlines deadlines={deadlines} total={dashboard.deadline_total} />
        <section className="dash-section"><div className="section-hd"><BarChart3 size={16} /><h2>Fontes de oportunidades</h2><Link to="/catalogo">Catálogo</Link></div>{sources.length ? <ul className="dashboard-list">{sources.map(source => <li key={source.source}><span>{getSourceName(source.source)}</span><strong>{source.total}</strong></li>)}</ul> : <EmptyStatePanel title="Sem fontes" description="Não há oportunidades acessíveis neste âmbito." />}</section>
        <section className="dash-section"><div className="section-hd"><CalendarClock size={16} /><h2>Oportunidades recentes</h2><Link to="/catalogo">Ver todas</Link></div>{recent.length ? <ul className="dashboard-list">{recent.map(item => <li key={item.id}><Link to={item.href || `/catalogo/${item.id}`}>{item.title}</Link></li>)}</ul> : <EmptyStatePanel title="Sem oportunidades" description="Não há oportunidades recentes acessíveis." />}</section>
      </div>
    </>}
  </div>
}
