import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import FormModal from '../../components/FormModal'
import { privateApplicationsApi as api } from '../../api/api'
import './application-team-chat.css'

const messageDate = new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short',
})
const denied = error => [401, 403, 404].includes(error?.response?.status)

function mergeLatest(previous, page) {
  if (!previous) return page
  if (!page.items.length) return previous
  const first = previous.items.findIndex(item => item.messageId === page.items[0].messageId)
  if (first < 0) return page
  const last = previous.items.findIndex(item => item.messageId === page.items.at(-1).messageId)
  return {
    items: [...previous.items.slice(0, first), ...page.items, ...(last < 0 ? [] : previous.items.slice(last + 1))],
    nextCursor: first > 0 ? previous.nextCursor : page.nextCursor,
  }
}

export default function ApplicationTeamChat({ applicationId, organizationId, open, onClose, returnFocusRef }) {
  const [feed, setFeed] = useState(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [sendError, setSendError] = useState('')
  const panel = useRef(null)
  const scopeRef = useRef(null)
  const intention = useRef(null)
  const follow = useRef(true)
  const anchor = useRef(null)

  const revoke = useCallback(scope => {
    scope.controller.abort()
    intention.current = null
    setDraft('')
    setFeed(null)
    setLoading(false)
    setSending(false)
    setSendError('')
    setUnavailable(true)
    setLoadError('Já não tem acesso ao chat da equipa.')
  }, [])

  const load = useCallback(async (scope, cursor = null) => {
    if (!scope || scope.loading || scope.controller.signal.aborted) return
    scope.loading = true
    setLoading(true)
    const signal = scope.controller.signal
    const requestPage = () => api.chat(applicationId, cursor ? { cursor } : undefined, organizationId, signal)
    try {
      let response
      try {
        response = await requestPage()
      } catch (error) {
        if (signal.aborted || error?.response?.status !== 503) throw error
        // A concurrent session update can briefly prevent the server from authorizing a read.
        await new Promise(resolve => window.setTimeout(resolve, 650))
        if (signal.aborted) return
        response = await requestPage()
      }
      if (signal.aborted) return
      const { data } = response
      if (cursor && panel.current) {
        anchor.current = { height: panel.current.scrollHeight, top: panel.current.scrollTop }
      }
      setFeed(previous => cursor
        ? { items: [...data.items, ...previous.items], nextCursor: data.nextCursor }
        : mergeLatest(previous, data))
      setLoadError('')
    } catch (error) {
      if (scope.controller.signal.aborted) return
      if (denied(error)) revoke(scope)
      else if (cursor && error?.response?.data?.error?.code === 'INVALID_CURSOR') {
        setFeed(null)
        follow.current = true
        setLoadError('A consulta expirou. Atualize o chat para voltar ao histórico.')
      } else setLoadError('Não foi possível carregar as mensagens.')
    } finally {
      scope.loading = false
      if (!scope.controller.signal.aborted) setLoading(false)
    }
  }, [applicationId, organizationId, revoke])

  useEffect(() => {
    if (!open) return
    const scope = { controller: new AbortController(), loading: false, sending: false }
    scopeRef.current = scope
    follow.current = true
    anchor.current = null
    setFeed(null)
    setLoadError('')
    setUnavailable(false)
    void load(scope)
    const timer = window.setInterval(() => {
      if (!document.hidden && !scope.sending) void load(scope)
    }, 15000)
    return () => {
      scope.controller.abort()
      window.clearInterval(timer)
      scopeRef.current = null
    }
  }, [open, load])

  useLayoutEffect(() => {
    const scroll = panel.current
    if (!scroll) return
    if (anchor.current) {
      scroll.scrollTop = anchor.current.top + scroll.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (follow.current) scroll.scrollTop = scroll.scrollHeight
  }, [feed])

  async function send(event) {
    event.preventDefault()
    const scope = scopeRef.current
    const body = draft.trim()
    if (!scope || scope.sending || scope.controller.signal.aborted || !feed || !body || body.length > 2000) return
    scope.sending = true
    setSending(true)
    setSendError('')
    try {
      if (intention.current?.body !== body) intention.current = { messageId: crypto.randomUUID(), body }
      const { data } = await api.chatSend(applicationId, intention.current, organizationId, scope.controller.signal)
      if (scope.controller.signal.aborted) return
      intention.current = null
      setDraft('')
      follow.current = true
      setFeed(previous => previous && !previous.items.some(item => item.messageId === data.messageId)
        ? { ...previous, items: [...previous.items, data] } : previous)
    } catch (error) {
      if (scope.controller.signal.aborted) return
      if (denied(error)) revoke(scope)
      else if (error?.response?.status === 400 || error?.response?.data?.error?.code === 'IDEMPOTENCY_CONFLICT') {
        intention.current = null
        setSendError('A mensagem não foi enviada. Reveja o texto e tente novamente.')
      } else setSendError('Não foi possível confirmar o envio. Prima Enviar para repetir.')
    } finally {
      scope.sending = false
      if (!scope.controller.signal.aborted) setSending(false)
    }
  }

  if (!open) return null
  return <FormModal title="Chat da equipa" className="application-team-chat" onClose={() => { setFeed(null); onClose() }} locked={sending} returnFocusRef={returnFocusRef}>
    <div className="application-chat-history" ref={panel} tabIndex={0} aria-label="Histórico de mensagens"
      onScroll={event => {
        const scroll = event.currentTarget
        follow.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48
      }}>
      {loadError && <div className="application-chat-status">
        <p role="alert">{loadError}</p>
        {!unavailable && <button type="button" className="btn btn-outline btn-sm" disabled={loading}
          onClick={() => load(scopeRef.current)}>Atualizar</button>}
      </div>}
      {!feed && !loadError && <p role="status" className="application-chat-status">A carregar mensagens…</p>}
      {feed?.nextCursor && <button type="button" className="btn btn-outline btn-sm application-chat-older"
        disabled={loading} onClick={() => load(scopeRef.current, feed.nextCursor)}>Mensagens anteriores</button>}
      {feed && feed.items.length === 0 && <p className="application-chat-status">Ainda não há mensagens.</p>}
      {feed?.items.length > 0 && <ol className="application-chat-messages" aria-label="Mensagens">
        {feed.items.map(message => <li key={message.messageId} className={message.own ? 'application-chat-own' : ''}>
          <div className="application-chat-message-heading">
            <strong>{message.own ? 'Eu' : message.authorName || 'Antigo participante'}</strong>
            <time dateTime={message.createdAt}>{messageDate.format(new Date(message.createdAt))}</time>
          </div>
          <p>{message.body}</p>
        </li>)}
      </ol>}
    </div>
    {!unavailable && <form className="application-chat-composer" onSubmit={send}>
      {sendError && <p role="alert">{sendError}</p>}
      <label htmlFor="application-chat-draft">Mensagem</label>
      <textarea id="application-chat-draft" value={draft} onChange={event => setDraft(event.target.value)}
        rows={3} maxLength={2000} disabled={sending || !feed} />
      <button className="btn btn-primary" type="submit" disabled={!draft.trim() || sending || !feed}>
        <Send size={16} aria-hidden="true" /> {sending ? 'A enviar…' : 'Enviar'}
      </button>
    </form>}
  </FormModal>
}
