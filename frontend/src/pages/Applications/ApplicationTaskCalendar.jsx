import { useRef, useState } from 'react'
import FormModal from '../../components/FormModal'
import { dateLabel } from './lifecycle'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { lisbonDay } from '../../api/organizationDashboard'
import { atNoon, dayLabel, monthLabel, monthWeeks, shiftMonth, weekdays } from './calendarMonth'
import './application-task-calendar.css'

function CalendarTask({ task, today, labels, onOpen, disabled }) {
  const overdue = task.status === 'OPEN' && task.deadline < today
  return <button type="button" className="task-calendar-event" data-state={overdue ? 'OVERDUE' : task.status}
    aria-label={`Ver tarefa ${task.title}`} aria-haspopup="dialog" disabled={disabled}
    onClick={event => onOpen({ taskId: task.taskId }, event.currentTarget)}>
    <strong>{task.title}</strong>
    <span className="task-calendar-state">{overdue ? 'Em atraso' : labels[task.status]}</span>
  </button>
}

export default function ApplicationTaskCalendar({ tasks, memberName, labels, onEdit, disabled, editing, onClose, returnFocusRef }) {
  const today = lisbonDay()
  const [selection, setSelection] = useState(null)
  const modalTrigger = useRef(null)
  const selectedTasks = selection ? tasks.filter(task => selection.taskId ? task.taskId === selection.taskId : task.deadline === selection.day) : []
  const openDetails = (next, trigger) => { modalTrigger.current = trigger; setSelection(next) }
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const tasksByDay = new Map()
  for (const task of tasks) {
    if (!task.deadline?.startsWith(month + '-')) continue
    const dayTasks = tasksByDay.get(task.deadline) || []
    dayTasks.push(task)
    tasksByDay.set(task.deadline, dayTasks)
  }
  const agenda = [...tasksByDay].sort(([a], [b]) => a.localeCompare(b))
  const renderTasks = (day, compact = false) => {
    const dayTasks = tasksByDay.get(day) || []
    const shown = compact ? dayTasks.slice(0, 2) : dayTasks
    return <>{shown.map(task => <CalendarTask key={task.taskId} {...{ task, today, labels, disabled }} onOpen={openDetails} />)}
      {compact && dayTasks.length > 2 && <button type="button" className="task-calendar-more" disabled={disabled}
        aria-haspopup="dialog" aria-label={`Ver as ${dayTasks.length} tarefas de ${dateLabel(day)}`}
        onClick={event => openDetails({ day }, event.currentTarget)}>+ {dayTasks.length - 2} {dayTasks.length === 3 ? 'tarefa' : 'tarefas'}</button>}
    </>
  }
  const label = monthLabel.format(atNoon(month + '-01'))

  const calendar = <div className="task-calendar">
    <div className="task-calendar-toolbar">
      <h3 aria-live="polite">{label}</h3>
      <div className="task-calendar-navigation">
        <button type="button" className="btn btn-outline" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <button type="button" className="btn btn-secondary" onClick={() => setMonth(today.slice(0, 7))}>Hoje</button>
        <button type="button" className="btn btn-outline" aria-label="Mês seguinte" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <table className="task-calendar-grid" aria-label={`Prazos das tarefas em ${label}`}>
      <thead><tr>{weekdays.map(day => <th key={day} scope="col" aria-label={day}>{day.slice(0, 3)}</th>)}</tr></thead>
      <tbody>{monthWeeks(month).map((week, index) =>
        <tr key={index}>{week.map((date, column) => {
          if (!date) return <td key={column} className="task-calendar-outside" />
          return <td key={column} data-today={date === today}>
            <time dateTime={date} aria-label={dayLabel.format(atNoon(date))} aria-current={date === today ? 'date' : undefined}>{Number(date.slice(-2))}</time>
            {renderTasks(date, true)}
          </td>
        })}</tr>
      )}</tbody>
    </table>
    {agenda.length
      ? <ol className="task-calendar-agenda" aria-label={`Agenda de ${label}`}>
          {agenda.map(([day]) => <li key={day}>
            <h4><time dateTime={day}>{dayLabel.format(atNoon(day))}</time></h4>
            {renderTasks(day)}
          </li>)}
        </ol>
      : <p className="task-calendar-empty" role="status">Sem prazos nas tarefas carregadas para este mês.</p>}
  </div>

  return <>
    <FormModal title="Calendário de tarefas" className="task-calendar-modal" onClose={onClose}
      returnFocusRef={returnFocusRef} active={!editing && selectedTasks.length === 0}>
      {calendar}
    </FormModal>
    {!editing && selectedTasks.length > 0 && <FormModal title={selection.taskId ? 'Detalhes da tarefa' : `Tarefas de ${dateLabel(selection.day)}`}
      returnFocusRef={modalTrigger} onClose={() => setSelection(null)} className="task-calendar-details">
      {selectedTasks.map(task => <article key={task.taskId}>
        <h3>{task.title}</h3>
        {task.description && <p className="task-description">{task.description}</p>}
        <dl><div><dt>Responsável</dt><dd>{memberName(task.responsibleMembershipId)}</dd></div>
          <div><dt>Prazo</dt><dd>{dateLabel(task.deadline)}</dd></div>
          <div><dt>Estado</dt><dd>{labels[task.status]}{task.status === 'OPEN' && task.deadline < today ? ' · Em atraso' : ''}</dd></div></dl>
        {onEdit && task.status === 'OPEN' && <button type="button" className="btn btn-primary" disabled={disabled}
          onClick={() => { setSelection(null); onEdit(task, modalTrigger.current) }}>Editar tarefa</button>}
      </article>)}
    </FormModal>}
  </>
}
