import { notificationGroups } from './notificationGroups'
import FilterBar from '../components/FilterBar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { organizationNotificationsApi } from '../api/api'
import { useAuth } from '../contexts/AuthContext'
import { readScope, startConfirmedRead } from '../api/confirmedReads'
import { Bell, CalendarClock, FileText, CheckCheck, ArrowRight } from 'lucide-react'
import { useToast } from '../components/ToastProvider'
import LoadingIndicator from '../components/LoadingIndicator'
import EmptyStatePanel from '../components/EmptyStatePanel'
import './notifications.css'
import OrganizationNotices from '../components/OrganizationNotices'

/* ── Only types that have real data ─────────────────────────────────────── */
const TYPE_OPTIONS = [
  { key: 'APPLICATION_STATUS_CHANGED', label: 'Candidatura' },
  { key: 'APPLICATION_TEAM_ADDED', label: 'Equipa' },
  { key: 'APPLICATION_PREPARATION', label: 'Preparação' },
  { key: 'APPLICATION_APPROVED', label: 'Aprovação' },
  { key: 'DEADLINE_30_DAYS', label: 'Prazo · 30 dias' },
  { key: 'DEADLINE_7_DAYS', label: 'Prazo · 7 dias' },
  { key: 'DEADLINE_1_DAYS', label: 'Prazo · 1 dia' },
  { key: 'NEW_OPPORTUNITY', label: 'Oportunidade' },
  { key: 'OPPORTUNITY_OPENED', label: 'Abertura' },
  { key: 'BROADCAST',        label: 'Geral' },
]

const TYPE_LABELS = {
  BROADCAST:               'Geral',
  NEW_OPPORTUNITY:         'Oportunidade',
  OPPORTUNITY_OPENED:      'Abertura',
  APPLICATION_STATUS_CHANGED: 'Candidatura',
  APPLICATION_PREPARATION: 'Candidatura',
  APPLICATION_TEAM_ADDED:  'Equipa',
  APPLICATION_APPROVED:    'Aprovação',
  DEADLINE_30_DAYS: 'Prazo · 30 dias', DEADLINE_7_DAYS: 'Prazo · 7 dias', DEADLINE_1_DAYS: 'Prazo · 1 dia',
}

const TYPE_SEVERITY = {
  BROADCAST:               'info',
  NEW_OPPORTUNITY:         'success',
  OPPORTUNITY_OPENED:      'success',
  APPLICATION_STATUS_CHANGED: 'info',
  APPLICATION_PREPARATION: 'warning',
  APPLICATION_TEAM_ADDED:  'info',
  APPLICATION_APPROVED:    'success',
  DEADLINE_30_DAYS: 'warning', DEADLINE_7_DAYS: 'warning', DEADLINE_1_DAYS: 'warning',
}

