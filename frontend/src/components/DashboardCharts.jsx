import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { exactMoney } from '../api/organizationDashboard'
import { applicationStatusLabels } from '../utils/applicationStatuses'
import ApprovalTimeline from './ApprovalTimeline'
import './DashboardCharts.css'

const statusColor = code => `var(--application-${code.toLowerCase()})`
const stateChartColors = {
  IDENTIFIED: '#667085', SUBMITTED: '#d97706', APPROVED: '#16804a',
  REJECTED: '#c62828', PREPARATION: '#1675c1', CANCELLED: '#b33f83', ARCHIVED: '#343b4a',
}

function Bar({ value, max, color }) {
  return <span className="chart-track" aria-hidden="true"><i style={{ width: max ? (100 * value / max) + '%' : '0%', background: color }}/></span>
}

function States({ applications }) {
  const counts = Object.entries(applicationStatusLabels).map(([code,label]) => ({
    code, label, count: applications.by_status[code] || 0,
  })).filter(row => row.count > 0)
  let offset = 0
  const segments = counts.map(({code,count}) => {
    const start = offset
    offset += count / applications.total * 100
    return stateChartColors[code] + ' ' + start + '% ' + offset + '%'
  })
  return <section className="chart-panel chart-states"><h2>Candidaturas por estado</h2>
    <div className="chart-state-body"><div className="chart-ring" style={{background:segments.length ? 'conic-gradient('+segments.join(', ')+')' : undefined}}>
      <div><strong>{applications.total}</strong><span>{applications.total === 1 ? 'candidatura' : 'candidaturas'}</span></div>
    </div><div className="chart-legend">{counts.length ? counts.map(({code,label,count}) => <Link key={code} to={'/candidaturas?status='+code}>
      <i style={{background:stateChartColors[code]}} aria-hidden="true"/><span>{label}</span><strong>{count}</strong><ArrowUpRight size={14} aria-hidden="true"/>
    </Link>) : <p>Sem candidaturas acessíveis.</p>}</div></div>
  </section>
}

function ActivePipeline({ applications }) {
  const stages = ['IDENTIFIED', 'PREPARATION', 'SUBMITTED']
  const total = stages.reduce((sum, code) => sum + (applications.by_status[code] || 0), 0)
  return <section className="chart-panel"><h2>Candidaturas em curso</h2>
    <p className="chart-caption">{total ? 'Distribuição atual pelas três etapas, da identificação à decisão.' : 'Sem candidaturas em curso.'}</p>
    {stages.map(code => {
      const count = applications.by_status[code] || 0
      return <div className="chart-budget" key={code}>
        <div><Link to={'/candidaturas?status=' + code}>{applicationStatusLabels[code]}</Link><strong>{count}</strong></div>
        <Bar value={count} max={total} color={statusColor(code)}/>
      </div>
    })}
  </section>
}

const alignmentPercent = new Intl.NumberFormat('pt-PT', { style: 'percent', maximumFractionDigits: 1 })

const alignmentPageSize = 8

function AlignmentRow({ label, count, applications, areaNames, goalAreas, total }) {
  const [expanded, setExpanded] = useState(false)
  const [limit, setLimit] = useState(alignmentPageSize)
  const unmatched = !goalAreas
  const matching = expanded ? applications.filter(app => unmatched ? !app.areaIds.length : app.areaIds.some(id => goalAreas.includes(id))) : []
  return <li className="alignment-row">
    <div className="alignment-row-label"><span>{label}</span><strong>{count ?? 'Sem áreas associadas'}</strong></div>
    {count !== null && <Bar value={count} max={total} color={unmatched ? 'var(--color-text-secondary)' : 'var(--dashboard-blue)'} />}
    {count > 0 && <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Ver candidaturas<span className="sr-only"> — {label}</span></summary>
      {expanded && <>
        <ul>{matching.slice(0, limit).map(({ applicationId, title, areaIds }) => <li key={applicationId}>
          <Link to={`/candidaturas/${applicationId}`}>{title}</Link>
          {!unmatched && <small>{areaIds.filter(id => goalAreas.includes(id)).map(id => areaNames[id]).join(', ')}</small>}
        </li>)}</ul>
        {limit < count && <button type="button" className="btn btn-outline" onClick={() => setLimit(value => value + alignmentPageSize)}>
          Mais candidaturas <span>({limit} de {count})</span>
        </button>}
      </>}
    </details>}
  </li>
}

