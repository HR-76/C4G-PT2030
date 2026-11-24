import { useEffect, useRef, useState } from 'react'
import { admissionApi } from '../../api/api'
import FormModal from '../../components/FormModal'
import './entity-users.css'

// Contract: context/features/entity-invitation-simplified.md. The server decides the state of each invitation; this page
// only names it. Sending is one action for the administrator and the same three requests as before for the server.
const STATES = {
  NOT_SENT: ['preparing', 'Por enviar'],
  SENT: ['ready', 'Convite enviado'],
  EXPIRED: ['failed', 'Expirado'],
  ACCEPTED: ['complete', 'Aceite'],
  CANCELLED: ['failed', 'Cancelado'],
}
const DETAILS = { FILLING: 'Ficha em preenchimento', PREPARING: 'Entidade em criação' }
const ERRORS = {
  MEMBERSHIP_ALREADY_EXISTS: 'Esta conta já pertence a uma entidade. Termine primeiro o vínculo anterior e só depois crie um convite para outra entidade.',
  IDENTITY_RECONCILIATION_REQUIRED: 'Esta conta precisa de verificação pela C4G antes de poder ser associada.',
  INVITATION_ALREADY_OPEN: 'Já existe uma ligação válida para este convite. Use «Reenviar» para a substituir.',
}
const date = value => value ? new Date(value).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }) + ' (Lisboa)' : 'Não disponível'
const canResend = item => ['NOT_SENT', 'EXPIRED'].includes(item.state) || (item.state === 'SENT' && !item.detail)
const canCancel = item => ['NOT_SENT', 'SENT', 'EXPIRED'].includes(item.state)

