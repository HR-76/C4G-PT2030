import { Link } from 'react-router-dom'
import { Bar, States } from '../components/DashboardCharts'

const periods = [['overdue', 'Em atraso', 'var(--color-danger)'], ['today', 'Hoje', '#d97706'], ['upcoming', 'Próximas', 'var(--color-action)']]

function Unavailable({ title }) {
  return <section className="chart-panel"><h2>{title}</h2><p className="chart-caption" role="alert">Não foi possível carregar estes dados.</p></section>
}

// Charts over what the Técnico may already read: accessible applications by
// status and the open tasks assigned to them. `applications` and `tasks` are
// undefined while loading or absent. A failed applications part is null and says
// so here; failed tasks are already reported by the task list.
export default function TechnicianCharts({ applications, tasks }) {
  if (applications === undefined && !tasks) return null
  const counts = tasks?.counts || {}
  const open = periods.reduce((sum, [code]) => sum + (counts[code] || 0), 0)
  const workload = tasks?.byApplication
  const busiest = Math.max(0, ...(workload?.items || []).map(item => item.total))
  return <div className="dashboard-charts technician-charts">
    {applications === null ? <Unavailable title="As minhas candidaturas por estado" />
      : applications && <States title="As minhas candidaturas por estado" applications={{ total: applications.total, by_status: applications.countsByStatus || {} }} />}
    {tasks && <section className="chart-panel">
      <h2>Tarefas por prazo</h2>
      <p className="chart-caption">{open ? `${open} ${open === 1 ? 'tarefa por concluir' : 'tarefas por concluir'}.` : 'Sem tarefas por concluir.'}</p>
      {open > 0 && periods.map(([code, label, color]) => <div className="chart-budget" key={code}>
        <div><span>{label}</span><strong>{counts[code] || 0}</strong></div>
        <Bar value={counts[code] || 0} max={open} color={color} />
      </div>)}
    </section>}
    {tasks && workload && <section className="chart-panel technician-workload">
      <h2>Carga por candidatura</h2>
      <p className="chart-caption">{workload.items.length ? 'Tarefas por concluir em cada candidatura.' : 'Sem tarefas por concluir.'}</p>
      {workload.items.map(item => <div className="chart-budget" key={item.applicationId}>
        <div><Link to={`/candidaturas/${item.applicationId}#equipa-tarefas`}>{item.title}</Link><strong>{item.total}</strong></div>
        <Bar value={item.total} max={busiest} color="var(--color-action)" />
        {item.overdue > 0 && <small className="technician-workload-overdue">{item.overdue} em atraso</small>}
      </div>)}
      {workload.total > workload.items.length && <p className="chart-caption">A mostrar {workload.items.length} de {workload.total} candidaturas com tarefas.</p>}
    </section>}
  </div>
}
