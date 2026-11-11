import { useEffect, useRef, useState } from 'react'
import { readScope, startConfirmedRead } from '../../api/confirmedReads'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { opportunityInterestsApi as api, centralOpportunitiesApi } from '../../api/api'
import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import LoadingIndicator from '../../components/LoadingIndicator'
import FormModal from '../../components/FormModal'
import OpportunityApplications from '../Opportunities/OpportunityApplications'
import { opportunityDisplay, getOpportunityReadModel } from '../Opportunities/opportunityReadModel'
import { OpportunityReadModelDetails } from '../Opportunities/OpportunityReadModelView'
import UnitSelector, { unitLabel } from './UnitSelector'
import useInterestCommand, { interestError } from './useInterestCommand'
import { safeInterestReturn } from './intentions'
import ApplicationAreaNav, { ApplicationAreaHeader } from '../Applications/ApplicationAreaNav'
import './interests.css'

const date = value => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('pt-PT') : 'Não indicado'
const sourceUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null } catch { return null } }
const canPrepareApplication = item => item?.status === 'ACTIVE' && item.capabilities?.canManage === true && item.capabilities?.canCreateApplication === true
const applicationFormTarget = (interest, opportunity, returnTo) => `/candidaturas?${new URLSearchParams({ nova: '1', origem: 'CENTRAL', oportunidade: interest.opportunityId, revisao: opportunity.revisionId, interesse: interest.interestId, interesseRevisao: String(interest.revision), retorno: safeInterestReturn(returnTo) })}`
function Units({ unitIds = [], units = [], transversal = false }) {
  if (!unitIds.length) return <span>{transversal?'Interesse transversal à C4G':'Sem unidade atribuída'}</span>
  return <div className="interest-unit-list">{unitIds.map(id => { const unit = units.find(row => row.unitId === id)
    return <span key={id}>{unit ? unitLabel(unit, units) : 'Unidade associada'}{unit?.lifecycle === 'ARCHIVED' ? ' (arquivada)' : ''}</span>
  })}</div>
}
function Feedback({ command }) {
  return <>{command.error && <p role="alert">{command.error}</p>}{command.pending && <p role="status">Existe um envio por confirmar. <button type="button" className="btn btn-outline" disabled={command.busy} onClick={command.retry}>Confirmar envio pendente</button></p>}</>
}
export default function Interests() {
  const { user, organization } = useAuth(), { id } = useParams()
  if (!organization) return <main className="page"><p>Esta conta não tem uma entidade associada para consultar interesses.</p></main>
  return id ? <InterestDetail key={`${user.id}:${organization.id}:${id}`} id={id} userId={user.id} organizationId={organization.id}/> : <InterestList organization={organization} key={`${user.id}:${organization.id}`} userId={user.id} organizationId={organization.id}/>
}
function InterestList({ userId, organizationId, organization }) {
  const [params, setParams] = useSearchParams(), location = useLocation(), navigate = useNavigate()
  const q = params.get('q') || '', unitId = params.get('unitId') || '', status = params.get('status') || 'ACTIVE', cursor = params.get('cursor') || ''
  // The first page of a query already confirmed is shown at once and read again.
  const scope = readScope(userId, organizationId), listName = cursor ? null : `interests:${JSON.stringify([q, unitId, status])}`
  const [draft, setDraft] = useState({ q, unitId, status }), [data, setData] = useState(() => startConfirmedRead(scope, listName).held), [units, setUnits] = useState([])
  const [loading, setLoading] = useState(!data), [error, setError] = useState(''), [unitError, setUnitError] = useState(''), [refresh, setRefresh] = useState(0)
  const command = useInterestCommand(userId, organizationId, () => setRefresh(value => value + 1))
  const openingRequest = useRef(null), [openingId, setOpeningId] = useState(null), [openingError, setOpeningError] = useState('')
  const commandLocked = command.busy || Boolean(command.pending) || command.blocked
  useEffect(() => {
    setOpeningId(null); setOpeningError('')
    return () => { openingRequest.current?.abort(); openingRequest.current = null }
  }, [location.key, refresh, commandLocked])
  useEffect(() => { setDraft({ q, unitId, status }) }, [q, unitId, status])
  useEffect(() => {
    let active = true; const controller = new AbortController(), read = startConfirmedRead(scope, listName); setLoading(!read.held); setData(read.held); setError('')
    api.list({ ...(q ? { q } : {}), ...(unitId ? { unitId } : {}), status, ...(cursor ? { cursor } : {}) }, organizationId, controller.signal)
      .then(({ data: result }) => { read.keep(result); if (active) setData(result) }).catch(e => { if (active) { read.drop(); setData(null); setError(interestError(e)) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; listName, scope are read at that moment.
  }, [organizationId, q, unitId, status, cursor, refresh])
  useEffect(() => {
    let active = true; const controller = new AbortController(); setUnitError('')
    api.units({ purpose: 'FILTER' }, organizationId, controller.signal).then(({ data }) => { if (active) { if (!Array.isArray(data.items)) throw Error('Invalid units'); setUnits(data.items) } })
      .catch(() => { if (active) setUnitError('Não foi possível consultar os filtros de unidades.') })
    return () => { active = false; controller.abort() }
  }, [organizationId, refresh])
  function changePage(next) {
    const copy = new URLSearchParams(params), trail = copy.getAll('previous'); copy.delete('previous')
    if (next) { trail.push(cursor); copy.set('cursor', next) }
    else { const previous = trail.pop(); if (previous) copy.set('cursor', previous); else copy.delete('cursor') }
    for (const previous of trail) copy.append('previous', previous)
    setParams(copy)
  }
  function applyFilters(values) {
    const next = new URLSearchParams(values)
    if (location.pathname === '/candidaturas') next.set('ver', 'interesses')
    setParams(next)
  }
  async function prepareApplication(item) {
    if (openingRequest.current || loading || commandLocked || !canPrepareApplication(item)) return
    const controller = new AbortController(), current = () => openingRequest.current === controller && !controller.signal.aborted
    openingRequest.current = controller; setOpeningId(item.interestId); setOpeningError('')
    try {
      const { data: interest } = await api.get(item.interestId, organizationId, controller.signal)
      if (!current()) return
      if (interest?.interestId !== item.interestId || interest.opportunityId !== item.opportunityId || !Number.isSafeInteger(interest.revision) || interest.revision < 1) throw Error('Unavailable interest')
      setData(previous => previous && ({ ...previous, items: previous.items.map(row => row.interestId === item.interestId ? interest : row) }))
      if (!canPrepareApplication(interest)) {
        setOpeningError('Este interesse já não permite preparar uma candidatura. Consulte o interesse para verificar a situação e as permissões.'); return
      }
      const { data: opportunity } = await centralOpportunitiesApi.get(interest.opportunityId, controller.signal)
      if (!current()) return
      if (opportunity?.opportunityId !== interest.opportunityId || !opportunity.revisionId || (opportunity.lifecycleState || opportunity.snapshot?.lifecycleState) === 'ARCHIVED') throw Error('Unavailable opportunity')
      navigate(applicationFormTarget(interest, opportunity, location.pathname + location.search))
    } catch (error) {
      if (current()) setOpeningError([401, 403, 404].includes(error?.response?.status) ? interestError(error) : 'Não foi possível preparar a candidatura. Tente novamente para consultar os dados atuais.')
    } finally { if (current()) { openingRequest.current = null; setOpeningId(null) } }
  }
  return <main className="page interests-page"><ApplicationAreaHeader organization={organization} title="Interesses da organização"><Link className="btn btn-outline" to="/catalogo">Catálogo C4G</Link></ApplicationAreaHeader>
    <ApplicationAreaNav/>
    <Feedback command={command}/>
    <FilterBar as="form" onSubmit={event => { event.preventDefault(); applyFilters(Object.fromEntries(Object.entries(draft).filter(([,value]) => value))) }}>
      <label className="filter-search">Pesquisar<SearchInput maxLength={200} value={draft.q} onChange={event => setDraft(previous => ({ ...previous, q: event.target.value }))}/></label>
      <label>Departamento / Unidade<select value={draft.unitId} onChange={event => setDraft(previous => ({ ...previous, unitId: event.target.value }))}><option value="">Todas as unidades</option><option value="NONE">Sem unidade atribuída</option>{draft.unitId && draft.unitId !== 'NONE' && !units.some(unit => unit.unitId === draft.unitId) && <option value={draft.unitId}>Unidade selecionada</option>}{units.map(unit => <option key={unit.unitId} value={unit.unitId}>{unitLabel(unit, units)}{unit.lifecycle === 'ARCHIVED' ? ' (arquivada)' : ''}</option>)}</select></label>
      <label>Situação<select value={draft.status} onChange={event => setDraft(previous => ({ ...previous, status: event.target.value }))}><option value="ACTIVE">Ativos</option><option value="ARCHIVED">Arquivados</option><option value="ALL">Todos</option></select></label>
      <div className="form-actions"><button className="btn btn-primary">Aplicar filtros</button><button type="button" className="btn btn-secondary" onClick={() => applyFilters({})}>Limpar filtros</button></div>
    </FilterBar>
    {(error || openingError || unitError) && <div role="alert"><p>{error || openingError || unitError}</p><button className="btn btn-outline" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</button></div>}
    {loading && <LoadingIndicator>A carregar interesses…</LoadingIndicator>}
    {data && <><p role="status">{data.items.length} {data.items.length === 1 ? 'interesse' : 'interesses'} nesta página</p><div className="table-wrap interest-table-wrap" role="region" aria-label="Lista de interesses" tabIndex={0}><table role="table" className="data-table mobile-card-table interest-table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Oportunidade</th><th role="columnheader" scope="col">Registado por</th><th role="columnheader" scope="col">Data</th><th role="columnheader" scope="col">Departamentos / Unidades</th><th role="columnheader" scope="col">Notas iniciais / análise</th><th role="columnheader" scope="col">Situação</th><th role="columnheader" scope="col">Ações</th></tr></thead><tbody role="rowgroup">{data.items.map(item => <tr role="row" key={item.interestId} className={params.get('destaque')===item.interestId?'highlighted-interest':undefined}>
      <td role="cell" data-label="Oportunidade"><Link to={`/interesses/${item.interestId}?${new URLSearchParams({ retorno: location.pathname + location.search })}`}>{item.title || item.snapshot?.title}</Link></td><td role="cell" data-label="Registado por">{item.createdByName || 'Membro da organização'}</td><td role="cell" data-label="Data">{date(item.createdAt)}</td><td role="cell" data-label="Departamentos / Unidades"><Units transversal={item.transversal} unitIds={item.unitIds} units={item.units}/></td><td role="cell" data-label="Notas iniciais / análise">{item.notesExcerpt || 'Sem notas'}</td><td role="cell" data-label="Situação">{item.status === 'ARCHIVED' ? 'Arquivado' : 'Ativo'}</td><td role="cell" data-label="Ações"><div className="interest-row-actions">
        {canPrepareApplication(item) && <button type="button" className="btn btn-primary btn-sm" aria-label={`Preparar candidatura para ${item.title || item.snapshot?.title}`} aria-busy={openingId === item.interestId} disabled={loading || commandLocked || Boolean(openingId)} onClick={() => prepareApplication(item)}>{openingId === item.interestId ? 'A preparar…' : 'Preparar candidatura'}</button>}
        <Link className="btn btn-outline btn-sm" aria-label={`Rever análise de ${item.title || item.snapshot?.title}`} to={`/interesses/${item.interestId}?${new URLSearchParams({ retorno: location.pathname + location.search })}`}>Rever análise</Link>
      </div></td>
    </tr>)}</tbody></table></div>{!data.items.length && <p>Sem interesses para esta seleção.</p>}
      {(cursor || data.nextCursor) && <nav className="pagination" aria-label="Páginas dos interesses"><button className="btn btn-secondary" disabled={!cursor} onClick={() => changePage(null)}>Anterior</button><button className="btn btn-secondary" disabled={!data.nextCursor} onClick={() => changePage(data.nextCursor)}>Seguinte</button></nav>}</>}
  </main>
}
function InterestDetail({ id, userId, organizationId }) {
  const [params] = useSearchParams(), location = useLocation(), navigate = useNavigate(), alive = useRef(true), generation = useRef(0), openingMutex = useRef(false)
  const [opening, setOpening] = useState(false)
  const [record, setRecord] = useState(null), [history, setHistory] = useState([]), [historyNext, setHistoryNext] = useState(null), [historyBusy, setHistoryBusy] = useState(false)
  const [units, setUnits] = useState([]), [unitsReady, setUnitsReady] = useState(false), [unitsLoading, setUnitsLoading] = useState(false), [notes, setNotes] = useState(''), [unitIds, setUnitIds] = useState([]), [archiveOpen, setArchiveOpen] = useState(false), [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [unitError, setUnitError] = useState(''), [refresh, setRefresh] = useState(0), [notice, setNotice] = useState('')
  const command = useInterestCommand(userId, organizationId, () => { generation.current += 1; setArchiveOpen(false); setNotice('Alteração guardada.'); setRefresh(value => value + 1) })
  async function loadUnits(data, token, signal) {
    const current = () => alive.current && token === generation.current
    setUnitsLoading(true); setUnitError('')
    try {
      const choices = (await api.units({ purpose: 'ASSIGN' }, organizationId, signal)).data.items
      if (!Array.isArray(choices)) throw Error('Invalid units')
      if (current()) { const known = new Set(choices.map(unit => unit.unitId)); setUnits([...choices, ...(data.units || []).filter(unit => !known.has(unit.unitId))]); setUnitsReady(true) }
    } catch { if (current()) setUnitError('Não foi possível consultar as unidades. As associações existentes foram preservadas.') }
    finally { if (current()) setUnitsLoading(false) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1 } }, [])
  useEffect(() => {
    const token = ++generation.current, controller = new AbortController(); setLoading(true); setError(''); setUnitError(''); setRecord(null); setUnitsReady(false)
    const current = () => alive.current && token === generation.current
    async function load() {
      try {
        const [{ data }, { data: events }] = await Promise.all([api.get(id, organizationId, controller.signal), api.history(id, {}, organizationId, controller.signal)])
        if (!current()) return
        setRecord(data); setNotes(data.notes || ''); setUnitIds(data.unitIds || []); setHistory(events.items); setHistoryNext(events.nextCursor)
        if (data.capabilities?.canManage && data.status === 'ACTIVE') await loadUnits(data, token, controller.signal)
      } catch (e) { if (current()) setError(interestError(e)) }
      finally { if (current()) setLoading(false) }
    }
    load(); return () => { controller.abort(); generation.current += 1 }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; loadUnits is read at that moment.
  }, [id, organizationId, refresh])
  async function moreHistory() {
    if (historyBusy || !historyNext) return
    const token = generation.current; setHistoryBusy(true)
    try { const { data } = await api.history(id, { cursor: historyNext }, organizationId); if (alive.current && token === generation.current) { setHistory(previous => [...previous, ...data.items]); setHistoryNext(data.nextCursor) } }
    catch (e) { if (alive.current && token === generation.current) setError(interestError(e)) }
    finally { if (alive.current && token === generation.current) setHistoryBusy(false) }
  }
  const analysisDirty=Boolean(record&&((notes||'')!==(record.notes||'')||JSON.stringify([...unitIds].sort())!==JSON.stringify([...(record.unitIds||[])].sort())))
  async function openApplication() {
    if (analysisDirty || openingMutex.current || command.busy || command.pending || !record?.capabilities?.canCreateApplication) return
    openingMutex.current = true; setOpening(true); setError(''); const token = generation.current
    try {
      const { data } = await centralOpportunitiesApi.get(record.opportunityId)
      if (!alive.current || token !== generation.current) return
      if (data.opportunityId !== record.opportunityId || !data.revisionId || (data.lifecycleState || data.snapshot?.lifecycleState) === 'ARCHIVED') throw Error('Unavailable')
      navigate(applicationFormTarget(record, data, location.pathname + location.search))
    } catch { if (alive.current && token === generation.current) setError('Não foi possível consultar a oportunidade atual. Tente novamente antes de abrir a candidatura.') }
    finally { openingMutex.current = false; if (alive.current && token === generation.current) setOpening(false) }
  }
  const locked = command.busy || Boolean(command.pending) || command.blocked || opening
  const snapshot = record?.snapshot || {}, model = getOpportunityReadModel(record), display = opportunityDisplay(record || {}), official = model ? display.officialUrl : sourceUrl(snapshot.officialUrl), returnTo = safeInterestReturn(params.get('retorno'))
  return <main className="page detail-page interests-page"><Link to={returnTo}>Voltar</Link>{!archiveOpen && <Feedback command={command}/>} {notice && <p role="status">{notice}</p>}
    {(error || unitError) && <div role="alert"><p>{error || unitError}</p><button className="btn btn-outline" disabled={locked || unitsLoading} onClick={() => { if (unitError && !error && record) loadUnits(record, generation.current); else setRefresh(value => value + 1) }}>Consultar novamente</button></div>}
    {loading && <LoadingIndicator>A carregar interesse…</LoadingIndicator>}
    {record && <><h1>{record.title || snapshot.title}</h1><p>{record.status === 'ARCHIVED' ? 'Interesse arquivado' : 'Interesse registado'} · {date(record.createdAt)} · {record.createdByName || 'Membro da organização'}</p>
      {record.status === 'ACTIVE' && record.capabilities?.canManage && record.capabilities?.canCreateApplication && <div className="form-actions"><button className="btn btn-primary" disabled={locked || analysisDirty} onClick={openApplication}>{opening ? 'A consultar oportunidade…' : 'Preparar candidatura'}</button>{analysisDirty && <p role="status">Guarde a análise antes de abrir a candidatura.</p>}</div>}
      <section className="detail-section"><h2>Análise da organização</h2>{record.capabilities?.canManage && record.status === 'ACTIVE' ? <form className="interest-analysis" onSubmit={event => { event.preventDefault(); command.submit('edit', id, { notes: notes || null, unitIds, expectedRevision: record.revision }) }}>
        <label>Notas<textarea maxLength={10000} rows={5} value={notes} disabled={locked} onChange={event => setNotes(event.target.value)}/></label>
        {unitsReady ? <UnitSelector units={units} selectedIds={unitIds} emptyLabel={record.transversal?'Interesse transversal à C4G':undefined} onChange={setUnitIds} disabled={locked}/> : <Units transversal={record.transversal} unitIds={record.unitIds} units={record.units}/>}
        <div className="form-actions"><button className="btn btn-primary" disabled={locked || !unitsReady}>Guardar análise</button><button type="button" className="btn btn-outline" disabled={locked} onClick={() => setArchiveOpen(true)}>Arquivar interesse</button></div>
      </form> : <><p className="pre-wrap">{record.notes || 'Sem notas.'}</p><Units transversal={record.transversal} unitIds={record.unitIds} units={record.units}/></>}</section>
      <section className="detail-section"><h2>Oportunidade</h2>{model ? <OpportunityReadModelDetails readModel={model} fields={snapshot}/> : <dl className="interest-source"><dt>Referência</dt><dd>{snapshot.callReference || 'Não indicada'}</dd><dt>Programa</dt><dd>{snapshot.programmeName || 'Não indicado'}</dd><dt>Financiador</dt><dd>{snapshot.funderName || 'Não indicado'}</dd><dt>Abertura</dt><dd>{date(snapshot.openingDate)}</dd><dt>Prazo oficial</dt><dd>{date(snapshot.closingDate)}</dd></dl>}
        {snapshot.sourceTemporal?.deadlines?.length > 1 && <><h3>Prazos publicados</h3><ul>{snapshot.sourceTemporal.deadlines.map(value => <li key={value}><time dateTime={value}>{value.length === 10 ? date(value) : new Date(value).toLocaleString('pt-PT')}</time></li>)}</ul></>}
        <div className="form-actions"><Link className="btn btn-outline" to={`/catalogo/${record.opportunityId}`}>Consultar oportunidade</Link>{official && <a className="btn btn-outline" href={official} target="_blank" rel="noopener noreferrer">Fonte oficial</a>}<Link className="btn btn-outline" to={`/matching?oportunidade=${record.opportunityId}&origem=CENTRAL`}>Pessoas correspondentes</Link></div>
      </section>
      <div id="candidaturas-do-interesse" tabIndex={-1}><OpportunityApplications organizationId={organizationId} opportunityId={record.opportunityId}/></div>
      <section className="detail-section"><h2>Histórico</h2><ol className="interest-history">{history.map(item => <li key={item.revision}>Revisão {item.revision} · {({ CREATE:'Interesse registado',REGISTER:'Interesse registado',EDIT:'Análise alterada',ARCHIVE:'Interesse arquivado' })[item.action || item.kind] || 'Alteração'} · {date(item.recordedAt || item.createdAt)}{item.reason && <p>{item.reason}</p>}<details><summary>Dados desta revisão</summary><p className="pre-wrap">{item.notes || 'Sem notas.'}</p><Units transversal={item.transversal} unitIds={item.unitIds} units={item.units}/></details></li>)}</ol>{historyNext && <button className="btn btn-secondary" disabled={historyBusy} onClick={moreHistory}>Mais histórico</button>}</section>
    </>}
    {archiveOpen && record && <FormModal title="Arquivar interesse" locked={locked} onClose={() => setArchiveOpen(false)}><form onSubmit={event => { event.preventDefault(); command.submit('archive', id, { reason: reason.trim(), expectedRevision: record.revision }) }}><Feedback command={command}/><p>As candidaturas associadas mantêm-se. O interesse fica disponível no histórico.</p><label>Motivo<textarea required maxLength={500} value={reason} disabled={locked} onChange={event => setReason(event.target.value)}/></label><div className="form-actions"><button type="button" className="btn btn-secondary" disabled={locked} onClick={() => setArchiveOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={locked || !reason.trim()}>Confirmar arquivo</button></div></form></FormModal>}
  </main>
}


