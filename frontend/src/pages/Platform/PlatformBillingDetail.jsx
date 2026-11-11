import BillingPdf from '../Billing/BillingPdf'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, FilePlus2, Pencil, RefreshCw, RotateCcw, WalletCards, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { platformBillingApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import BillingDialog from './BillingDialog'
import { activityLabels, billingError, cycleStates, documentStates, documentTypes, formatDate, formatInstant, formatMoney, isConflict, nullable, paymentMethods, paymentStates, today } from './billingPresentation'
import './platform-billing.css'

export default function PlatformBillingDetail() {
  const { user } = useAuth(), { cycleId } = useParams()
  return <BillingDetailView key={`${user?.id}:${cycleId}`} cycleId={cycleId}/>
}

export function BillingDetailView({ cycleId, api = platformBillingApi }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0)
  const [action, setAction] = useState(null), [notice, setNotice] = useState(''), generation = useRef(0)
  const load = () => setReload(value => value + 1)
  useEffect(() => {
    const epoch = ++generation.current, controller = new AbortController(); setBusy(true); setError('')
    api.cycle(cycleId, controller.signal).then(response => { if (epoch === generation.current) setData(response.data) })
      .catch(reason => { if (epoch === generation.current && reason?.code !== 'ERR_CANCELED') setError(billingError(reason)) })
      .finally(() => { if (epoch === generation.current) setBusy(false) })
    return () => { generation.current += 1; controller.abort() }
  }, [api, cycleId, reload])
  const complete = message => { setAction(null); setNotice(message); load() }
  return <div className="page platform-billing billing-detail">
    <Link className="directory-back" to="/administracao/faturacao"><ArrowLeft size={16} aria-hidden="true"/>Voltar à faturação</Link>
    <header className="billing-heading"><div><h1>{data?.organizationName || 'Detalhe do ciclo'}</h1>{data && <p>{data.serviceDescription} · {formatDate(data.periodStart)} a {formatDate(data.periodEnd)}</p>}</div><button className="btn btn-outline" disabled={busy} onClick={load}><RefreshCw size={16} aria-hidden="true"/>Atualizar</button></header>
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    {error && <div className="alert alert-error" role="alert">{error} <button className="btn btn-outline" onClick={load}>Tentar novamente</button></div>}
    {busy && !data && <div className="billing-loading" role="status"><span/>A carregar o ciclo…</div>}
    {data && <>
      <CycleHero data={data}/>
      <ActionBar data={data} onAction={setAction}/>
      <div className="billing-detail-grid">
        <section className="billing-section billing-account"><header><h2>Dados faturados</h2><span>Snapshot do ciclo</span></header><dl><div><dt>Denominação legal</dt><dd>{data.accountSnapshot.legalName}</dd></div><div><dt>NIF</dt><dd>{data.accountSnapshot.taxIdentifier}</dd></div><div><dt>Morada</dt><dd>{[data.accountSnapshot.addressLine1, data.accountSnapshot.addressLine2, `${data.accountSnapshot.postalCode} ${data.accountSnapshot.locality}`, data.accountSnapshot.region].filter(Boolean).join(', ')}</dd></div><div><dt>Email de faturação</dt><dd>{data.accountSnapshot.billingEmail}</dd></div><div><dt>Contacto</dt><dd>{data.accountSnapshot.contactName || '—'}</dd></div><div><dt>Condições</dt><dd>{data.accountSnapshot.paymentTermsDays} dias</dd></div></dl></section>
        <section className="billing-section"><header><h2>Documentos fiscais externos</h2><span>{data.documents.length}</span></header>{data.documents.length ? <DocumentList data={data} onAction={setAction}/> : <p className="billing-section-empty">Ainda não foi associado um documento fiscal.</p>}</section>
        <section className="billing-section"><header><h2>Pagamentos e estornos</h2><span>{data.payments.length}</span></header>{data.payments.length ? <PaymentList payments={data.payments} onAction={setAction}/> : <p className="billing-section-empty">Ainda não existem movimentos de pagamento.</p>}</section>
        <section className="billing-section billing-timeline"><header><h2>Histórico</h2><span>{data.timeline.length}</span></header>{data.timeline.length ? <ol>{[...data.timeline].reverse().map(item => <li key={item.id}><span aria-hidden="true"/><div><strong>{activityLabels[item.detailCode] || item.detailCode}</strong><small>{formatInstant(item.occurredAt)}{item.newRevision ? ` · revisão ${item.newRevision}` : ''}</small></div></li>)}</ol> : <p className="billing-section-empty">Sem atividade registada.</p>}</section>
      </div>
    </>}
    {action && data && <BillingActionDialog action={action} data={data} api={api} onClose={() => setAction(null)} onRefresh={load} onComplete={complete}/>}
  </div>
}