function StrategyAlignment({ alignment }) {
  const heading = useId()
  const { state, total, aligned, objectives, applications, areaNames } = alignment
  const ready = state === 'READY'
  return <section className="chart-panel chart-alignment" aria-labelledby={heading}>
    <div className="alignment-heading">
      <div><h2 id={heading}>Alinhamento estratégico</h2><p className="chart-caption">Candidaturas em preparação por objetivo</p></div>
      <Link to="/candidaturas?status=PREPARATION">Ver lista em preparação <ArrowUpRight size={14} aria-hidden="true" /></Link>
    </div>
    {ready ? <div className="alignment-body">
      <div className="alignment-index">
        <span>Índice de alinhamento</span>
        <strong>{alignmentPercent.format(aligned / total)}</strong>
        <p>{aligned} de {total} candidaturas com correspondência</p>
        <p className="chart-caption">Correspondência automática pelas áreas temáticas de cada objetivo.</p>
      </div>
      <ul className="alignment-rows">
        {objectives.map(goal => <AlignmentRow key={goal.id} label={goal.title} count={goal.areaIds.length ? goal.count : null}
          goalAreas={goal.areaIds} applications={applications} areaNames={areaNames} total={total} />)}
        <AlignmentRow label="Sem correspondência" count={total - aligned} applications={applications} total={total} />
      </ul>
    </div> : <p className="alignment-empty">{state === 'NO_PREPARATION' ? 'Ainda não há candidaturas em preparação.' : state === 'NO_OBJECTIVE_AREAS' ? <>
      Associe áreas temáticas aos objetivos para calcular o índice. <Link to="/perfil-organizacao">Consultar estratégia</Link>
    </> : 'Não foi possível calcular o índice para todas as candidaturas em preparação.'}</p>}
  </section>
}

function Budgets({ applications }) {
  const rows = [['Total dos projetos',applications.totalBudget,'var(--dashboard-blue)'],['Parcela da organização',applications.organizationBudget,'var(--dashboard-violet)']]
  const maximum = Math.max(0,...rows.map(([,budget])=>Number(budget?.total ?? 0)))
  return <section className="chart-panel"><h2>Orçamentos registados</h2><p className="chart-caption">Comparação em euros, na mesma escala.</p>
    {rows.map(([label,budget,color])=><div className="chart-budget" key={label}><div><span>{label}</span><strong>{exactMoney(budget?.total)}</strong></div>
      {budget?.total != null && <Bar value={Number(budget?.total)} max={maximum} color={color}/>}
      {budget?.missing > 0 && <small>{budget?.missing} sem valor registado</small>}
    </div>)}
  </section>
}

export default function DashboardCharts({ dashboard }) {
  const units = dashboard.unit_totals && [...dashboard.unit_totals].sort((a,b)=>b.total-a.total || a.label.localeCompare(b.label,'pt'))
  const max = units?.[0]?.total || 0
  const budgetUnits = units && [...units].sort((a, b) => Number(b.organizationBudget?.total || 0) - Number(a.organizationBudget?.total || 0) || a.label.localeCompare(b.label, 'pt'))
  const maxBudget = Math.max(0, ...(budgetUnits || []).map(unit => Number(unit.organizationBudget?.total || 0)))
  return <div className="dashboard-charts">
    <ApprovalTimeline history={dashboard.report?.approvalHistory} year={dashboard.today?.slice(0,4)}/>
    {dashboard.report?.strategyAlignment && <StrategyAlignment alignment={dashboard.report.strategyAlignment} />}
    <ActivePipeline applications={dashboard.applications}/>
    <States applications={dashboard.applications}/><Budgets applications={dashboard.applications}/>
    <section className="chart-panel chart-units"><h2>Candidaturas por unidade</h2><p className="chart-caption">Cada candidatura conta na unidade principal do responsável.</p>
      {!units ? <p>Sem acesso aos indicadores do diretório.</p> : !units.length ? <p>Sem unidades para apresentar.</p> :
        <ul>{units.map(unit=><li key={unit.unitId || 'unassigned'}><span>{unit.label}{unit.lifecycle==='ARCHIVED' ? ' (arquivada)' : ''}</span>
          <Bar value={unit.total} max={max} color="var(--dashboard-blue)"/><strong>{unit.total}</strong></li>)}</ul>}
    </section>
    <section className="chart-panel chart-units"><h2>Orçamento da organização por unidade</h2>
      {!budgetUnits ? <p>Sem acesso aos indicadores do diretório.</p> : !budgetUnits.length ? <p>Sem unidades para apresentar.</p> :
        budgetUnits.map(unit => <div className="chart-budget" key={unit.unitId || 'unassigned'}>
          <div><span>{unit.label}{unit.lifecycle === 'ARCHIVED' ? ' (arquivada)' : ''}</span><strong>{exactMoney(unit.organizationBudget?.total)}</strong></div>
          {unit.organizationBudget?.total != null && <Bar value={Number(unit.organizationBudget.total)} max={maxBudget} color="var(--dashboard-violet)"/>}
          {unit.organizationBudget?.missing > 0 && <small>{unit.organizationBudget.missing} sem valor registado</small>}
        </div>)}
    </section>
  </div>
}
