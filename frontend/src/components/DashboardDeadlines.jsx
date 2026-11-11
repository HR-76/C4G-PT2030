import { Link } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import './DashboardDeadlines.css'

const groups = [
  { key: 'overdue', title: 'Em atraso', includes: days => days < 0 },
  { key: 'today', title: 'Hoje', includes: days => days === 0 },
  { key: 'upcoming', title: 'Próximos', includes: days => days > 0 },
]

function civilDate(value) {
  const [year, month, day] = (value || '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : 'Data indisponível'
}

function remaining(days) {
  if (days === 0) return 'Termina hoje'
  const count = Math.abs(days)
  return days < 0 ? `${count} ${count === 1 ? 'dia' : 'dias'} em atraso` : `${count === 1 ? "Falta" : "Faltam"} ${count} ${count === 1 ? 'dia' : 'dias'}`
}

export default function DashboardDeadlines({ deadlines = [], total = deadlines.length }) {
  const partial = total > deadlines.length
  return <section className="dash-section dashboard-next deadline-priorities" aria-label="Prioridades por prazo">
    <div className="section-hd"><CalendarClock size={16} aria-hidden="true"/><h2>Prazos internos</h2><Link to="/candidaturas">Ver candidaturas</Link></div>
    <p className="deadline-scope">Em atraso e até aos próximos 30 dias.</p>
    {partial && <p className="deadline-limit" role="status">{deadlines.length} de {total} prazos apresentados. As contagens abaixo referem-se a esta seleção.</p>}
    {!deadlines.length ? <p>Sem prazos apresentados{partial ? ' nesta seleção.' : ': não há atrasos nem prazos nos próximos 30 dias.'}</p> : groups.map(group => {
      const rows = deadlines.filter(item => group.includes(item.days_left))
      return <div className="deadline-group" data-tone={group.key} key={group.key}>
        <h3>{group.title}<span aria-label={`${rows.length} apresentados`}>{rows.length}</span></h3>
        {rows.length ? <ul>{rows.map(item => <li key={item.id}>
          <Link to={`/candidaturas/${item.id}`}>{item.title}</Link>
          <div className="deadline-meta"><time dateTime={item.deadline}>{civilDate(item.deadline)}</time><span>{remaining(item.days_left)}</span></div>
        </li>)}</ul> : <p className="deadline-empty">{partial ? 'Sem prazos deste grupo na seleção apresentada.' : 'Sem prazos neste grupo.'}</p>}
      </div>
    })}
  </section>
}
