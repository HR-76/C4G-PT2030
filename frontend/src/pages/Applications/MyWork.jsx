import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarDays, ChevronRight, ListChecks } from 'lucide-react'
import { privateApplicationsApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import { readScope, startConfirmedRead } from '../../api/confirmedReads'
import FormModal from '../../components/FormModal'
import './my-work.css'

const initial = { q: '', applicationQ: '', status: 'OPEN', period: 'all' }
const groups = [['overdue', 'Em atraso'], ['today', 'Hoje'], ['upcoming', 'Próximas'], ['completed', 'Concluídas'], ['cancelled', 'Canceladas']]
const states = { OPEN: 'Por concluir', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' }
const date = value => value?.split('-').reverse().join('/')

export default function MyWork() {
  const { user, organization } = useAuth()
  if (!organization?.id) return <div className="page"><h1>O meu trabalho</h1><p>Selecione uma organização para consultar as suas tarefas.</p></div>
  return <Work key={`${user?.id}:${organization.id}`} organization={organization} scope={readScope(user?.id, organization.id)} />
}

function Work({ organization, scope }) {
  // The first page of a query already confirmed is shown at once and read again.
  const readName = (query, next) => next ? null : `my-work:${JSON.stringify(query)}`
  const [draft, setDraft] = useState(initial), [filters, setFilters] = useState(initial)
  const [cursor, setCursor] = useState(null), [reload, setReload] = useState(0)
  const [data, setData] = useState(() => startConfirmedRead(scope, readName(initial, null)).held), [loading, setLoading] = useState(!data), [error, setError] = useState('')
  const [selected, setSelected] = useState(null), trigger = useRef(null)
  const reset = next => { setSelected(null); setData(null); setCursor(null); setFilters(next); setReload(n => n + 1) }
  useEffect(() => {
    const controller = new AbortController(), read = startConfirmedRead(scope, readName(filters, cursor))
    setLoading(!read.held); setError(''); setSelected(null)
    if (read.held) setData(read.held)
    privateApplicationsApi.myWork({ ...filters, ...(cursor ? { cursor } : {}) }, organization.id, controller.signal).then(({ data: result }) => {
      read.keep(result)
      if (controller.signal.aborted) return
      setData(previous => ({ ...result, items: cursor ? [...new Map([...(previous?.items || []), ...result.items].map(task => [task.taskId, task])).values()] : result.items }))
    }).catch(failure => {
      if (controller.signal.aborted) return
      read.drop(); setData(null)
      setError([401, 403, 404].includes(failure.response?.status) ? 'Não foi possível autorizar a consulta. Confirme o acesso à organização.' : 'Não foi possível carregar as tarefas. Repita a consulta.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope is read at that moment.
  }, [filters, cursor, reload, organization.id])
  useEffect(() => {
    const refresh = () => { setSelected(null); setData(null); setCursor(null); setReload(n => n + 1) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const open = (task, event) => { trigger.current = event.currentTarget; setSelected(task) }
  const change = event => setDraft(value => ({ ...value, [event.target.name]: event.target.value }))
  return <div className="page my-work">
    <header className="my-work-heading"><div><span className="my-work-eyebrow"><ListChecks size={17} aria-hidden="true" data-icon-tone="violet" /> Trabalho diário</span><h1>O meu trabalho</h1><p>As suas tarefas em todas as candidaturas acessíveis de {organization.name}.</p></div>
      <button className="btn btn-outline" disabled={loading} onClick={() => reset(filters)}>Atualizar</button></header>
    <form className="my-work-filters" onSubmit={event => { event.preventDefault(); reset({ ...draft }) }} aria-label="Filtros de tarefas">
      <label>Tarefa<input name="q" value={draft.q} maxLength={200} onChange={change} placeholder="Pesquisar tarefa" /></label>
      <label>Candidatura<input name="applicationQ" value={draft.applicationQ} maxLength={200} onChange={change} placeholder="Pesquisar candidatura" /></label>
      <label>Estado<select name="status" value={draft.status} onChange={change}><option value="OPEN">Por concluir</option><option value="COMPLETED">Concluídas</option><option value="CANCELLED">Canceladas</option><option value="all">Todos</option></select></label>
      <label>Prazo<select name="period" value={draft.period} onChange={change}><option value="all">Todos</option><option value="overdue">Em atraso</option><option value="today">Hoje</option><option value="upcoming">Próximas</option></select></label>
      <div className="my-work-filter-actions"><button className="btn btn-primary" type="submit">Aplicar filtros</button><button className="btn btn-secondary" type="button" onClick={() => { setDraft(initial); reset(initial) }}>Limpar</button></div>
    </form>
    <p className="my-work-summary" role="status">{loading ? 'A carregar tarefas…' : data ? `${data.items.length} de ${data.total} tarefas · Prazos em hora de Lisboa` : ''}</p>
    {error && <div role="alert" className="my-work-error"><p>{error}</p><button className="btn btn-outline" onClick={() => reset(filters)}>Repetir consulta</button></div>}
    {data?.total === 0 && <div className="my-work-empty"><ListChecks size={32} aria-hidden="true" data-icon-tone="violet" /><h2>Sem tarefas com estes filtros</h2><p>Esta vista apresenta apenas tarefas atribuídas a si nas candidaturas a que tem acesso.</p></div>}
    {data && data.total > 0 && groups.filter(([key]) => data.counts[key] > 0).map(([key, label]) => {
      const tasks = data.items.filter(task => task.group === key)
      return <section className={`my-work-group my-work-${key}`} key={key} aria-label={label}>
        <header><h2>{label} <span>{data.counts[key]}</span></h2><small>{tasks.length} carregadas</small></header>
        {tasks.length ? <ul>{tasks.map(task => <li key={task.taskId}><button className="my-work-task" onClick={event => open(task, event)} aria-label={`Ver tarefa ${task.title}`}>
          <span className="my-work-task-copy"><strong>{task.title}</strong><span>{task.applicationTitle}</span></span>
          <span className="my-work-task-meta"><span className="my-work-state">{states[task.status]}</span><span><CalendarDays size={15} aria-hidden="true" />{date(task.deadline)}</span></span><ChevronRight size={18} aria-hidden="true" />
        </button></li>)}</ul> : <p className="my-work-unloaded">Carregue mais tarefas para consultar este grupo.</p>}
      </section>
    })}
    {data?.nextCursor && <div className="my-work-more"><button className="btn btn-secondary" disabled={loading} onClick={() => setCursor(data.nextCursor)}>Mais tarefas</button></div>}
    {selected && <FormModal title={selected.title} onClose={() => setSelected(null)} returnFocusRef={trigger} className="my-work-modal">
      {selected.description && <p className="task-description">{selected.description}</p>}
      <dl><div><dt>Candidatura</dt><dd>{selected.applicationTitle}</dd></div><div><dt>Responsável</dt><dd>Eu</dd></div><div><dt>Prazo</dt><dd>{date(selected.deadline)} · {groups.find(([key]) => key === selected.group)?.[1]}</dd></div><div><dt>Estado</dt><dd>{states[selected.status]}</dd></div></dl>
      <p>Consulte a equipa da candidatura para acompanhar ou atualizar esta tarefa, de acordo com as suas permissões.</p>
      <Link className="btn btn-primary" to={`/candidaturas/${selected.applicationId}#equipa-tarefas`}>Abrir equipa da candidatura <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </FormModal>}
  </div>
}