function notificationTarget(n) {
  if (n.related_application_id) return {
    label: n.application_title || 'Abrir candidatura',
    path:  `/candidaturas/${n.related_application_id}`,
  }
  if (n.related_opportunity_id) return {
    label: n.opportunity_title || 'Abrir oportunidade',
    path:  `/oportunidades/${n.related_opportunity_id}`,
  }
  // An internal notice can include a standalone link to a candidature.
  if (n.type === 'BROADCAST') {
    const link = n.message?.match(/^\[([^\]\r\n]{1,200})\]\((\/candidaturas\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\)$/im)
    if (link) return { label: link[1], path: link[2], message: n.message.replace(link[0], '').trim() }
  }
  return null
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function Notifications() {
  const { user, organization } = useAuth()
  if (!organization) return <p role="status">Esta conta não tem uma entidade associada para consultar alertas.</p>
  return <NotificationsWorkspace key={`${user?.id}:${organization?.id}:${organization?.membershipVersion || ''}`}
    organizationId={organization?.id} organizationName={organization?.displayName} scope={readScope(user?.id, organization?.id)} />
}

export function NotificationsWorkspace({ organizationId, organizationName, scope = null }) {
  const [groupClock, setGroupClock] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setGroupClock(new Date()), 60000); return () => clearInterval(timer) }, [])
  const [section, setSection] = useState("Alertas")
  const [searchParams, setSearchParams] = useSearchParams()
  const api = organizationNotificationsApi
  const alive = useRef(false), requestId = useRef(0), actionLock = useRef(false)
  // Alerts this user and organization already received are shown at once and
  // read again on every entry.
  const [opening] = useState(() => startConfirmedRead(scope, `alerts:${searchParams.get('unread') === '1' ? 1 : 0}`).held)
  const [rows,       setRows]       = useState(opening?.values || [])
  const [truncated, setTruncated] = useState(opening?.truncated === true)
  const [refreshWarning, setRefreshWarning] = useState(false)
  const [loading,    setLoading]    = useState(!opening)
  const [error, setError] = useState(''), [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false)
  const unreadOnly = searchParams.get('unread') === '1'
  const typeFilter = searchParams.get('type') || ''
  const changeFilter = (name, value) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(name, value); else next.delete(name)
    setSearchParams(next, { replace: true })
  }

  // Interest modal state
  const toast = useToast()

  /* load ----------------------------------------------------------------- */
  const load = useCallback(() => {
    const current = ++requestId.current, read = startConfirmedRead(scope, `alerts:${unreadOnly ? 1 : 0}`)
    setLoading(!read.held); setError(''); setRefreshWarning(false)
    if (read.held) { setRows(read.held.values); setTruncated(read.held.truncated) }
    const params = unreadOnly ? { unread: true } : {}
    return Promise.resolve(api.refreshList(params, organizationId))
      .catch(e => {
        if (e.response?.status && e.response.status < 500) throw e
        if (!alive.current || current !== requestId.current) return null
        setRefreshWarning(true)
        return api.list(params, organizationId)
      })
      .then(r => {
        if (!r || !alive.current || current !== requestId.current) return
        const values = r.data?.notifications || (Array.isArray(r.data) ? r.data : null)
        if (!Array.isArray(values)) throw new Error('Invalid notification response')
        read.keep({ values, truncated: r.data?.truncated === true })
        setRows(values); setTruncated(r.data?.truncated === true)
      })
      .catch(() => {
        if (!alive.current || current !== requestId.current) return
        read.drop(); setRows([]); setError('Não foi possível obter os alertas. Tente novamente.')
      })
      .finally(() => { if (alive.current && current === requestId.current) setLoading(false) })
  }, [api, organizationId, unreadOnly, scope])
  useEffect(() => {
    alive.current = true; load()
    return () => { alive.current = false; requestId.current++ }
  }, [load])

  /* filter --------------------------------------------------------------- */
  const visibleRows = useMemo(
    () => rows.filter(r => (!typeFilter || r.type === typeFilter) && (!unreadOnly || !r.is_read)),
    [rows, typeFilter, unreadOnly],
  )

  const typeCounts = useMemo(() =>
    rows.reduce((acc, r) => {
      const k = r.type || 'BROADCAST'
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {}),
    [rows],
  )

  /* actions -------------------------------------------------------------- */
  const markRead = async (id, silently = false) => {
    if (actionLock.current || !alive.current) return
    actionLock.current = true; setBusy(true); setActionError('')
    try {
      await api.markRead(id, organizationId)
      if (!alive.current) return
      requestId.current++
      setLoading(false)
      setRows(rs => rs.map(r => r.id === id ? { ...r, is_read: true } : r))
      window.dispatchEvent(new Event('notifications:changed'))
      if (!silently) toast.success('Notificação atualizada', 'Marcada como lida.')
    } catch {
      if (alive.current) setActionError('Não foi possível marcar o alerta como lido. Pode repetir a ação.')
    } finally { actionLock.current = false; if (alive.current) setBusy(false) }
  }

  const markAll = async () => {
    if (actionLock.current || !alive.current) return
    actionLock.current = true; setBusy(true); setActionError('')
    try {
      await api.markAllRead(organizationId)
      if (!alive.current) return
      requestId.current++
      setLoading(false)
      setRows(rs => rs.map(r => ({ ...r, is_read: true })))
      window.dispatchEvent(new Event('notifications:changed'))
      toast.success('Notificações atualizadas', 'Todas foram marcadas como lidas.')
    } catch {
      if (alive.current) setActionError('Não foi possível marcar todos os alertas como lidos. Pode repetir a ação.')
    } finally { actionLock.current = false; if (alive.current) setBusy(false) }
  }

  const unreadCount = rows.filter(r => !r.is_read).length
  const hasFilters  = unreadOnly || Boolean(typeFilter)

  return (
    <div className="alerts-workspace">
      {/* Toolbar */}
      <header className="alerts-header"><p>{organizationName}</p><h1>Alertas e comunicação</h1></header>
      <div role="tablist" aria-label="Área de notificações" className="filter-options">
        {['Alertas', 'Comunicação'].map((name, index) => (
          <button key={name} id={`notification-tab-${index}`} role="tab"
            className={section === name ? 'btn btn-primary' : 'btn btn-outline'}
            aria-selected={section === name} aria-controls={`notification-panel-${index}`}
            tabIndex={section === name ? 0 : -1} onClick={() => setSection(name)}
            onKeyDown={event => {
              const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key]
              if (next === undefined) return
              event.preventDefault()
              const tab = event.currentTarget.parentElement.children[next]
              tab.focus()
              tab.click()
            }}>{name}</button>
        ))}
      </div>
      <div role="tabpanel" id="notification-panel-0" aria-labelledby="notification-tab-0" hidden={section !== 'Alertas'}>
      <FilterBar aria-label="Filtros de alertas">
        <div className="filter-options">
          {/* Unread toggle */}
          <label className="checkbox-label">
            <input type="checkbox" checked={unreadOnly}
              disabled={busy} onChange={e => changeFilter('unread', e.target.checked ? '1' : '')} />
            Apenas não lidas
          </label>

          {/* Type filters — only types with data */}
          <button
            className="btn btn-outline btn-sm"
            data-alert-focus-fallback aria-pressed={typeFilter === ''} disabled={busy} onClick={() => changeFilter('type', '')}>
            Todos {rows.length > 0 && `(${rows.length})`}
          </button>

          {TYPE_OPTIONS.map(({ key, label }) => {
            const count = typeCounts[key] || 0
            if (count === 0 && typeFilter !== key) return null   // hide filter if no notifications of that type
            return (
              <button key={key}
                className="btn btn-outline btn-sm"
                data-alert-focus-fallback={typeFilter === key || undefined} aria-pressed={typeFilter === key} disabled={busy} onClick={() => changeFilter('type', key)}>
                {label} ({count})
              </button>
            )
          })}
        </div>

        <div className="filter-actions filter-wide">
          <button className="btn btn-outline" disabled={busy || loading} onClick={load}>Atualizar alertas</button>
          {hasFilters && (
            <button className="btn btn-secondary"
              disabled={busy} onClick={() => setSearchParams({}, { replace: true })}>
              Limpar filtros
            </button>
          )}
          {!error && !loading && unreadCount > 0 && (
            <button className="btn btn-outline" disabled={busy} onClick={markAll}>
              <CheckCheck size={14} /> Marcar todas como lidas
            </button>
          )}
        </div>
      </FilterBar>

      {actionError && <p role="alert" className="text-danger">{actionError}</p>}
      {!error && !loading && refreshWarning && <p role="status" className="alert alert-warning">A atualização de prazos não foi concluída. A mostrar os alertas já guardados. <button className="btn btn-outline" onClick={load}>Atualizar prazos novamente</button></p>}
      {!error && !loading && truncated && <p className="text-muted">A mostrar os 100 alertas mais recentes desta seleção. Os filtros por tipo aplicam-se à lista apresentada.</p>}

      {/* List */}
      {error ? (
        <div role="alert" data-alert-results-ready><p>{error}</p><button className="btn btn-outline" onClick={load}>Tentar novamente</button></div>
      ) : loading ? (
        <LoadingIndicator>A consultar alertas…</LoadingIndicator>
      ) : visibleRows.length === 0 ? (
        <div data-alert-results-ready><EmptyStatePanel title={hasFilters ? 'Nenhuma notificação com estes filtros.' : 'Nenhuma notificação.'}
          description={hasFilters ? 'Limpe os filtros para consultar todos os alertas.' : 'Os alertas da organização aparecem aqui quando estiverem disponíveis.'}
          actionLabel={hasFilters ? 'Ver todos os alertas' : undefined} onAction={hasFilters ? () => setSearchParams({}, {replace:true}) : undefined}/></div>
      ) : (
        <div className="notif-list" data-alert-results-ready>
          {notificationGroups(visibleRows, groupClock).map(group => <section className="notif-date-group" aria-label={group.label} key={group.label}>
            <h2>{group.label}</h2>
            {group.rows.map(n => {
            const target   = notificationTarget(n)
            const severity = TYPE_SEVERITY[n.type] || 'info'

            return (
              <div key={n.id}
                className={`notif-item notif-${severity}${!n.is_read ? ' unread' : ''}`}>

                <span className="notif-icon" aria-hidden="true">
                  {n.type?.startsWith('DEADLINE_') ? <CalendarClock size={16}/> : n.related_application_id ? <FileText size={16}/> : <Bell size={16}/>}
                </span>

                <div className="notif-body">
                  <div className="notif-line">
                    <span className={`chip chip-${severity === 'warning' ? 'orange' : severity === 'success' ? 'green' : 'blue'}`}>
                      {TYPE_LABELS[n.type] || n.type}
                    </span>
                    <strong className="notif-title">{n.title}</strong>
                    {!n.is_read && <span className="notif-unread-label">Não lido</span>}
                  </div>

                  <p className="notif-msg">{target?.message ?? n.message}</p>

                  {/* Link + Interest button row */}
                  <div className="notif-actions">
                    {target && (
                      <Link className="notif-target" data-alert-id={n.id} state={{alertQuery:searchParams.toString()}} to={target.path}
                        onClick={() => !n.is_read && markRead(n.id, true)}>
                        {target.label} <ArrowRight size={14} aria-hidden="true"/>
                      </Link>
                    )}

                  </div>

                  <span className="notif-ts">
                    {Number.isFinite(Date.parse(n.created_at)) ? new Date(n.created_at).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }) : 'Data indisponível'}
                  </span>
                </div>

                {/* Mark read */}
                {!n.is_read && (
                  <button className="btn-icon" disabled={busy} onClick={() => markRead(n.id)}
                    title="Marcar como lida" aria-label={`Marcar como lida: ${n.title}`}>
                    <CheckCheck size={14} />
                  </button>
                )}
              </div>
            )
          })}
          </section>)}
        </div>
      )}

      </div>
      <div role="tabpanel" id="notification-panel-1" aria-labelledby="notification-tab-1" hidden={section !== 'Comunicação'}>
        <OrganizationNotices organizationId={organizationId} organizationName={organizationName} onSent={load} />
      </div>
    </div>
  )
}
