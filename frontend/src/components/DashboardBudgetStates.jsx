import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { exactMoney } from '../api/organizationDashboard'
import { applicationStatusLabels, primaryApplicationStatuses } from '../utils/applicationStatuses'
import './DashboardBudgetStates.css'

const emptyBudget = { total: '0.00', missing: 0, count: 0 }
const emptyMetrics = { total: 0, organizationBudget: emptyBudget }

function Budget({ value }) {
  return <><span>{exactMoney(value?.total)}</span>{value?.missing > 0 && <small>{value.missing} sem valor</small>}</>
}

export default function DashboardBudgetStates({ states }) {
  const available = states && typeof states === 'object' && !Array.isArray(states)
  const statuses = available ? [...primaryApplicationStatuses, ...Object.keys(applicationStatusLabels).filter(status => !primaryApplicationStatuses.includes(status) && states[status]?.total > 0)] : []
  return <section className="dash-section dashboard-budget-states" aria-labelledby="dashboard-budget-title">
    <div className="section-hd"><Wallet size={16} aria-hidden="true"/><h2 id="dashboard-budget-title" className="shell-scroll-target">Orçamentos por estado</h2></div>
    <p className="dashboard-budget-caption">Orçamentos registados nas candidaturas, agrupados pelo estado atual.</p>
    {!available ? <p role="status">Indicadores por estado indisponíveis.</p> : <ul className="dashboard-budget-grid">
        {statuses.map(status => {
          // A missing state in the complete grouped report means no records.
          // A present state with an unknown amount must retain that uncertainty.
          const metric = Object.hasOwn(states, status) ? states[status] || {} : emptyMetrics
          return <li key={status} className="dashboard-budget-card application-state-row" data-status={status}>
            <h3><Link to={`/candidaturas?status=${status}`}>{applicationStatusLabels[status]}</Link></h3>
            <p><strong>{metric.total ?? '—'}</strong> {metric.total === 1 ? 'candidatura' : 'candidaturas'}</p>
            <dl>
              <dt>Orçamento da organização</dt><dd><Budget value={metric.organizationBudget}/></dd>
            </dl>
          </li>
        })}
      </ul>}
  </section>
}
