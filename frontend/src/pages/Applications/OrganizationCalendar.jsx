import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { privateApplicationsApi } from '../../api/api'
import { lisbonDay } from '../../api/organizationDashboard'
import { useAuth } from '../../contexts/AuthContext'
import { applicationDetailTarget } from './navigation'
import { atNoon, dayLabel, monthLabel, monthWeeks, shiftMonth, weekdays } from './calendarMonth'
import { CHIP, LABEL } from './lifecycle'
import './organization-calendar.css'

const agendaDate = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const calendarStatuses = ['IDENTIFIED', 'PREPARATION', 'SUBMITTED']

function CalendarGrid({ month, today, selectedDay, days, onSelect }) {
  const byDate = new Map(days.map(day => [day.date, day]))
  return <table className="organization-calendar-grid" aria-label={`Prazos de ${monthLabel.format(atNoon(month + '-01'))}`}>
    <thead><tr>{weekdays.map(weekday => <th scope="col" key={weekday} aria-label={weekday}>{weekday.slice(0, 3)}</th>)}</tr></thead>
    <tbody>{monthWeeks(month).map((week, index) => <tr key={index}>{week.map((date, column) => {
      if (!date) return <td key={column} className="organization-calendar-outside" />
      const day = byDate.get(date)
      const number = <time dateTime={date} aria-current={date === today ? 'date' : undefined}>{Number(date.slice(-2))}</time>
      return <td key={column} data-today={date === today}>
        {day ? <button type="button" className="organization-calendar-day" onClick={() => onSelect(date)}
          aria-pressed={selectedDay === date} aria-controls="organization-calendar-agenda"
          aria-label={`${dayLabel.format(atNoon(date))}, ${day.count} ${day.count === 1 ? 'prazo' : 'prazos'}`}>
          <span className="organization-calendar-day-top">{number}<span>{day.count}</span></span>
          <span className="organization-calendar-previews" aria-hidden="true">
            {day.previews.map(event => <span key={event.id} data-task={Boolean(event.taskId)}>{event.title}</span>)}
          </span>
        </button> : <div className="organization-calendar-day">{number}</div>}
      </td>
    })}</tr>)}</tbody>
  </table>
}

function Agenda({ result, selectedDay, page, heading, returnTo, onPage, onClearDay }) {
  const data = result?.data
  const title = selectedDay ? `Prazos de ${dayLabel.format(atNoon(selectedDay))}` : 'Próximos prazos'
  return <section className="organization-calendar-agenda" id="organization-calendar-agenda" aria-labelledby="organization-calendar-agenda-title">
    <header>
      <h2 id="organization-calendar-agenda-title" ref={heading} tabIndex={-1}>{title}</h2>
      {selectedDay && <button type="button" className="btn btn-outline btn-sm" onClick={onClearDay}>Ver próximos prazos</button>}
    </header>
    {data?.agenda.length === 0 && <p className="organization-calendar-empty">{selectedDay ? 'Sem prazos neste dia.' : 'Sem próximos prazos.'}</p>}
    {data?.agenda.length > 0 && <ol className="organization-calendar-events">
      {data.agenda.map(event => <li key={event.id}>
        <div className="organization-calendar-event-date">
          <time dateTime={event.date}>{agendaDate.format(atNoon(event.date))}</time>
          <span>{event.taskId ? 'Tarefa' : 'Prazo interno'}</span>
        </div>
        <Link to={applicationDetailTarget(event.applicationId, returnTo) + (event.taskId ? '#equipa-tarefas' : '')}>{event.title}</Link>
        {event.taskId && <span className="organization-calendar-project">{event.applicationTitle}</span>}
        <span className={`chip ${CHIP[event.status]}`}>{LABEL[event.status]}</span>
      </li>)}
    </ol>}
    {data && (page > 1 || data.hasNextPage) && <nav className="organization-calendar-pagination" aria-label="Páginas de prazos">
      <button type="button" className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {page}</span>
      <button type="button" className="btn btn-outline btn-sm" disabled={!data.hasNextPage} onClick={() => onPage(page + 1)}>Seguinte</button>
    </nav>}
  </section>
}

