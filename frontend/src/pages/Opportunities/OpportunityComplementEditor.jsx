import { useRef, useState } from 'react'
import { Pencil, RefreshCw } from 'lucide-react'
import FormModal from '../../components/FormModal'
import { opportunityComplementsApi } from '../../api/api'
import './OpportunityComplementEditor.css'

// One text box per field. Lists take one item per line. An empty box means the
// administrator states nothing for that field and the collected value, if any, is shown.
const TEXT = [['description', 'Descrição', 'textarea', 8000], ['officialUrl', 'Página oficial do aviso', 'url', 2000], ['noticeCode', 'Código do aviso', 'text', 64]]
const LISTS = [['priorities', 'Prioridades'], ['actionTypologies', 'Tipologias de ação'], ['interventionTypologies', 'Tipologias de intervenção'], ['operationTypologies', 'Tipologias de operação']]
const MESSAGES = {
  INVALID_INPUT: 'Reveja os campos: há um valor que não é aceite.',
  STALE_REVISION: 'Esta informação foi alterada entretanto. Feche e volte a abrir para ver a versão atual.',
  IDEMPOTENCY_CONFLICT: 'Este pedido já foi usado com outro conteúdo. Feche e volte a abrir.',
  STATE_CONFLICT: 'Outra alteração estava em curso. Tente novamente.',
  C4G_ADMIN_REQUIRED: 'Sem permissão de administração da plataforma.',
  RESOURCE_NOT_AVAILABLE: 'Oportunidade indisponível.',
  COLLECTION_NOT_CONFIGURED: 'A recolha a partir de portugal2030.pt não está ativa neste ambiente.',
  SOURCE_UNAVAILABLE: 'Não foi possível ler portugal2030.pt. Nada foi alterado.',
}
const message = error => MESSAGES[error?.response?.data?.error?.code] || 'Não foi possível concluir o pedido. Tente novamente.'
const formFrom = fields => ({
  ...Object.fromEntries(TEXT.map(([key]) => [key, fields[key] || ''])),
  ...Object.fromEntries(LISTS.map(([key]) => [key, (fields[key] || []).join('\n')])),
  cofinancingRate: fields.cofinancingRate === undefined ? '' : String(fields.cofinancingRate).replace('.', ','),
})
// The fields the administrator stated, or the label of the first field that cannot be sent.
export function complementFields(form) {
  const fields = {}
  for (const [key, label, , maximum] of TEXT) {
    const value = form[key].trim()
    if (!value) continue
    if ([...value].length > maximum || (key === 'officialUrl' && !/^https:\/\/[^\s]+\.[^\s]+$/.test(value))) return { invalid: label }
    fields[key] = value
  }
  for (const [key, label] of LISTS) {
    const items = form[key].split('\n').map(item => item.trim()).filter(Boolean)
    if (!items.length) continue
    if (items.length > 20 || items.some(item => [...item].length > 300) || new Set(items).size !== items.length) return { invalid: label }
    fields[key] = items
  }
  const rate = form.cofinancingRate.trim().replace(',', '.')
  if (rate) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate) || Number(rate) > 100) return { invalid: 'Taxa de comparticipação' }
    fields.cofinancingRate = Number(rate)
  }
  return { fields }
}
const collectedHint = (collected, key) => {
  const value = collected?.fields?.[key]
  if (value === undefined) return null
  const text = Array.isArray(value) ? value.join(' · ') : String(value)
  return `Valor recolhido: ${text.length > 160 ? text.slice(0, 160) + '…' : text}`
}

