import { useEffect, useRef, useState } from 'react'

const labels = { NOT_REQUESTED: 'Validação ainda não pedida', OUTDATED: 'Os dados foram alterados. É necessário um novo pedido de validação.', PENDING: 'A aguardar confirmação da entidade', CONFIRMED: 'Dados confirmados pela entidade' }
const date = value => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const errorText = reason => ({ STALE_REVISION: 'Os dados foram alterados. Atualize e reveja os dados antes de continuar.', BILLING_VALIDATION_NO_RECIPIENT: 'A entidade não tem um administrador ativo com email para receber o pedido.', NOT_AUTHORIZED: 'Apenas o administrador da entidade pode confirmar os dados.', C4G_ADMIN_REQUIRED: 'Esta ação requer um administrador C4G.' })[reason?.response?.data?.error?.code] || 'Não foi possível concluir a operação. Tente novamente.'

export default function BillingValidationPanel({ api, organizationId, admin = false, expectedOrganizationId = null, onBusy = () => {} }) {
  const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState(false), [reload, setReload] = useState(0)
  const requestKey = useRef(crypto.randomUUID()), operation = useRef(0)
  const mismatch = !admin && expectedOrganizationId && expectedOrganizationId !== organizationId
  useEffect(() => {
    if (!api.validation || mismatch) return
    const controller = new AbortController(), epoch = ++operation.current
    setState(null); setPreview(false)
    const work = admin ? api.validation(organizationId, controller.signal) : api.validation(controller.signal)
    work.then(({ data }) => { if (!controller.signal.aborted && operation.current === epoch) setState(data) })
      .catch(reason => { if (!controller.signal.aborted && operation.current === epoch) { if (!admin && reason?.response?.status === 403) setState({ enabled: false }); else setError(errorText(reason)) } })
    return () => { controller.abort(); operation.current += 1 }
  }, [api, organizationId, admin, reload, mismatch])
  useEffect(() => { requestKey.current = crypto.randomUUID() }, [state?.versionId])
  if (!api.validation) return null
  if (mismatch) return <div className="alert alert-info">O pedido recebido refere-se a outra entidade. Selecione essa entidade para validar os seus dados de faturação.</div>
  if (state?.enabled === false) return null
  const refresh = () => { setError(''); setReload(value => value + 1) }
  const review = async () => {
    setBusy(true); setError(''); setPreview(false)
    try { const { data } = await (admin ? api.validation(organizationId) : api.validation()); setState(data); setPreview(true) }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const submit = async () => {
    setBusy(true); onBusy(true); setError('')
    try {
      if (admin) await api.requestValidation(organizationId, { versionId: state.versionId, requestKey: requestKey.current })
      else await api.confirmValidation({ versionId: state.versionId, requestId: state.requestId })
      setPreview(false); setReload(value => value + 1)
    } catch (reason) { setError(errorText(reason)); if (reason?.response?.status === 409) setPreview(false) }
    finally { setBusy(false); onBusy(false) }
  }
  const account = state?.account
  const rows = account ? [['Denominação legal', account.legalName], ['NIF', account.taxIdentifier], ['País fiscal', account.taxCountry], ['Morada', [account.addressLine1, account.addressLine2].filter(Boolean).join(', ')], ['Código postal', account.postalCode], ['Localidade', account.locality], ['Região', account.region], ['Email de faturação', account.billingEmail], ['Contacto', account.contactName]].filter(([, value]) => value) : []
  const canAct = account && (admin ? ['NOT_REQUESTED', 'OUTDATED'].includes(state.status) : state.status === 'PENDING')
  return <section className="billing-section" aria-label="Validação dos dados de faturação">
    <header><h3>{admin ? 'Validação dos dados guardados' : 'Confirmação dos dados de faturação'}</h3></header>
    {error && <p role="alert">{error}</p>}
    {!state && !error && <p role="status">A consultar validação…</p>}
    {state && <><p role="status">{labels[state.status]}</p>{state.confirmedAt && state.status === 'CONFIRMED' && <p>Confirmado em {date(state.confirmedAt)}.</p>}
      {admin && state.email?.pending > 0 && <p>Email em fila de envio.</p>}
      {admin && state.email?.accepted > 0 && <p>Email aceite pelo serviço de envio.</p>}
      {admin && state.email?.failed > 0 && <p role="alert">Não foi possível concluir o envio de {state.email.failed} email(s).</p>}
      {admin && state.email?.cancelled > 0 && <p>Envio cancelado: o pedido ou o destinatário deixou de ser elegível.</p>}
    </>}
    {canAct && !preview && <button type="button" className="btn btn-outline" disabled={busy} onClick={review}>{admin ? 'Rever dados e pedir validação' : 'Rever dados para confirmar'}</button>}
    {preview && canAct && <div>
      {admin && <p>Serão pedidos aos administradores da entidade a confirmação destes dados guardados. Guarde primeiro quaisquer alterações no formulário.</p>}
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'A processar…' : admin ? 'Pedir validação' : 'Confirmar dados'}</button>
    </div>}
    <button type="button" className="btn btn-outline" disabled={busy} onClick={refresh}>Atualizar validação</button>
  </section>
}