function Status({ type, value }) {
  const labels = type === 'cycle' ? cycleStates : type === 'payment' ? paymentStates : documentStates
  return <span className={`billing-status billing-status-${String(value).toLowerCase()}`}>{labels[value] || value}</span>
}

function CycleHero({ data }) {
  return <section className="billing-cycle-hero"><div><span>Saldo atual</span><strong>{formatMoney(data.balanceAmount, data.currency)}</strong><small>{data.overdue && data.balanceAmount !== '0' ? `Vencido desde ${formatDate(data.document?.dueDate || data.dueDate)}` : `Vencimento ${formatDate(data.document?.dueDate || data.dueDate)}`}</small></div><dl><div><dt>Total ajustado</dt><dd>{formatMoney(data.adjustedTotal, data.currency)}</dd></div><div><dt>Recebido</dt><dd>{formatMoney(data.paidAmount, data.currency)}</dd></div><div><dt>Ciclo</dt><dd><Status type="cycle" value={data.cycleState}/></dd></div><div><dt>Pagamento</dt><dd><Status type="payment" value={data.paymentState}/></dd></div></dl></section>
}

function ActionBar({ data, onAction }) {
  const primary = data.documents.find(document => ['INVOICE', 'SIMPLIFIED_INVOICE', 'INVOICE_RECEIPT'].includes(document.type) && document.state === 'ISSUED')
  const allowed = data.allowedActions || {}
  return <section className="billing-action-bar" aria-label="Ações do ciclo">
    {allowed.editCycle && <button className="btn btn-outline" onClick={() => onAction({ kind: 'editCycle' })}><Pencil size={16}/>Editar ciclo</button>}
    {allowed.readyCycle && <button className="btn btn-primary" onClick={() => onAction({ kind: 'readyCycle' })}><CheckCircle2 size={16}/>Marcar pronto a emitir</button>}
    {allowed.recordPrimaryDocument && <button className="btn btn-primary" onClick={() => onAction({ kind: 'document' })}><FilePlus2 size={16}/>Registar documento</button>}
    {allowed.recordCorrectiveDocument && <button className="btn btn-outline" onClick={() => onAction({ kind: 'document' })}><FilePlus2 size={16}/>Documento retificativo</button>}
    {allowed.cancelCycle && <button className="btn btn-danger" onClick={() => onAction({ kind: 'cancelCycle' })}><XCircle size={16}/>Cancelar ciclo</button>}
    {allowed.recordPayment && primary && <button className="btn btn-primary" onClick={() => onAction({ kind: 'payment', document: primary })}><WalletCards size={16}/>Registar pagamento</button>}
  </section>
}

function DocumentList({ data, onAction }) {
  return <div className="billing-record-list">{data.documents.map(document => <article key={document.id}><div className="billing-record-mark">{document.type === 'CREDIT_NOTE' ? 'NC' : document.type === 'DEBIT_NOTE' ? 'ND' : 'FT'}</div><div><strong>{document.number}</strong><span>{documentTypes[document.type] || document.type} · {document.sourceCode}</span><small>Emitido em {formatDate(document.issueDate)} · vence {formatDate(document.dueDate)}</small><BillingPdf documentId={document.id} platform/></div><div className="billing-record-value"><strong>{formatMoney(document.total, document.currency)}</strong><Status type="document" value={document.state}/></div>{(document.allowedActions?.cancel || document.allowedActions?.credit) && <div className="billing-record-actions">{document.allowedActions.cancel && <button className="btn btn-danger btn-sm" onClick={() => onAction({ kind: 'documentTransition', document, toState: 'CANCELLED' })}>Cancelar</button>}{document.allowedActions.credit && <button className="btn btn-outline btn-sm" onClick={() => onAction({ kind: 'documentTransition', document, toState: 'CREDITED' })}>Marcar creditado</button>}</div>}</article>)}</div>
}

function PaymentList({ payments, onAction }) {
  return <div className="billing-record-list">{payments.map(payment => <article key={payment.id}><div className={`billing-record-mark ${payment.recordType === 'REVERSAL' ? 'is-reversal' : ''}`}>{payment.recordType === 'REVERSAL' ? 'E' : 'P'}</div><div><strong>{payment.recordType === 'REVERSAL' ? 'Estorno' : paymentMethods[payment.methodCode] || payment.methodCode}</strong><span>{formatDate(payment.effectiveOn)}{payment.externalReference ? ` · ${payment.externalReference}` : ''}</span><small>{payment.note || (payment.recordType === 'REVERSAL' ? 'Movimento de regularização' : 'Pagamento registado')}</small></div><div className="billing-record-value"><strong>{payment.recordType === 'REVERSAL' ? '−' : ''}{formatMoney(payment.amount, payment.currency)}</strong></div>{payment.allowedActions?.reverse && <div className="billing-record-actions"><button className="btn btn-danger btn-sm" onClick={() => onAction({ kind: 'reversal', payment })}><RotateCcw size={14}/>Estornar</button></div>}</article>)}</div>
}

