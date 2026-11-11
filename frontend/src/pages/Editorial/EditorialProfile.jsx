import LoadingIndicator from '../../components/LoadingIndicator'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { editorialApi, clearCsrfToken } from '../../api/api'
import { pendingIntentions, saveIntention, removeIntention } from './intentions'
import './editorial.css'

const titles = { drafts: 'Rascunhos', candidates: 'Candidaturas editoriais', versions: 'Versões' }
const paths = { drafts: 'rascunhos', candidates: 'candidaturas', versions: 'versoes' }
const domains = { THEMATIC_AREA: 'Tema', STRATEGIC_PRIORITY: 'Prioridade' }
const operations = { CREATE_DRAFT: 'Guardar rascunho', EDIT_DRAFT: 'Guardar alterações', SUBMIT: 'Submeter esta revisão', APPROVE: 'Aprovar candidatura', PUBLISH: 'Publicar versão' }
const reasons = { AUTHOR_OR_SUBMITTER: 'Não pode aprovar/publicar porque participou no conteúdo ou na submissão. É necessária outra pessoa autorizada.',
  INCOMPLETE: 'O perfil está incompleto. A correção exige um novo rascunho.', STATE_CONFLICT: 'O estado mudou ou existe uma operação por resolver. Volte a consultar.',
  APPROVAL_STALE: 'A aprovação deixou de ser válida. É necessária uma nova candidatura e aprovação.', NOT_AUTHORIZED: 'Não foi possível autorizar esta ação.', REFERENCE_UNAVAILABLE: 'As referências não estão disponíveis.' }
const findings = { REQUIRED_SLOT_MISSING: 'Por preencher', KNOWN_REQUIRED: 'Indique um tema conhecido', INVALID_CARDINALITY: 'Quantidade ou combinação inválida',
  DUPLICATE_CONCEPT: 'Conceito repetido', UNKNOWN_EXPLICIT: 'Desconhecimento declarado', STATE_NOT_ALLOWED: 'Estado não permitido', REFERENCE_INCOMPATIBLE: 'Referência incompatível', NON_CURRENT_MATERIAL: 'Material desatualizado' }
function message(error) {
  const status = error.response?.status, code = error.response?.data?.error?.code
  if (status === 401) return 'Sessão expirada. Inicie sessão novamente.'
  if (status === 403) return reasons.NOT_AUTHORIZED
  if (status === 404) return 'Registo indisponível.'
  if (status === 409) return reasons[code] || 'A revisão ou confirmação está desatualizada. Volte a consultar antes de repetir.'
  if (status === 400) return 'Pedido inválido. Volte a consultar antes de continuar.'
  return 'Serviço indisponível ou resultado não confirmado. Volte a consultar.'
}
function resultPath(receipt) {
  if (receipt.versionId) return `/perfil-organizacao/versoes/${receipt.versionId}`
  if (receipt.candidateId) return `/perfil-organizacao/candidaturas/${receipt.candidateId}`
  if (receipt.draftId) return `/perfil-organizacao/rascunhos/${receipt.draftId}`
  return '/perfil-organizacao'
}
function Content({ record }) {
  return <>
    <p>Esta avaliação cobre apenas temas e prioridades. Não avalia competências ou constraints.</p>
    <ul>{record.items.map(item => <li key={item.itemId}><strong>{domains[item.domain]}: </strong>{item.knowledgeStatus === 'UNKNOWN' ? 'Desconhecimento declarado' : item.label}<small> — Não verificado factualmente</small></li>)}</ul>
    {record.completion && <section aria-label="Completude editorial"><h3>Recorte editorial {record.completion.result === 'COMPLETE' ? 'completo' : 'incompleto'}</h3>
      <ul>{record.completion.findings.map((f, i) => <li key={i}>{f.domain ? domains[f.domain] + ': ' : ''}{findings[f.code] || 'Resultado indisponível'}</li>)}</ul></section>}
  </>
}

