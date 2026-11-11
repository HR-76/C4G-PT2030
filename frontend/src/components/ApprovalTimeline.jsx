import { useState } from 'react'
import { exactMoney } from '../api/organizationDashboard'

export const emptyPeriod = { total: '0.00', count: 0, missing: 0 }
export const approvalSummary = metric => `${metric.count} ${metric.count === 1 ? 'aprovação' : 'aprovações'}${metric.missing ? ` · ${metric.missing} sem valor` : ''}`
const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export default function ApprovalTimeline({ history, year }) {
  const [selection, setSelection] = useState('')
  const firstYear = Object.keys(history || {}).filter(key => /^\d{4}$/.test(key)).sort()[0] || year
  const years = Array.from({ length: Number(year) - Number(firstYear) + 1 }, (_, i) => String(Number(firstYear) + i))
  const selected = years.includes(selection) ? selection : ''
  const rows = selected ? months.map((label, i) => ({
    label, metric: history?.[`${selected}-${String(i + 1).padStart(2, '0')}`] || emptyPeriod
  })) : years.map(label => ({ label, metric: history?.[label] || emptyPeriod }))
  const maximum = Math.max(1, ...rows.map(row => Number(row.metric.total)))
  return <section className="dash-section approval-timeline" aria-labelledby="approval-timeline">
    <div className="section-hd"><h2 id="approval-timeline" className="shell-scroll-target">Evolução do orçamento aprovado</h2>
      {history?.all?.count > 0 && <label>Ano <select value={selected} onChange={event => setSelection(event.target.value)}>
        <option value="">Todos os anos</option>{years.map(value => <option key={value}>{value}</option>)}
      </select></label>}
    </div>
    {!history ? <p>Histórico indisponível.</p> : !history.all.count ? <p>Sem aprovações registadas.</p> : <>
      <p className="dashboard-budget-caption">Orçamento total dos projetos à data do registo da aprovação.</p>
      <ul className="approval-periods">{rows.map(({ label, metric }) => <li key={label}>
        <strong>{label}</strong><div className="approval-track" aria-hidden="true"><i style={{ width: `${Number(metric.total) / maximum * 100}%` }}/></div>
        <span>{exactMoney(metric.total)} <small>{approvalSummary(metric)}</small></span>
      </li>)}</ul>
    </>}
  </section>
}