export default function OpportunityComplementEditor({ opportunityId, onSaved }) {
  const trigger = useRef(null), requestKey = useRef(null)
  const [open, setOpen] = useState(false), [data, setData] = useState(null), [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function show() {
    setOpen(true); setData(null); setForm(null); setError(''); requestKey.current = crypto.randomUUID()
    try {
      const response = await opportunityComplementsApi.get(opportunityId)
      setData(response.data); setForm(formFrom(response.data.editorial.fields))
    } catch (failure) { setError(message(failure)) }
  }
  async function save(event) {
    event.preventDefault()
    const checked = complementFields(form)
    if (checked.invalid) { setError(`Reveja o campo «${checked.invalid}».`); return }
    setBusy(true); setError('')
    try {
      // The same key is kept while this dialog is open, so repeating after an uncertain answer cannot write twice.
      await opportunityComplementsApi.save(opportunityId, { fields: checked.fields, expectedRevision: data.editorial.revision, idempotencyKey: requestKey.current })
      setOpen(false); onSaved?.()
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  const change = key => event => setForm(current => ({ ...current, [key]: event.target.value }))
  const hint = key => { const text = collectedHint(data?.collected, key); return text && <small className="complement-hint">{text}</small> }
  return <>
    <button ref={trigger} type="button" className="btn btn-outline btn-sm" onClick={show}><Pencil size={14} aria-hidden="true" /> Editar informação</button>
    {open && <FormModal title="Editar informação do aviso" className="complement-modal" onClose={() => setOpen(false)} locked={busy} returnFocusRef={trigger}>
      {!form && !error && <p role="status">A carregar…</p>}
      {form && <form className="complement-form" onSubmit={save} noValidate>
        <p className="complement-note">O que escrever aqui é mostrado na ficha em vez do valor recolhido. Um campo vazio mantém o valor recolhido, quando existe. Os dados do aviso que vêm da fonte (título, datas, dotação) não são alterados.</p>
        {TEXT.map(([key, label, kind, maximum]) => <label key={key}>{label}
          {kind === 'textarea' ? <textarea rows={8} maxLength={maximum} value={form[key]} onChange={change(key)} disabled={busy} />
            : <input type={kind} maxLength={maximum} value={form[key]} onChange={change(key)} disabled={busy} placeholder={kind === 'url' ? 'https://' : undefined} />}
          {hint(key)}</label>)}
        {LISTS.map(([key, label]) => <label key={key}>{label} <span className="complement-optional">(uma por linha)</span>
          <textarea rows={3} value={form[key]} onChange={change(key)} disabled={busy} />{hint(key)}</label>)}
        <label>Taxa de comparticipação (%)
          <input type="text" inputMode="decimal" maxLength={6} value={form.cofinancingRate} onChange={change('cofinancingRate')} disabled={busy} />{hint('cofinancingRate')}</label>
        {data.editorial.updatedAt && <p className="complement-note">Última alteração por {data.editorial.updatedBy} em {new Date(data.editorial.updatedAt).toLocaleString('pt-PT')}.</p>}
        {error && <p role="alert" className="alert alert-warn">{error}</p>}
        <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button></div>
      </form>}
      {!form && error && <p role="alert" className="alert alert-warn">{error}</p>}
    </FormModal>}
  </>
}

// Administrative collection of the annual plan pages of portugal2030.pt. What may
// be copied is decided by the deployment; here the administrator only starts it.
export function ComplementCollection({ onCollected }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null), [error, setError] = useState('')
  async function collect() {
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await opportunityComplementsApi.collectPortugal2030({ idempotencyKey: crypto.randomUUID() })
      setResult(response.data); if (response.data.written) onCollected?.()
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  return <span className="complement-collection">
    <button type="button" className="btn btn-outline" disabled={busy} onClick={collect}><RefreshCw size={16} aria-hidden="true" /> {busy ? 'A recolher…' : 'Atualizar dados PT2030'}</button>
    {result && <span role="status">{result.written} {result.written === 1 ? 'aviso atualizado' : 'avisos atualizados'}, {result.unchanged} sem alterações, {result.unmatched} sem oportunidade no catálogo.</span>}
    {error && <span role="alert">{error}</span>}
  </span>
}