export default function EditorialProfile() {
  const auth = useAuth(), location = useLocation()
  if (!auth.organization) return <section className="editorial"><h2>Perfil da organização</h2><p role="status">Esta conta não tem uma entidade associada.</p></section>
  return <Workspace key={`${auth.user.id}:${auth.organization.id}:${location.pathname}`} auth={auth} pathname={location.pathname}
    confirmed={location.state?.editorialConfirmed === true && location.state?.organizationId === auth.organization.id} />
}

export function Workspace({ auth, pathname, confirmed = false }) {
  const { user, organization, refreshSession } = auth, navigate = useNavigate()
  const [, , segment, id] = pathname.split('/'), kind = Object.keys(paths).find(k => paths[k] === segment)
  const isNew = kind === 'drafts' && id === 'novo', index = !segment || segment === 'editorial'
  const [context, setContext] = useState(null), [record, setRecord] = useState(null), [lists, setLists] = useState({})
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [notice, setNotice] = useState(confirmed ? 'Ação confirmada. A consulta do recurso é independente dessa confirmação.' : ''), [confirm, setConfirm] = useState(null), [items, setItems] = useState([]), [dirty, setDirty] = useState(false)
  const [catalog, setCatalog] = useState({}), [pending, setPending] = useState([]), [outcome, setOutcome] = useState(null)
  const alive = useRef(true), mutex = useRef(false), generation = useRef(0), title = useRef(null), errorBox = useRef(null), timer = useRef(null)
  const originalCommand = useRef(null), draftId = useRef(isNew ? crypto.randomUUID() : id)
  const loadingRef = useRef(loading); loadingRef.current = loading
  const recoveryDeadline = useRef(0)
  const current = token => alive.current && token === generation.current
  function loadPending() {
    try { const values = pendingIntentions(user.id, organization.id); setPending(values); return values }
    catch { setError('O armazenamento da sessão está indisponível. Não é possível iniciar gravações seguras.'); return null }
  }
  async function checkSession() {
    const data = await refreshSession({ timeout: 10000 })
    if (data.user?.id !== user.id || data.organization?.id !== organization.id) throw new Error('Contexto alterado')
    return alive.current
  }
  async function load() {
    const token = ++generation.current
    setLoading(true); setConfirm(null); setError(''); setRecord(null)
    try {
      await checkSession()
      if (!current(token)) return
      const info = (await editorialApi.context()).data
      if (!current(token)) return
      setContext(info)
      if (index) {
        const pages = []
        for (const k of Object.keys(titles)) { if (!current(token)) return; pages.push([k, (await editorialApi.list(k)).data]) }
        if (current(token)) setLists(Object.fromEntries(pages))
      } else if (!kind || !id) throw new Error('Rota inválida')
      else if (!isNew) {
        const detail = (await editorialApi.get(kind, id)).data
        if (current(token)) { setRecord(detail); setItems(detail.items.map(i => ({ itemId: i.itemId, itemVersionId: i.itemVersionId, domain: i.domain, knowledgeStatus: i.knowledgeStatus, conceptId: i.conceptRef?.conceptId || null }))); setDirty(false) }
      }
      if (kind === 'drafts') {
        const pages = []
        for (const domain of Object.keys(domains)) { if (!current(token)) return; pages.push([domain, (await editorialApi.list('catalog', { domain })).data]) }
        if (current(token)) setCatalog(Object.fromEntries(pages))
      }
      if (current(token)) { loadPending(); title.current?.focus() }
    } catch (e) { if (current(token)) setError(message(e)) }
    finally { if (current(token)) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true; clearCsrfToken(); load()
    const focus = () => { if (!mutex.current && !loadingRef.current && document.visibilityState !== 'hidden') {
      setConfirm(null); checkSession().catch(e => { if (alive.current) setError(message(e)) })
    } }
    window.addEventListener('focus', focus)
    return () => { alive.current = false; generation.current++; clearTimeout(timer.current); window.removeEventListener('focus', focus) }
  }, [])
  useEffect(() => { if (error) errorBox.current?.focus() }, [error])
  async function reconcile(intent, attempt = 0) {
    if (mutex.current || !alive.current || document.visibilityState === 'hidden') return
    if (attempt === 3) recoveryDeadline.current = Date.now() + 10000
    const remaining = recoveryDeadline.current - Date.now()
    if (remaining <= 0) return
    mutex.current = true; setBusy(true)
    try {
      if (!await checkSession()) return
      const { userId, organizationId, ...body } = intent
      const budget = recoveryDeadline.current - Date.now()
      if (budget <= 0) return
      const value = (await editorialApi.lookup(body, Math.min(10000, budget))).data
      if (!alive.current) return
      setOutcome(value)
      if (value.status === 'CONFIRMED' || value.status === 'FAILED_FINAL') {
        removeIntention(intent.idempotencyKey); loadPending(); originalCommand.current = null
        setNotice(value.status === 'CONFIRMED' ? 'Ação confirmada.' : 'A operação foi revertida. Consulte novamente o recurso antes de confirmar uma nova ação.')
        if (value.status === 'CONFIRMED') navigate(resultPath(value.receipt), { state: { editorialConfirmed: true, organizationId: organization.id } })
        else await load()
      } else if (attempt < 2) {
        const delay = Math.max([5000, 10000][attempt], (value.retryAfterSeconds || 0) * 1000)
        if (delay <= 10000 && Date.now() + delay < recoveryDeadline.current) timer.current = setTimeout(() => reconcile(intent, attempt + 1), delay)
      }
    } catch (e) { if (alive.current) setError(message(e)) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    if (pending.length && !loading) { clearTimeout(timer.current); recoveryDeadline.current = Date.now() + 30000; timer.current = setTimeout(() => reconcile(pending[0]), 2000) }
    return () => clearTimeout(timer.current)
  }, [pending[0]?.idempotencyKey, loading])
  async function more(key, domain) {
    const token = generation.current, old = domain ? catalog[domain] : lists[key]
    try {
      const next = (await editorialApi.list(key, { cursor: old.nextCursor, ...(domain ? { domain } : {}) })).data
      if (current(token)) (domain ? setCatalog : setLists)(previous => ({ ...previous, [domain || key]: { ...next, items: [...old.items, ...next.items] } }))
    } catch (e) { if (current(token)) setError(message(e)) }
  }
  function change(index, patch) {
    setItems(previous => previous.map((item, i) => i === index ? { ...item, ...patch, itemVersionId: crypto.randomUUID() } : item)); setDirty(true); setConfirm(null)
  }
  async function stepUp() { try { if (await checkSession()) { clearCsrfToken(); editorialApi.stepUp(context.mfa.category, pathname) } } catch (e) { if (alive.current) setError(message(e)) } }
  function begin(operation, action = null) {
    if (busy || pending.length) return
    setConfirm({ operation, action }); setError('')
  }
  async function execute() {
    if (mutex.current || !confirm || pending.length) return
    mutex.current = true; setBusy(true); setError('')
    const operation = confirm.operation, resourceId = draftId.current || id
    let intent, sent = false
    try {
      if (!await checkSession()) return
      const idempotencyKey = crypto.randomUUID()
      intent = { userId: user.id, organizationId: organization.id, operation, resourceId, idempotencyKey,
        ...(['EDIT_DRAFT', 'SUBMIT'].includes(operation) ? { expectedRevision: record.revision } : {}) }
      let method, body
      if (operation === 'CREATE_DRAFT') { method = 'create'; body = { draftId: resourceId, items, idempotencyKey } }
      if (operation === 'EDIT_DRAFT') { method = 'edit'; body = { expectedRevision: record.revision, items, idempotencyKey } }
      if (operation === 'SUBMIT') { method = 'submit'; body = { expectedRevision: record.revision, idempotencyKey } }
      if (['APPROVE', 'PUBLISH'].includes(operation)) { method = operation.toLowerCase(); body = { concurrencyToken: confirm.action.concurrencyToken, idempotencyKey } }
      saveIntention(intent); originalCommand.current = { intent, method, body }
      sent = true
      const result = (await (method === 'create' ? editorialApi.create(body) : editorialApi[method](resourceId, body))).data
      if (!alive.current) return
      removeIntention(idempotencyKey); loadPending(); originalCommand.current = null; setConfirm(null)
      setNotice('Ação confirmada.'); setDirty(false)
      const target = resultPath(result)
      if (target === pathname) await load(); else navigate(target, { state: { editorialConfirmed: true, organizationId: organization.id } })
    } catch (e) {
      if (!alive.current) return
      setConfirm(null)
      if (intent && sent && (!e.response || e.response.status >= 500)) { loadPending(); setNotice('Não foi possível confirmar o resultado. Não inicie outra gravação.'); }
      else { if (intent) removeIntention(intent.idempotencyKey); originalCommand.current = null }
      setError(message(e))
    } finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  const orgName = organization.displayName || organization.display_name || organization.name || context?.organization.name || 'Organização selecionada'
  const disabled = loading || busy || pending.length > 0 || !context
  const editable = kind === 'drafts' && (isNew ? context?.canCreateDraft : record?.actions.some(a => a.operation === 'EDIT' && a.status === 'AVAILABLE'))
  return <section className="editorial" aria-busy={loading || busy}>
    <h2 ref={title} tabIndex={-1}>Perfil da organização</h2><p><strong>Organização: {orgName}</strong></p>
    {!index && <Link to="/perfil-organizacao/editorial">Voltar ao índice editorial</Link>}
    {loading && <LoadingIndicator>A carregar perfil…</LoadingIndicator>}
    {error && <div ref={errorBox} tabIndex={-1} role="alert">{error} <button type="button" disabled={busy} onClick={load}>Voltar a consultar</button></div>}
    {notice && <p role="status">{notice}</p>}
    {pending.length > 0 && <section aria-label="Operação por resolver"><h3>Resultado ainda não confirmado</h3><p>As gravações estão suspensas enquanto a operação anterior não for resolvida. Pode continuar a consultar. Se a incerteza persistir, contacte o suporte técnico com a referência abaixo.</p>
      {outcome?.correlationId && <p>Referência de suporte: {outcome.correlationId}</p>}
      <button disabled={busy} onClick={() => { clearTimeout(timer.current); reconcile(pending[0], 3) }}>Consultar resultado da operação</button></section>}
    {!loading && index && context && <>
      {context.canCreateDraft && <button disabled={disabled} onClick={() => navigate('/perfil-organizacao/rascunhos/novo')}>Criar rascunho</button>}
      {!context.canCreateDraft && <><p>A criação requer autorização e, quando aplicável, MFA recente.</p><button disabled={disabled} onClick={stepUp}>Confirmar autentica??o</button></>}
      {Object.entries(titles).map(([key, name]) => <section key={key}><h3>{name}</h3>
        {lists[key]?.items.length === 0 && <p>Sem registos autorizados nesta organização.</p>}
        <ul>{lists[key]?.items.map((item, i) => { const resourceId = item.draftId || item.candidateId || item.versionId
          return <li key={resourceId}><Link to={`/perfil-organizacao/${paths[key]}/${resourceId}`}>{name === 'Rascunhos' ? `Rascunho — revisão ${item.revision}` : key === 'candidates' ? `Candidatura editorial ${i + 1}` : `Versão ${i + 1}`}</Link> — {item.state === 'PUBLISHED' ? 'Publicada — inativa' : item.state === 'APPROVED' ? 'Aprovada' : item.lifecycle === 'DRAFT' ? 'Rascunho' : 'Submetida'}</li> })}</ul>
        {lists[key]?.nextCursor && <button disabled={busy} onClick={() => more(key)}>Mostrar mais {name.toLowerCase()}</button>}</section>)}
    </>}
    {!loading && editable && <section aria-label="Editar recorte temático"><h3>{isNew ? 'Novo rascunho' : `Revisão guardada ${record.revision}`}</h3>
      <p>Selecione temas e prioridades. Desconhecimento declarado é diferente de não preencher. Até 100 itens.</p>
      {items.map((item, i) => <fieldset key={item.itemId} disabled={disabled}><legend>{domains[item.domain]} {i + 1}</legend>
        {item.domain === 'STRATEGIC_PRIORITY' && <label><input type="checkbox" checked={item.knowledgeStatus === 'UNKNOWN'} onChange={event => change(i, { knowledgeStatus: event.target.checked ? 'UNKNOWN' : 'KNOWN', conceptId: null })} /> Desconhecimento declarado</label>}
        {item.knowledgeStatus === 'KNOWN' && <label>Conceito<select value={item.conceptId || ''} onChange={event => change(i, { conceptId: event.target.value || null })}><option value="">Selecione um conceito</option>
          {record?.items.filter(old => old.itemId === item.itemId && old.conceptRef && !catalog[item.domain]?.items.some(c => c.conceptRef.conceptId === old.conceptRef.conceptId)).map(old => <option key={old.conceptRef.conceptId} value={old.conceptRef.conceptId}>{old.label} — {old.conceptRef.releaseVersion}</option>)}
          {catalog[item.domain]?.items.map(c => <option key={c.conceptRef.conceptId} value={c.conceptRef.conceptId}>{c.label} — {c.conceptRef.releaseVersion}</option>)}</select></label>}
        <button type="button" className="btn btn-danger btn-sm" onClick={() => { setItems(previous => previous.filter((_, n) => n !== i)); setDirty(true); setConfirm(null) }}>Remover {domains[item.domain].toLowerCase()} {i + 1}</button></fieldset>)}
      <div className="editorial-actions">{Object.entries(domains).map(([domain, label]) => <span key={domain}><button disabled={disabled || items.length >= 100} onClick={() => { setItems(previous => [...previous, { itemId: crypto.randomUUID(), itemVersionId: crypto.randomUUID(), domain, knowledgeStatus: 'KNOWN', conceptId: null }]); setDirty(true); setConfirm(null) }}>Adicionar {label.toLowerCase()}</button>
        {catalog[domain]?.nextCursor && <button disabled={disabled} onClick={() => more('catalog', domain)}>Mais conceitos de {label.toLowerCase()}</button>}</span>)}</div>
      {dirty && <p role="status">Alterações ainda não guardadas.</p>}
      <button disabled={disabled || (!dirty && !isNew) || items.some(i => i.knowledgeStatus === 'KNOWN' && !i.conceptId)} onClick={() => begin(isNew ? 'CREATE_DRAFT' : 'EDIT_DRAFT')}>{isNew ? 'Guardar rascunho' : 'Guardar alterações'}</button>
    </section>}
    {!loading && record && <section aria-label="Pré-visualização editorial"><h3>{record.state === 'PUBLISHED' ? 'Publicada — inativa' : record.state === 'APPROVED' ? 'Versão aprovada' : kind === 'drafts' ? `Pré-visualização da revisão ${record.revision}` : 'Candidatura editorial submetida'}</h3>
      {record.sourceRevision && <p>Revisão de origem: {record.sourceRevision}</p>}
      {record.state === 'PUBLISHED' && <p>Não disponível para matching.</p>}<Content record={record} />
      {record.actions.filter(a => a.operation !== 'EDIT' && !(record.state === 'PUBLISHED' && a.operation === 'PUBLISH')).map(action => <div key={action.operation}>
        {action.status === 'BLOCKED' ? <p>{reasons[action.reason] || reasons.NOT_AUTHORIZED}</p> : action.status === 'MFA_REQUIRED' ? <button disabled={disabled || dirty} onClick={stepUp}>Confirmar autentica??o</button>
          : <button disabled={disabled || dirty} onClick={() => begin(action.operation, action)}>{operations[action.operation]}</button>}
      </div>)}</section>}
    {confirm && <section className="editorial-confirm" aria-label="Confirmar ação"><h3>{operations[confirm.operation]}</h3><p>Organização: {orgName}. Confirme o recurso e o conteúdo apresentados. {confirm.operation === 'SUBMIT' && 'A revisão submetida deixa de ser editável.'}</p>
      <button disabled={busy} onClick={execute}>Confirmar {operations[confirm.operation].toLowerCase()}</button><button disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button></section>}
  </section>
}