const actionMeta = {
  editCycle: ['Editar ciclo', 'Guardar alterações', false], readyCycle: ['Marcar ciclo pronto a emitir', 'Confirmar estado', true],
  cancelCycle: ['Cancelar ciclo', 'Confirmar cancelamento', true], document: ['Registar documento fiscal externo', 'Confirmar documento', true],
  documentTransition: ['Atualizar documento fiscal', 'Confirmar alteração', true], payment: ['Registar pagamento', 'Confirmar pagamento', true],
  reversal: ['Registar estorno', 'Confirmar estorno', true],
}

function BillingActionDialog({ action, data, api, onClose, onRefresh, onComplete }) {
  const [form, setForm] = useState(() => initialActionForm(action, data)), [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false), key = useRef(crypto.randomUUID())
  const [title, confirmLabel, requiresReview] = actionMeta[action.kind]
  const destructive = action.kind === 'cancelCycle' || action.kind === 'reversal' || (action.kind === 'documentTransition' && action.toState === 'CANCELLED')
  const field = (name, value) => { setForm(old => ({ ...old, [name]: value })); setReview(false) }
  const submit = async event => {
    event.preventDefault(); if (requiresReview && !review) { setReview(true); return }
    setBusy(true); setError(''); setConflict(false)
    try { await executeAction(api, action, data, form, key.current); onComplete(successMessage(action)) }
    catch (reason) { setError(billingError(reason)); setConflict(isConflict(reason)); setReview(false) }
    finally { setBusy(false) }
  }
  return <BillingDialog title={title} description={actionDescription(action, data)} onClose={onClose} busy={busy} wide={['editCycle', 'document'].includes(action.kind)}>
    <form className="billing-command-form" onSubmit={submit}><fieldset disabled={busy}>{review ? <Review action={action} data={data} form={form}/> : <ActionFields action={action} data={data} form={form} field={field}/>}</fieldset>
      {error && <div className="alert alert-error" role="alert">{error}{conflict && <><span> Os dados introduzidos foram mantidos.</span><button type="button" className="btn btn-outline" onClick={onRefresh}>Atualizar dados</button></>}</div>}
      <div className="billing-form-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={review ? () => setReview(false) : onClose}>{review ? 'Voltar' : 'Cancelar'}</button><button className={`btn ${destructive ? review ? 'btn-danger-solid' : 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? 'A guardar…' : review ? confirmLabel : requiresReview ? 'Rever' : confirmLabel}</button></div>
    </form>
  </BillingDialog>
}

function initialActionForm(action, data) {
  if (action.kind === 'editCycle') return { periodStart: data.periodStart, periodEnd: data.periodEnd, serviceDescription: data.serviceDescription, currency: data.currency, amount: data.cycleAmount, plannedIssueDate: data.plannedIssueDate || '', dueDate: data.dueDate, contractReference: data.contractReference || '', notes: data.cycleNotes || '' }
  if (action.kind === 'cancelCycle') return { reason: '' }
  if (action.kind === 'document') { const correction = data.cycleState === 'ISSUED', primary = data.documents.find(document => ['INVOICE', 'SIMPLIFIED_INVOICE', 'INVOICE_RECEIPT'].includes(document.type)); return { sourceCode: 'TOCONLINE', issuerReference: 'C4G-PT', documentType: correction ? 'CREDIT_NOTE' : 'INVOICE', documentNumber: '', externalDocumentId: '', issueDate: today(), dueDate: data.dueDate, currency: data.currency, subtotal: correction ? '' : data.cycleAmount, taxTotal: '0', total: correction ? '' : data.cycleAmount, correctsDocumentId: correction ? primary?.id || '' : '' } }
  if (action.kind === 'documentTransition') return { reason: '' }
  if (action.kind === 'payment') return { amount: data.balanceAmount, currency: data.currency, paidOn: today(), methodCode: 'BANK_TRANSFER', externalReference: '', note: '' }
  if (action.kind === 'reversal') return { amount: action.payment.amount, reversedOn: today(), reason: '' }
  return {}
}

