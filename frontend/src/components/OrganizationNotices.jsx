import FilterBar from '../components/FilterBar'
import SearchInput from './SearchInput'
import { useEffect, useRef, useState } from 'react'
import { organizationNotificationsApi as api } from '../api/api'
import './OrganizationNotices.css'

export default function OrganizationNotices({ organizationId, organizationName, onSent }) {
  const alive = useRef(false), lock = useRef(false), sequence = useRef(0), contextSequence = useRef(0)
  const [context, setContext] = useState(null), [contextError, setContextError] = useState(false)
  const [open, setOpen] = useState(false), [title, setTitle] = useState(''), [message, setMessage] = useState('')
  const [selected, setSelected] = useState([]), [search, setSearch] = useState(''), [preview, setPreview] = useState(null)
  const [attempted, setAttempted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState(''), [historyBusy, setHistoryBusy] = useState(false)
  const [pages, setPages] = useState([null]), [detail, setDetail] = useState(null)
  const loadContext = () => {
    const current = ++contextSequence.current
    setContextError(false)
    api.noticeContext(organizationId).then(r => { if (alive.current && current === contextSequence.current) setContext(r.data) })
      .catch(() => { if (alive.current && current === contextSequence.current) setContextError(true) })
  }
  useEffect(() => { alive.current = true; loadContext(); return () => { alive.current = false; sequence.current++; contextSequence.current++ } }, [organizationId])
  const loadHistory = async (cursor = null) => {
    const current = ++sequence.current
    setHistoryBusy(true); setHistoryError(''); setDetail(null)
    try {
      const r = await api.noticeHistory(cursor ? { cursor } : {}, organizationId)
      if (alive.current && current === sequence.current) setHistory(r.data)
    } catch { if (alive.current && current === sequence.current) { setHistory(null); setHistoryError('Não foi possível consultar o histórico.') } }
    finally { if (alive.current && current === sequence.current) setHistoryBusy(false) }
  }
  const showDetail = async id => {
    const current = ++sequence.current; setHistoryBusy(true); setHistoryError(''); setDetail(null)
    try { const r = await api.noticeGet(id, organizationId); if (alive.current && current === sequence.current) setDetail(r.data) }
    catch { if (alive.current && current === sequence.current) setHistoryError('Não foi possível consultar este aviso.') }
    finally { if (alive.current && current === sequence.current) setHistoryBusy(false) }
  }
  const review = e => {
    e.preventDefault(); setError(''); setSuccess('')
    if (!title.trim() || !message.trim() || !selected.length) { setError('Preencha o título, a mensagem e selecione pelo menos uma pessoa.'); return }
    setPreview({ title: title.trim(), message: message.trim(), recipientMembershipIds: [...selected], idempotencyKey: crypto.randomUUID() })
    setAttempted(false)
  }
  const send = async () => {
    if (!preview || lock.current || !alive.current) return
    lock.current = true; setBusy(true); setAttempted(true); setError('')
    try {
      const r = await api.noticeSend(preview, organizationId)
      if (!alive.current) return
      setSuccess(`Aviso enviado a ${r.data.recipientCount} pessoa${r.data.recipientCount === 1 ? '' : 's'}.`)
      setTitle(''); setMessage(''); setSelected([]); setPreview(null); setAttempted(false); setPages([null])
      loadHistory(); onSent?.(); window.dispatchEvent(new Event('notifications:changed'))
    } catch (e) {
      if (!alive.current) return
      const code = e.response?.data?.error?.code
      if (code === 'RECIPIENT_UNAVAILABLE' || code === 'INVALID_INPUT') {
        setPreview(null); setAttempted(false); setSelected([]); loadContext()
        setError('O aviso não foi enviado. Reveja os dados e selecione novamente os membros ativos.')
      } else setError('Não foi possível confirmar o envio. Repita a confirmação para obter o resultado sem duplicar o aviso.')
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  if (contextError) return <p role="alert">Não foi possível verificar o acesso à comunicação. <button className="btn btn-outline btn-sm" onClick={loadContext}>Tentar novamente</button></p>
  if (!context) return <p role="status">A consultar permissões…</p>
  if (!context.canManage) return <p>A comunicação da organização está disponível apenas para quem tem permissão para gerir avisos.</p>
  const recipients = context.recipients || []
  return <section className="organization-notices" aria-label="Comunicação da organização">
    <div className="notice-heading"><h2>Comunicação da organização</h2>
      <button className="btn btn-outline" aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open); if (!open) loadHistory(pages.at(-1)) }}>{open ? 'Fechar comunicação' : 'Preparar aviso e consultar histórico'}</button></div>
    {open && <>
      {success && <p role="status" className="notice-success">{success}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!preview ? <form onSubmit={review}>
        <div className="notice-form-grid"><div>
          <label className="notice-field">Título<input maxLength={200} required value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label className="notice-field">Mensagem<textarea rows={6} maxLength={5000} required value={message} onChange={e => setMessage(e.target.value)} /></label>
          <p className="text-muted">O aviso será apresentado na caixa de alertas.</p>
        </div><fieldset><legend>Destinatários · {selected.length} selecionados</legend>
          <FilterBar variant="compact"><label className="filter-search">Procurar pessoa<SearchInput value={search} onChange={e => setSearch(e.target.value)} /></label></FilterBar>
          <div className="notice-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setSelected(recipients.map(r => r.membershipId))}>Selecionar todos os membros ativos ({recipients.length})</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected([])}>Limpar seleção</button></div>
          <div className="notice-recipients">{recipients.filter(r => r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(r => <label key={r.membershipId}>
            <input type="checkbox" checked={selected.includes(r.membershipId)} onChange={e => setSelected(ids => e.target.checked ? [...ids, r.membershipId] : ids.filter(id => id !== r.membershipId))} />{r.name}
          </label>)}</div>
          {!recipients.length && <p>Não há membros ativos disponíveis.</p>}
        </fieldset></div>
        <button className="btn btn-primary" type="submit" disabled={!selected.length}>Rever aviso</button>
      </form> : <section className="notice-preview" aria-label="Rever aviso">
        <h3>Rever antes de enviar</h3><p><strong>Organização:</strong> {organizationName || 'Organização ativa'}</p>
        <h4>{preview.title}</h4><p className="notice-content">{preview.message}</p>
        <p><strong>Destinatários ({preview.recipientMembershipIds.length}):</strong> {recipients.filter(r => preview.recipientMembershipIds.includes(r.membershipId)).map(r => r.name).join('; ')}</p>
        <div className="notice-actions"><button className="btn btn-primary" disabled={busy} onClick={send}>{busy ? 'A confirmar…' : attempted ? 'Repetir confirmação do envio' : 'Confirmar e enviar aviso'}</button>
          {!attempted && <button className="btn btn-secondary" onClick={() => setPreview(null)}>Voltar a editar</button>}</div>
      </section>}
      <section className="notice-history" aria-label="Histórico de avisos"><div className="notice-heading"><h3>Histórico de avisos</h3><button className="btn btn-outline btn-sm" disabled={historyBusy} onClick={() => { setPages([null]); loadHistory() }}>Atualizar histórico</button></div>
        {historyError && <p role="alert">{historyError}</p>}
        {historyBusy ? <p role="status">A consultar…</p> : history && <>
          {!history.items.length ? <p className="text-muted">Ainda não foram enviados avisos nesta organização.</p> : <div className="notice-table"><table><thead><tr><th>Data</th><th>Aviso</th><th>Autor</th><th>Pessoas</th><th>Ação</th></tr></thead><tbody>{history.items.map(r => <tr key={r.noticeId}>
            <td>{new Date(r.createdAt).toLocaleString('pt-PT')}</td><td>{r.title}</td><td>{r.authorName}</td><td>{r.recipientCount}</td><td><button className="btn btn-outline btn-sm" onClick={() => showDetail(r.noticeId)}>Ver aviso</button></td>
          </tr>)}</tbody></table></div>}
          <div className="notice-actions"><button className="btn btn-secondary btn-sm" disabled={pages.length < 2} onClick={() => { const prev = pages.slice(0, -1); setPages(prev); loadHistory(prev.at(-1)) }}>Anterior</button><span>Página {pages.length}</span>
            <button className="btn btn-secondary btn-sm" disabled={!history.nextCursor} onClick={() => { setPages(p => [...p, history.nextCursor]); loadHistory(history.nextCursor) }}>Seguinte</button></div>
        </>}
        {detail && <article className="notice-preview"><h4>{detail.title}</h4><p className="notice-content">{detail.message}</p><p><strong>Destinatários ({detail.recipientCount}):</strong> {detail.recipients.map(r => r.name).join('; ')}</p><button className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>Fechar detalhe</button></article>}
      </section>
    </>}
  </section>
}