export default function EntityInvitation({ api = admissionApi }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [page, setPage] = useState(1)
  const [list, setList] = useState(null)
  const [listError, setListError] = useState(false)
  const [listRevision, setListRevision] = useState(0)
  const trigger = useRef(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    setListError(false)
    api.list(page).then(response => { if (current) setList(response.data) }).catch(() => { if (current) setListError(true) })
    return () => { current = false }
  }, [api, page, listRevision])

  // Creates the invitation (when it is new), prepares the account and sends the link. Every request carries the identifier
  // chosen when the action started, so repeating the same action after an uncertain answer never duplicates anything.
  async function send(intent) {
    setBusy(true); setError(''); setPending(intent); setOutcome(null)
    try {
      let record = intent.id ? { id: intent.id, phase: intent.phase } : (await api.create(intent.body)).data
      if (!alive.current) return
      if (record.phase !== 'READY') record = (await api.resume(record.id)).data
      if (!alive.current) return
      if (record.phase !== 'READY') {
        setPending({ ...intent, id: record.id, phase: record.phase })
        setError('A conta ainda não ficou preparada. Tente novamente dentro de momentos.')
        return
      }
      const issued = (await api.issue(record.id, { requestId: intent.issueId, replace: intent.replace })).data
      if (!alive.current) return
      const delivery = issued.emailDelivery?.status
      setOutcome({ email: intent.email, expiresAt: issued.expiresAt, delivery,
        sentTo: delivery === 'ACCEPTED' ? issued.emailDelivery.recipient : null,
        url: issued.secret ? `${window.location.origin}/api/admission-activation#${issued.secret}` : null })
      setPending(null); setForm(null)
    } catch (failure) {
      if (!alive.current) return
      const definite = failure.response?.status < 500
      if (definite) setPending(null)
      setError(ERRORS[failure.response?.data?.error?.code] || (definite
        ? 'Não foi possível enviar o convite. Confirme os dados e o seu acesso.'
        : 'O resultado ficou por confirmar. Tente novamente para retomar sem duplicar o convite.'))
    } finally {
      if (alive.current) { setBusy(false); setListRevision(value => value + 1) }
    }
  }

  async function cancel(item) {
    if (!window.confirm(`Cancelar o convite de ${item.name} e impedir a criação desta entidade?`)) return
    setBusy(true); setError(''); setOutcome(null)
    try { await api.cancel(item.id) } catch { if (alive.current) setError('Não foi possível cancelar o convite. Atualize a lista e tente novamente.') }
    finally { if (alive.current) { setBusy(false); setListRevision(value => value + 1) } }
  }

  const locked = busy || Boolean(pending)
  const feedback = <>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">A enviar…</p>}
    {pending && !busy && <button type="button" className="btn btn-primary" onClick={() => send(pending)}>Tentar novamente</button>}
  </>
  return <section className="entity-users entity-invitations" aria-label="Convite para nova entidade">
    <div className="entity-users-heading">
      <div><h2>Convidar uma entidade</h2><p>Indique o primeiro administrador. Ele recebe o convite por email e completa a ficha da entidade.</p></div>
      <button ref={trigger} className="btn btn-primary" disabled={locked || Boolean(form)}
        onClick={() => { setForm({ name: '', email: '' }); setError(''); setOutcome(null) }}>Novo convite</button>
    </div>
    {!form && feedback}
    {outcome && <div className="entity-activation-link">
      {outcome.sentTo
        ? <p role="status">Convite enviado por email para {outcome.sentTo}. A ligação é válida até {date(outcome.expiresAt)}.</p>
        : outcome.url ? <>
          {outcome.delivery && <p role="alert">{outcome.delivery === 'NOT_CONFIGURED' ? 'O envio de email não está configurado neste ambiente.' : 'O envio do email não foi confirmado.'} Entregue esta ligação ao administrador.</p>}
          <label>Ligação para entregar ao administrador<input readOnly value={outcome.url} onFocus={event => event.target.select()} /></label>
          <p>Apresentada apenas agora. Válida até {date(outcome.expiresAt)}.</p>
        </> : <p role="status">O convite de {outcome.email} já tinha sido emitido. Use «Reenviar» para enviar uma ligação nova.</p>}
    </div>}
    {form && <FormModal title="Novo convite" locked={locked} returnFocusRef={trigger} onClose={() => setForm(null)}>
      <form className="entity-user-form" onSubmit={event => {
        event.preventDefault()
        send({ body: { name: form.name, email: form.email, requestId: crypto.randomUUID() }, email: form.email, issueId: crypto.randomUUID(), replace: false })
      }}>
        {feedback}
        <h3>Primeiro administrador</h3>
        <label>Nome do administrador<input required maxLength={200} value={form.name} disabled={locked} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Email do administrador<input required type="email" maxLength={254} value={form.email} disabled={locked} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <p>O convite é enviado por email para este endereço. Uma conta existente mantém a palavra-passe e o histórico, mas só pode ter vínculo a uma entidade.</p>
        <div className="entity-user-actions">
          <button className="btn btn-primary" disabled={locked}>Enviar convite</button>
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => setForm(null)}>Cancelar</button>
        </div>
      </form>
    </FormModal>}
    <section className="entity-activation-list" aria-label="Convites de novas entidades">
      <div className="invitation-list-heading"><h3>Convites de novas entidades</h3>
        <button className="btn btn-outline" disabled={locked} onClick={() => setListRevision(value => value + 1)}>Atualizar convites</button></div>
      {listError ? <p role="alert">Não foi possível consultar os convites. Tente atualizar.</p> : !list ? <p role="status">A consultar convites…</p> : <>
        {!list.items.length ? <p>Ainda não existem convites nesta página.</p> : <div className="table-wrap"><table role="table" className="data-table mobile-card-table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Administrador</th><th role="columnheader" scope="col">Criado em / por</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Validade da ligação</th><th role="columnheader" scope="col">Ações</th></tr></thead>
          <tbody role="rowgroup">{list.items.map(item => {
            const [tone, label] = STATES[item.state] || STATES.NOT_SENT
            return <tr role="row" key={item.id}>
              <td role="cell" data-label="Administrador"><span><bdi>{item.name}</bdi><small>{item.email}</small></span></td>
              <td role="cell" data-label="Criado em / por"><span>{date(item.createdAt)}<small>{item.createdBy}</small></span></td>
              <td role="cell" data-label="Estado"><span><span className="invitation-status" data-status={tone}>{label}</span>{DETAILS[item.detail] && <small>{DETAILS[item.detail]}</small>}</span></td>
              <td role="cell" data-label="Validade da ligação">{item.state === 'SENT' && !item.detail ? 'Até ' + date(item.expiresAt) : item.state === 'EXPIRED' ? 'Expirou em ' + date(item.expiresAt) : '—'}</td>
              <td role="cell" data-label="Ações"><div className="entity-user-actions">
                {canResend(item) && <button className="btn btn-outline" disabled={locked || Boolean(form)}
                  onClick={() => send({ id: item.id, phase: item.phase, email: item.email, issueId: crypto.randomUUID(), replace: item.state !== 'NOT_SENT' })}>{item.state === 'NOT_SENT' ? 'Enviar' : 'Reenviar'}</button>}
                {canCancel(item) && <button className="btn btn-danger" disabled={locked || Boolean(form)} onClick={() => cancel(item)}>Cancelar</button>}
              </div></td>
            </tr>
          })}</tbody></table></div>}
        <nav className="directory-pagination" aria-label="Paginação dos convites">
          <button className="btn btn-secondary" disabled={locked || page === 1} onClick={() => setPage(value => value - 1)}>Convites anteriores</button>
          <span>Página {page} · {list.total} {list.total === 1 ? 'convite' : 'convites'}</span>
          <button className="btn btn-secondary" disabled={locked || page * 25 >= list.total} onClick={() => setPage(value => value + 1)}>Convites seguintes</button>
        </nav>
      </>}
    </section>
  </section>
}
