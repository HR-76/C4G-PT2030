import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import LoadingIndicator from '../../components/LoadingIndicator'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarPlus, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { platformBillingApi, platformDirectoryApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import BillingDialog from './BillingDialog'
import { billingError, cleanParams, cycleStates, formatDate, formatMoney, nullable, paymentStates } from './billingPresentation'
import './platform-billing.css'

const emptyFilters = { q: '', organizationId: '', from: '', to: '', cycleStatus: '', paymentStatus: '', overdue: '', currency: '' }
const accountBlank = { legalName: '', taxCountry: 'PT', taxIdentifier: '', addressLine1: '', addressLine2: '', postalCode: '', locality: '', region: '', billingEmail: '', contactName: '', externalSource: '', externalCustomerRef: '', paymentTermsDays: '30', notes: '' }
const cycleBlank = { periodStart: '', periodEnd: '', serviceDescription: 'Subscrição da C4G Funding Platform', currency: 'EUR', amount: '', plannedIssueDate: '', dueDate: '', contractReference: '', notes: '' }

export default function PlatformBilling() {
  const { user } = useAuth()
  return <BillingView key={user?.id}/>
}

export function BillingView({ api = platformBillingApi, directoryApi = platformDirectoryApi }) {
  const [params, setParams] = useSearchParams(), navigate = useNavigate(), key = params.toString(), generation = useRef(0)
  const [filters, setFilters] = useState(() => ({ ...emptyFilters, ...Object.fromEntries(params) }))
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0)
  const [setup, setSetup] = useState(false)
  const query = cleanParams(params), data = snapshot?.key === key ? snapshot : null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; params is read at that moment.
  useEffect(() => setFilters({ ...emptyFilters, ...Object.fromEntries(params) }), [key])
  useEffect(() => {
    const epoch = ++generation.current, controller = new AbortController(); setBusy(true); setError('')
    const summaryQuery = Object.fromEntries(['from', 'to', 'currency'].flatMap(name => query[name] ? [[name, query[name]]] : []))
    Promise.all([api.summary(summaryQuery, controller.signal), api.cycles(query, controller.signal)])
      .then(([summary, cycles]) => { if (epoch === generation.current) setSnapshot({ key, summary: summary.data, cycles: cycles.data }) })
      .catch(reason => { if (epoch === generation.current && reason?.code !== 'ERR_CANCELED') setError(billingError(reason)) })
      .finally(() => { if (epoch === generation.current) setBusy(false) })
    return () => { generation.current += 1; controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; query is read at that moment.
  }, [api, key, reload])
  const applyFilters = event => {
    event.preventDefault()
    const next = Object.fromEntries(Object.entries(filters).filter(([name, value]) => name !== 'page' && value !== ''))
    setParams(next)
  }
  const clearFilters = () => { setFilters(emptyFilters); setParams({}) }
  const page = direction => { const next = new URLSearchParams(params); next.set('page', String((data?.cycles.page || 1) + direction)); setParams(next) }
  const hasFilters = [...params.keys()].some(name => name !== 'page')
  return <div className="page platform-billing">
    <header className="billing-heading"><div><h1>Faturação</h1><p>Controlo operacional dos valores emitidos e recebidos pela C4G.</p></div>
      <div className="billing-heading-actions"><button className="btn btn-outline" disabled={busy} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} aria-hidden="true"/>Atualizar</button>
        <button className="btn btn-primary" onClick={() => setSetup(true)}><CalendarPlus size={17} aria-hidden="true"/>Preparar faturação</button></div></header>

    {busy && !data && <LoadingIndicator>A carregar a posição financeira…</LoadingIndicator>}
    {error && <div className="alert alert-error" role="alert">{error} <button className="btn btn-outline" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
    {data && <>
      <BillingSummary rows={data.summary.currencies}/>
      <section className="billing-register" aria-label="Ciclos de faturação">
      <div className="billing-register-heading"><h2>Ciclos de faturação</h2><p>Consulte documentos, pagamentos e saldos.</p></div>
      <FilterBar as="form" variant="integrated" className="billing-filters" onSubmit={applyFilters}>
        <div className="billing-filter-title"><SlidersHorizontal size={17} aria-hidden="true"/><strong>Filtrar ciclos</strong></div>
        <label className="billing-search">Entidade ou documento<SearchInput value={filters.q} maxLength={120} placeholder="Nome, serviço ou documento" onChange={event => setFilters(old => ({ ...old, q: event.target.value }))}/></label>
        <label>De<input type="date" value={filters.from} onChange={event => setFilters(old => ({ ...old, from: event.target.value }))}/></label>
        <label>Até<input type="date" value={filters.to} onChange={event => setFilters(old => ({ ...old, to: event.target.value }))}/></label>
        <label>Estado do ciclo<select value={filters.cycleStatus} onChange={event => setFilters(old => ({ ...old, cycleStatus: event.target.value }))}><option value="">Todos</option>{Object.entries(cycleStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Pagamento<select value={filters.paymentStatus} onChange={event => setFilters(old => ({ ...old, paymentStatus: event.target.value }))}><option value="">Todos</option>{Object.entries(paymentStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Vencimento<select value={filters.overdue} onChange={event => setFilters(old => ({ ...old, overdue: event.target.value }))}><option value="">Todos</option><option value="true">Vencidos</option><option value="false">Dentro do prazo</option></select></label>
        <label>Moeda<input value={filters.currency} maxLength={3} placeholder="EUR" onChange={event => setFilters(old => ({ ...old, currency: event.target.value.toUpperCase() }))}/></label>
        <div className="billing-filter-actions filter-actions filter-wide"><button className="btn btn-primary" type="submit">Aplicar filtros</button><button className="btn btn-secondary" type="button" onClick={clearFilters}>Limpar filtros</button></div>
      </FilterBar>
      <p className="billing-result" role="status">{data.cycles.total} {data.cycles.total === 1 ? 'ciclo encontrado' : 'ciclos encontrados'}</p>
      {data.cycles.items.length ? <CycleTable items={data.cycles.items}/> : <section className="billing-empty"><h2>{hasFilters ? 'Nenhum ciclo corresponde aos filtros' : 'Ainda não existem ciclos de faturação'}</h2><p>{hasFilters ? 'Altere os critérios ou limpe os filtros.' : 'Prepare a conta da entidade e registe o primeiro período de faturação.'}</p>{!hasFilters && <button className="btn btn-primary" onClick={() => setSetup(true)}>Preparar primeiro ciclo</button>}</section>}
      <nav className="billing-pagination" aria-label="Paginação"><button className="btn btn-secondary" disabled={data.cycles.page <= 1} onClick={() => page(-1)}>Anterior</button><span>Página {data.cycles.page}{data.cycles.total ? ` de ${Math.ceil(data.cycles.total / data.cycles.pageSize)}` : ''}</span><button className="btn btn-secondary" disabled={data.cycles.page * data.cycles.pageSize >= data.cycles.total} onClick={() => page(1)}>Seguinte</button></nav>
      </section>
    </>}
    {setup && <BillingSetup api={api} directoryApi={directoryApi} onClose={() => setSetup(false)} onCreated={cycleId => { setSetup(false); navigate(`/administracao/faturacao/${cycleId}`) }} onChanged={() => setReload(value => value + 1)}/>}
  </div>
}

function BillingSummary({ rows }) {
  if (!rows.length) return <section className="billing-ledger billing-ledger-empty" aria-label="Resumo financeiro"><p>Sem valores emitidos para o período selecionado.</p></section>
  return <section className="billing-ledger" aria-label="Resumo financeiro">{rows.map(row => <article key={row.currency}><header><strong>{row.currency}</strong><span>{row.documentCount} {row.documentCount === 1 ? 'documento' : 'documentos'}</span></header><dl>
    <div><dt>Faturado</dt><dd>{formatMoney(row.billedAmount, row.currency)}</dd></div><div><dt>Recebido</dt><dd>{formatMoney(row.receivedAmount, row.currency)}</dd></div><div className="billing-ledger-balance"><dt>Em aberto</dt><dd>{formatMoney(row.outstandingAmount, row.currency)}</dd></div><div className={row.overdueAmount !== '0' ? 'is-overdue' : ''}><dt>Vencido</dt><dd>{formatMoney(row.overdueAmount, row.currency)}</dd></div>
  </dl><footer>{row.organizationsWithBalance} {row.organizationsWithBalance === 1 ? 'entidade com saldo' : 'entidades com saldo'}</footer></article>)}</section>
}

function Status({ kind, value, overdue }) {
  const label = kind === 'cycle' ? cycleStates[value] : paymentStates[value]
  return <span className={`billing-status billing-status-${String(value).toLowerCase()}${overdue ? ' billing-status-overdue' : ''}`}>{overdue ? 'Vencido' : label || value}</span>
}

function CycleTable({ items }) {
  return <div className="table-wrap billing-table-wrap" role="region" aria-label="Tabela de ciclos de faturação" tabIndex={0}><table role="table" className="data-table mobile-card-table billing-table"><caption className="sr-only">Ciclos de faturação</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Entidade</th><th role="columnheader" scope="col">Período</th><th role="columnheader" scope="col">Documento</th><th role="columnheader" scope="col">Datas</th><th role="columnheader" scope="col">Total</th><th role="columnheader" scope="col">Pago</th><th role="columnheader" scope="col">Saldo</th><th role="columnheader" scope="col">Estados</th><th role="columnheader" scope="col"></th></tr></thead><tbody role="rowgroup">{items.map(item => <tr role="row" key={item.cycleId}>
    <td role="cell" data-label="Entidade"><strong>{item.organizationName}</strong><small>{item.organizationLegalName !== item.organizationName ? item.organizationLegalName : item.serviceDescription}</small></td>
    <td role="cell" data-label="Período">{formatDate(item.periodStart)}<small>até {formatDate(item.periodEnd)}</small></td>
    <td role="cell" data-label="Documento">{item.document ? <>{item.document.number}<small>{item.document.type}</small></> : <span className="billing-muted">Por registar</span>}</td>
    <td role="cell" data-label="Datas"><span>{formatDate(item.document?.issueDate || item.plannedIssueDate)}</span><small>Vence {formatDate(item.document?.dueDate || item.dueDate)}</small></td>
    <td role="cell" data-label="Total" className="billing-money">{formatMoney(item.adjustedTotal, item.currency)}</td><td role="cell" data-label="Pago" className="billing-money">{formatMoney(item.paidAmount, item.currency)}</td><td role="cell" data-label="Saldo" className="billing-money billing-balance">{formatMoney(item.balanceAmount, item.currency)}</td>
    <td role="cell" data-label="Estados"><div className="billing-state-stack"><Status kind="cycle" value={item.cycleState}/><Status kind="payment" value={item.paymentState} overdue={item.overdue}/></div></td>
    <td role="cell" data-label=""><Link className="btn btn-outline" to={`/administracao/faturacao/${item.cycleId}`}>Consultar</Link></td>
  </tr>)}</tbody></table></div>
}

function BillingSetup({ api, directoryApi, onClose, onCreated, onChanged }) {
  const [entities, setEntities] = useState([]), [entityId, setEntityId] = useState(''), [query, setQuery] = useState('')
  const [account, setAccount] = useState(null), [accountLoaded, setAccountLoaded] = useState(false), [mode, setMode] = useState('select')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const findEntities = async event => { event?.preventDefault(); setBusy(true); setError(''); try { const { data } = await directoryApi.entities({ ...(query.trim() ? { q: query.trim() } : {}), status: 'ACTIVE', page: 1 }); setEntities(data.items) } catch (reason) { setError(billingError(reason)) } finally { setBusy(false) } }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; findEntities is read at that moment.
  useEffect(() => { findEntities() }, [])
  const choose = async value => { setEntityId(value); setAccount(null); setAccountLoaded(false); setError(''); if (!value) return; setBusy(true); try { const { data } = await api.account(value); setAccount(data); setAccountLoaded(true); setMode(data.account ? 'cycle' : 'account') } catch (reason) { setError(billingError(reason)) } finally { setBusy(false) } }
  const refreshAccount = async () => { if (!entityId) return; await choose(entityId) }
  return <BillingDialog title="Preparar faturação" description="Selecione a entidade, confirme os dados faturados e registe o período." onClose={onClose} busy={busy} wide>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    <FilterBar as="form" variant="compact" className="billing-entity-search" onSubmit={findEntities}><label>Pesquisar entidade<SearchInput value={query} maxLength={150} onChange={event => setQuery(event.target.value)} placeholder="Nome da entidade"/></label><button className="btn btn-outline" disabled={busy}>Pesquisar</button></FilterBar>
    <label className="billing-full-field">Entidade<select value={entityId} onChange={event => choose(event.target.value)} disabled={busy}><option value="">Selecione uma entidade</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
    {busy && <p role="status">A consultar…</p>}
    {accountLoaded && mode === 'account' && (
      <AccountForm organizationId={entityId} record={account} api={api} onSaved={async () => { onChanged(); await refreshAccount() }}/>
    )}
    {accountLoaded && mode === 'cycle' && <><div className="billing-account-strip"><div><span>Dados de faturação</span><strong>{account.account.version.legalName}</strong><small>{account.account.version.taxIdentifier} · {account.account.version.billingEmail}</small></div><button type="button" className="btn btn-outline" onClick={() => setMode('account')}>Editar dados</button></div><CycleCreateForm organizationId={entityId} accountVersionId={account.account.version.id} api={api} onCreated={onCreated}/></>}
  </BillingDialog>
}

function AccountForm({ organizationId, record, api, onSaved }) {
  const version = record.account?.version, [form, setForm] = useState(() => version ? { ...accountBlank, ...version, externalSource: version.externalSource || '', externalCustomerRef: version.externalCustomerRef || '', addressLine2: version.addressLine2 || '', region: version.region || '', contactName: version.contactName || '', notes: version.notes || '', paymentTermsDays: String(version.paymentTermsDays) } : { ...accountBlank, legalName: record.organizationLegalName || '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false), key = useRef(crypto.randomUUID())
  const field = (name, value) => setForm(old => ({ ...old, [name]: value }))
  const submit = async event => { event.preventDefault(); setBusy(true); setError(''); setConflict(false); try { await api.accountWrite(organizationId, { ...form, addressLine2: nullable(form.addressLine2), region: nullable(form.region), contactName: nullable(form.contactName), externalSource: nullable(form.externalSource), externalCustomerRef: nullable(form.externalCustomerRef), notes: nullable(form.notes), paymentTermsDays: Number(form.paymentTermsDays), expectedRevision: record.account?.revision || 0, idempotencyKey: key.current }); await onSaved() } catch (reason) { setError(billingError(reason)); setConflict(reason?.response?.status === 409) } finally { setBusy(false) } }
  return <form className="billing-command-form" onSubmit={submit}><fieldset disabled={busy}><legend>{record.account ? 'Editar dados de faturação' : 'Configurar conta de faturação'}</legend><div className="billing-form-grid">
    <label className="billing-span-2">Denominação legal<input required maxLength={200} value={form.legalName} onChange={event => field('legalName', event.target.value)}/></label><label>País fiscal<input required maxLength={2} value={form.taxCountry} onChange={event => field('taxCountry', event.target.value.toUpperCase())}/></label><label>NIF / identificação fiscal<input required maxLength={32} value={form.taxIdentifier} onChange={event => field('taxIdentifier', event.target.value.toUpperCase())}/></label>
    <label className="billing-span-2">Morada<input required maxLength={200} value={form.addressLine1} onChange={event => field('addressLine1', event.target.value)}/></label><label>Complemento<input maxLength={200} value={form.addressLine2} onChange={event => field('addressLine2', event.target.value)}/></label><label>Código postal<input required maxLength={32} value={form.postalCode} onChange={event => field('postalCode', event.target.value)}/></label><label>Localidade<input required maxLength={120} value={form.locality} onChange={event => field('locality', event.target.value)}/></label><label>Região<input maxLength={120} value={form.region} onChange={event => field('region', event.target.value)}/></label>
    <label>Email de faturação<input required type="email" maxLength={254} value={form.billingEmail} onChange={event => field('billingEmail', event.target.value)}/></label><label>Contacto<input maxLength={160} value={form.contactName} onChange={event => field('contactName', event.target.value)}/></label><label>Origem externa<select value={form.externalSource} onChange={event => field('externalSource', event.target.value)}><option value="">Sem associação</option><option value="TOCONLINE">TOConline</option><option value="FE_AP">FE-AP</option><option value="OTHER">Outro</option></select></label><label>Referência externa<input maxLength={160} value={form.externalCustomerRef} onChange={event => field('externalCustomerRef', event.target.value)}/></label><label>Prazo de pagamento (dias)<input required type="number" min="0" max="365" value={form.paymentTermsDays} onChange={event => field('paymentTermsDays', event.target.value)}/></label><label className="billing-span-2">Notas<textarea maxLength={4000} value={form.notes} onChange={event => field('notes', event.target.value)}/></label>
  </div></fieldset>{error && <div className="alert alert-error" role="alert">{error}{conflict && <span> Os dados introduzidos foram mantidos.</span>}</div>}<div className="billing-form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar dados de faturação'}</button></div></form>
}

function CycleCreateForm({ organizationId, accountVersionId, api, onCreated }) {
  const [form, setForm] = useState(cycleBlank), [busy, setBusy] = useState(false), [error, setError] = useState(''), key = useRef(crypto.randomUUID())
  const field = (name, value) => setForm(old => ({ ...old, [name]: value }))
  const submit = async event => { event.preventDefault(); setBusy(true); setError(''); try { const { data } = await api.cycleCreate({ organizationId, accountVersionId, ...form, plannedIssueDate: nullable(form.plannedIssueDate), contractReference: nullable(form.contractReference), notes: nullable(form.notes), idempotencyKey: key.current }); onCreated(data.cycleId) } catch (reason) { setError(billingError(reason)) } finally { setBusy(false) } }
  return <form className="billing-command-form" onSubmit={submit}><fieldset disabled={busy}><legend>Novo ciclo</legend><div className="billing-form-grid"><label>Início do período<input required type="date" value={form.periodStart} onChange={event => field('periodStart', event.target.value)}/></label><label>Fim do período<input required type="date" value={form.periodEnd} onChange={event => field('periodEnd', event.target.value)}/></label><label className="billing-span-2">Serviço<input required maxLength={500} value={form.serviceDescription} onChange={event => field('serviceDescription', event.target.value)}/></label><label>Moeda<input required maxLength={3} value={form.currency} onChange={event => field('currency', event.target.value.toUpperCase())}/></label><label>Valor<input required inputMode="decimal" value={form.amount} onChange={event => field('amount', event.target.value)} placeholder="12000.00"/></label><label>Emissão prevista<input type="date" value={form.plannedIssueDate} onChange={event => field('plannedIssueDate', event.target.value)}/></label><label>Vencimento<input required type="date" value={form.dueDate} onChange={event => field('dueDate', event.target.value)}/></label><label>Referência contratual<input maxLength={160} value={form.contractReference} onChange={event => field('contractReference', event.target.value)}/></label><label className="billing-span-2">Notas<textarea maxLength={4000} value={form.notes} onChange={event => field('notes', event.target.value)}/></label></div></fieldset>{error && <div className="alert alert-error" role="alert">{error}</div>}<div className="billing-form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'A criar…' : 'Criar ciclo'}</button></div></form>
}