export default function OrganizationCalendar() {
  const { organization } = useAuth()
  const { pathname, search } = useLocation()
  const [params, setParams] = useSearchParams()
  const today = lisbonDay()
  const requestedMonth = params.get('mes')
  const month = requestedMonth && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : today.slice(0, 7)
  const applicationId = params.get('candidatura') || ''
  const requestedStatus = params.get('estado')
  const status = calendarStatuses.includes(requestedStatus) ? requestedStatus : ''
  const selectedDay = monthWeeks(month).flat().includes(params.get('dia')) ? params.get('dia') : null
  const requestedPage = Number(params.get('pagina'))
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1000 ? requestedPage : 1
  const [draft, setDraft] = useState('')
  const [applicationQ, setApplicationQ] = useState('')
  const [response, setResponse] = useState(null)
  const [retry, setRetry] = useState(0)
  const agendaHeading = useRef(null)
  const focusAgenda = useRef(false)
  const monthKey = JSON.stringify([organization.id, month, applicationId, status])
  const requestKey = JSON.stringify([monthKey, applicationQ, selectedDay, page, retry])
  const result = response?.key === requestKey ? response : null
  const monthData = response?.monthKey === monthKey ? response.data : null

  useEffect(() => {
    const controller = new AbortController()
    privateApplicationsApi.calendar({
      month, applicationId: applicationId || undefined, applicationQ: applicationQ || undefined,
      status: status || undefined,
      day: selectedDay || undefined, page: page > 1 ? page : undefined,
    }, organization.id, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setResponse({ key: requestKey, monthKey, data })
    }).catch(error => {
      if (!controller.signal.aborted) setResponse({ key: requestKey, error: error?.response?.status || 503 })
    })
    return () => controller.abort()
  }, [requestKey, monthKey, organization.id, month, applicationId, applicationQ, status, selectedDay, page])

  useEffect(() => {
    if (!focusAgenda.current) return
    focusAgenda.current = false
    agendaHeading.current?.focus()
  }, [selectedDay, page])

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value)
      else next.delete(name)
    }
    setParams(next, { replace: true })
  }

  function chooseDay(date) {
    focusAgenda.current = true
    update({ dia: date === selectedDay ? null : date, pagina: null })
  }

  const options = response?.data?.applications || []
  return <div className="page organization-calendar">
    <header className="organization-calendar-heading">
      <h1>Calendário da entidade</h1>
      <div className="organization-calendar-filters">
        <div className="organization-calendar-field">
          <label htmlFor="organization-calendar-project">Candidatura</label>
          <select id="organization-calendar-project" value={applicationId} onChange={event => update({ candidatura: event.target.value, dia: null, pagina: null })}>
            <option value="">Todas as candidaturas em curso</option>
            {applicationId && !options.some(item => item.id === applicationId) && <option value={applicationId}>Candidatura selecionada</option>}
            {options.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
        </div>
        <div className="organization-calendar-field">
          <label htmlFor="organization-calendar-status">Estado da candidatura</label>
          <select id="organization-calendar-status" value={status} onChange={event => update({ estado: event.target.value, dia: null, pagina: null })}>
            <option value="">Todos os estados</option>
            {calendarStatuses.map(value => <option value={value} key={value}>{LABEL[value]}</option>)}
          </select>
        </div>
        {(response?.data?.hasMoreApplications || applicationQ) && <form onSubmit={event => {
          event.preventDefault()
          setApplicationQ(draft.trim())
        }}>
          <div className="organization-calendar-field">
            <label htmlFor="organization-calendar-project-search">Pesquisar candidaturas</label>
            <input id="organization-calendar-project-search" type="search" value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} />
          </div>
          <button type="submit" className="btn btn-outline">Pesquisar</button>
        </form>}
      </div>
    </header>
    {!result && <p className="organization-calendar-feedback" role="status">A carregar prazos…</p>}
    {result?.error && <div className="organization-calendar-feedback" role="alert">
      <p>{result.error === 403 ? 'Sem acesso ao calendário da entidade.' : result.error === 404 && applicationId
        ? 'Esta candidatura já não está disponível no calendário.' : 'Não foi possível carregar o calendário.'}</p>
      {result.error !== 403 && <button type="button" className="btn btn-outline" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}
    </div>}
    <div className="organization-calendar-layout" aria-busy={!result}>
      <section className="organization-calendar-month" aria-labelledby="organization-calendar-month-title">
        <header>
          <h2 id="organization-calendar-month-title" aria-live="polite">{monthLabel.format(atNoon(month + '-01'))}</h2>
          <div className="organization-calendar-month-controls">
            <button className="btn btn-outline btn-icon" type="button" aria-label="Mês anterior" disabled={month === '0001-01'}
              onClick={() => update({ mes: shiftMonth(month, -1), dia: null, pagina: null })}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button className="btn btn-secondary" type="button" onClick={() => update({ mes: null, dia: null, pagina: null })}>Hoje</button>
            <button className="btn btn-outline btn-icon" type="button" aria-label="Mês seguinte" disabled={month === '9999-12'}
              onClick={() => update({ mes: shiftMonth(month, 1), dia: null, pagina: null })}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>
        </header>
        <CalendarGrid month={month} today={monthData?.today || today} days={monthData?.days || []} selectedDay={selectedDay} onSelect={chooseDay} />
        {monthData?.days.length === 0 && <p className="organization-calendar-empty">Sem prazos neste mês.</p>}
      </section>
      <Agenda result={result} selectedDay={selectedDay} page={page} heading={agendaHeading} returnTo={pathname + search}
        onPage={value => { focusAgenda.current = true; update({ pagina: value > 1 ? value : null }) }}
        onClearDay={() => chooseDay(selectedDay)} />
    </div>
  </div>
}