function ActionFields({ action, data, form, field }) {
  if (action.kind === 'readyCycle') return <p>O ciclo deixa de ser editável e fica preparado para associar o documento fiscal emitido externamente.</p>
  if (action.kind === 'cancelCycle') return <label>Motivo<textarea required maxLength={500} value={form.reason} onChange={event => field('reason', event.target.value)}/></label>
  if (action.kind === 'documentTransition') return <label>Motivo<textarea required maxLength={500} value={form.reason} onChange={event => field('reason', event.target.value)}/></label>
  if (action.kind === 'reversal') return <div className="billing-form-grid"><label>Valor a estornar<input required inputMode="decimal" value={form.amount} onChange={event => field('amount', event.target.value)}/></label><label>Data do estorno<input required type="date" value={form.reversedOn} onChange={event => field('reversedOn', event.target.value)}/></label><label className="billing-span-2">Motivo<textarea required maxLength={500} value={form.reason} onChange={event => field('reason', event.target.value)}/></label></div>
  if (action.kind === 'payment') return <div className="billing-form-grid"><label>Valor<input required inputMode="decimal" value={form.amount} onChange={event => field('amount', event.target.value)}/></label><label>Moeda<input required maxLength={3} value={form.currency} onChange={event => field('currency', event.target.value.toUpperCase())}/></label><label>Data do pagamento<input required type="date" value={form.paidOn} onChange={event => field('paidOn', event.target.value)}/></label><label>Método<select value={form.methodCode} onChange={event => field('methodCode', event.target.value)}>{Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Referência externa<input maxLength={200} value={form.externalReference} onChange={event => field('externalReference', event.target.value)}/></label><label className="billing-span-2">Nota<textarea maxLength={1000} value={form.note} onChange={event => field('note', event.target.value)}/></label></div>
  if (action.kind === 'editCycle') return <CycleFields form={form} field={field}/>
  if (action.kind === 'document') { const correction = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(form.documentType); return <div className="billing-form-grid"><label>Origem<select value={form.sourceCode} onChange={event => field('sourceCode', event.target.value)}><option value="TOCONLINE">TOConline</option><option value="FE_AP">FE-AP</option><option value="OTHER">Outro</option></select></label><label>Referência do emitente<input required maxLength={160} value={form.issuerReference} onChange={event => field('issuerReference', event.target.value)}/></label><label>Tipo<select value={form.documentType} onChange={event => field('documentType', event.target.value)}>{(data.cycleState === 'READY_TO_ISSUE' ? ['INVOICE', 'SIMPLIFIED_INVOICE', 'INVOICE_RECEIPT'] : ['CREDIT_NOTE', 'DEBIT_NOTE']).map(value => <option key={value} value={value}>{documentTypes[value]}</option>)}</select></label><label>Número do documento<input required maxLength={160} value={form.documentNumber} onChange={event => field('documentNumber', event.target.value)}/></label><label>ID externo<input maxLength={200} value={form.externalDocumentId} onChange={event => field('externalDocumentId', event.target.value)}/></label><label>Data de emissão<input required type="date" value={form.issueDate} onChange={event => field('issueDate', event.target.value)}/></label><label>Vencimento<input required type="date" value={form.dueDate} onChange={event => field('dueDate', event.target.value)}/></label><label>Moeda<input required maxLength={3} value={form.currency} onChange={event => field('currency', event.target.value.toUpperCase())}/></label><label>Subtotal<input required inputMode="decimal" value={form.subtotal} onChange={event => field('subtotal', event.target.value)}/></label><label>Imposto<input required inputMode="decimal" value={form.taxTotal} onChange={event => field('taxTotal', event.target.value)}/></label><label>Total<input required inputMode="decimal" value={form.total} onChange={event => field('total', event.target.value)}/></label>{correction && <label className="billing-span-2">Documento corrigido<select required value={form.correctsDocumentId} onChange={event => field('correctsDocumentId', event.target.value)}><option value="">Selecione</option>{data.documents.filter(document => ['INVOICE', 'SIMPLIFIED_INVOICE', 'INVOICE_RECEIPT'].includes(document.type)).map(document => <option key={document.id} value={document.id}>{document.number}</option>)}</select></label>}</div> }
  return null
}

function CycleFields({ form, field }) { return <div className="billing-form-grid"><label>Início do período<input required type="date" value={form.periodStart} onChange={event => field('periodStart', event.target.value)}/></label><label>Fim do período<input required type="date" value={form.periodEnd} onChange={event => field('periodEnd', event.target.value)}/></label><label className="billing-span-2">Serviço<input required maxLength={500} value={form.serviceDescription} onChange={event => field('serviceDescription', event.target.value)}/></label><label>Moeda<input required maxLength={3} value={form.currency} onChange={event => field('currency', event.target.value.toUpperCase())}/></label><label>Valor<input required inputMode="decimal" value={form.amount} onChange={event => field('amount', event.target.value)}/></label><label>Emissão prevista<input type="date" value={form.plannedIssueDate} onChange={event => field('plannedIssueDate', event.target.value)}/></label><label>Vencimento<input required type="date" value={form.dueDate} onChange={event => field('dueDate', event.target.value)}/></label><label>Referência contratual<input maxLength={160} value={form.contractReference} onChange={event => field('contractReference', event.target.value)}/></label><label className="billing-span-2">Notas<textarea maxLength={4000} value={form.notes} onChange={event => field('notes', event.target.value)}/></label></div> }

function Review({ action, data, form }) {
  const facts = action.kind === 'payment' ? [['Valor', formatMoney(form.amount, form.currency)], ['Data', formatDate(form.paidOn)], ['Método', paymentMethods[form.methodCode]]]
    : action.kind === 'reversal' ? [['Valor', formatMoney(form.amount, action.payment.currency)], ['Data', formatDate(form.reversedOn)], ['Motivo', form.reason]]
      : action.kind === 'document' ? [['Documento', `${documentTypes[form.documentType]} ${form.documentNumber}`], ['Total', formatMoney(form.total, form.currency)], ['Emissão', formatDate(form.issueDate)]]
        : action.kind === 'documentTransition' ? [['Documento', action.document.number], ['Novo estado', documentStates[action.toState]], ['Motivo', form.reason]]
          : action.kind === 'cancelCycle' ? [['Ciclo', `${formatDate(data.periodStart)} a ${formatDate(data.periodEnd)}`], ['Motivo', form.reason]]
            : [['Ciclo', `${formatDate(data.periodStart)} a ${formatDate(data.periodEnd)}`], ['Novo estado', 'Pronto a emitir']]
  return <div className="billing-review"><p>Confirme os dados antes de registar esta operação. O histórico financeiro será preservado.</p><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
}

function actionDescription(action, data) {
  if (action.kind === 'document') return data.cycleState === 'READY_TO_ISSUE' ? 'Registe a referência da fatura já emitida no sistema fiscal.' : 'Registe uma nota de crédito ou débito já emitida externamente.'
  if (action.kind === 'payment') return `Saldo atual: ${formatMoney(data.balanceAmount, data.currency)}.`
  if (action.kind === 'reversal') return `Pagamento original: ${formatMoney(action.payment.amount, action.payment.currency)}.`
  return null
}

async function executeAction(api, action, data, form, idempotencyKey) {
  if (action.kind === 'editCycle') return api.cycleEdit(data.cycleId, { ...form, plannedIssueDate: nullable(form.plannedIssueDate), contractReference: nullable(form.contractReference), notes: nullable(form.notes), accountVersionId: data.accountVersionId, expectedRevision: data.cycleRevision, idempotencyKey })
  if (action.kind === 'readyCycle') return api.cycleTransition(data.cycleId, { toState: 'READY_TO_ISSUE', reason: null, expectedRevision: data.cycleRevision, idempotencyKey })
  if (action.kind === 'cancelCycle') return api.cycleTransition(data.cycleId, { toState: 'CANCELLED', reason: form.reason.trim(), expectedRevision: data.cycleRevision, idempotencyKey })
  if (action.kind === 'document') return api.documentRecord(data.cycleId, { ...form, externalDocumentId: nullable(form.externalDocumentId), correctsDocumentId: nullable(form.correctsDocumentId), expectedCycleRevision: data.cycleRevision, idempotencyKey })
  if (action.kind === 'documentTransition') return api.documentTransition(action.document.id, { toState: action.toState, reason: form.reason.trim(), expectedRevision: action.document.revision, idempotencyKey })
  if (action.kind === 'payment') return api.paymentRecord(action.document.id, { ...form, externalReference: nullable(form.externalReference), note: nullable(form.note), idempotencyKey })
  if (action.kind === 'reversal') return api.paymentReverse(action.payment.id, { amount: form.amount, reversedOn: form.reversedOn, reason: form.reason.trim(), idempotencyKey })
}

function successMessage(action) {
  return { editCycle: 'Ciclo atualizado.', readyCycle: 'Ciclo marcado como pronto a emitir.', cancelCycle: 'Ciclo cancelado.', document: 'Documento fiscal registado.', documentTransition: 'Estado do documento atualizado.', payment: 'Pagamento registado.', reversal: 'Estorno registado.' }[action.kind]
}

