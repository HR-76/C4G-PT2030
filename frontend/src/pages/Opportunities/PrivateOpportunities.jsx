import './privateOpportunityPilot.css'
import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import LoadingIndicator from '../../components/LoadingIndicator'
import CriteriaPanel from '../OpportunityCriteria/CriteriaPanel'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { privateOpportunitiesApi, pq1Api } from '../../api/api'
import EmptyStatePanel from '../../components/EmptyStatePanel'
import { OpportunityOverview, recordStates } from './OpportunityPresentation'
import OpportunityListTable from './OpportunityListTable'
import OpportunityApplicationCount from './OpportunityApplicationCount'
import OpportunityApplications from './OpportunityApplications'

// Share the session queue with organization selection and application summaries.
// A parallel authority refresh must not invalidate the initial opportunity read.
const opportunitiesApi = {
  ...privateOpportunitiesApi,
  list: (params, signal) => pq1Api.session(() => privateOpportunitiesApi.list(params, signal)),
  get: id => pq1Api.session(() => privateOpportunitiesApi.get(id)),
}

export function errorMessage(error) {
  const status = error.response?.status
  if (status === 401) return 'Sessão expirada. Inicie sessão novamente.'
  if (status === 409) return 'Conflito de revisão. Recarregue a revisão persistida antes de voltar a editar.'
  if (status === 403 || status === 404) return 'Acesso recusado ou oportunidade indisponível.'
  if (status === 400) return 'Pedido inválido. Verifique os campos, datas, montantes e moeda.'
  if (status === 503 || !status) return 'Operação indisponível ou confirmação pendente. Repita o mesmo pedido, sem alterar a intenção.'
  return 'Não foi possível concluir a operação. Tente novamente.'
}
export function money(snapshot) {
  if (!snapshot?.currencyCode || snapshot.fundingAmountMin === undefined) return 'Não indicado'
  // Preserve exact textual amounts rather than converting them through JS Number.
  return `${snapshot.fundingAmountMin} – ${snapshot.fundingAmountMax} ${snapshot.currencyCode}`
}
export function PrivateOpportunityList({ organization }) {
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [next, setNext] = useState(null)
  const [history, setHistory] = useState([]), [filters, setFilters] = useState({programmeName:'',funderName:'',lifecycleState:'ACTIVE'})
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [reload,setReload]=useState(0)
  useEffect(() => {
    if (!organization) return
    let active = true; const controller = new AbortController()
    setLoading(true); setError(''); setItems([]); setNext(null)
    const params = {...Object.fromEntries(Object.entries(filters).filter(([,v]) => v)), pageSize:20, sort:'UPDATED_DESC', ...(cursor ? {cursor} : {})}
    const timer = setTimeout(() => opportunitiesApi.list(params, controller.signal).then(response => { if (active) { setItems(response.data.items); setNext(response.data.nextCursor) } })
      .catch(e => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) }), 250)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; organization is read at that moment.
  }, [organization?.id, filters, cursor, reload])
  if (!organization) return <p role="status">Esta conta não tem uma entidade associada para consultar oportunidades privadas.</p>
  const filter = (key,value) => { setCursor(null); setHistory([]); setFilters(previous => ({...previous,[key]:value})) }
  return <section className="page recovered-opportunities private-opportunity-pilot">
    <div className="page-header"><div><h1>Oportunidades privadas</h1>
    {organization.name && <p className="pilot-entity">{organization.name}</p>}</div><Link className="btn btn-outline" to="/catalogo">Consultar catálogo C4G</Link></div>
    <FilterBar className="recovered-filters" aria-label="Filtros de oportunidades privadas">
      <label>Programa <SearchInput value={filters.programmeName} onChange={e => filter('programmeName',e.target.value)} /></label>
      <label>Financiador <SearchInput value={filters.funderName} onChange={e => filter('funderName',e.target.value)} /></label>
      <label>Estado do registo <select aria-label="Estado do registo" value={filters.lifecycleState} onChange={e => filter('lifecycleState',e.target.value)}>
        {['ACTIVE','DRAFT','STALE','ARCHIVED'].map(value => <option key={value} value={value}>{recordStates[value]}</option>)}
      </select></label>
      <button type="button" className="btn btn-secondary" onClick={()=>{setCursor(null);setHistory([]);setFilters({programmeName:'',funderName:'',lifecycleState:'ACTIVE'})}}>Limpar filtros</button><p className="filter-note">Os resultados atualizam automaticamente. A limpeza repõe o estado ativo.</p>
    </FilterBar>
    {loading && <LoadingIndicator>A carregar oportunidades…</LoadingIndicator>}
    {error && <><p role="alert">{error}</p><button onClick={()=>setReload(value=>value+1)}>Repetir consulta</button></>}
    {!loading && !error && items.length === 0 && <EmptyStatePanel title="Sem oportunidades privadas" description="Não existem resultados para estes filtros na organização ativa." />}
    {!loading && !error && items.length > 0 && <><p className="table-meta">{items.length === 1 ? "1 oportunidade" : `${items.length} oportunidades`} nesta página</p><OpportunityListTable items={items} organizationId={organization.id} /></>}
    {(items.length > 0 || history.length > 0) && <nav className="pagination" aria-label="Paginação de oportunidades privadas">
      <button className="btn btn-secondary" disabled={loading || !history.length} onClick={() => { setCursor(history.at(-1)); setHistory(previous => previous.slice(0,-1)) }}>Anterior</button>
      <span>Página {history.length + 1}</span>
      <button className="btn btn-secondary" disabled={loading || !!error || !next} onClick={() => { setHistory(previous => [...previous,cursor]); setCursor(next) }}>Seguinte</button>
    </nav>}
  </section>
}
export function PrivateOpportunityDetail({ id, organization }) {
  const alertQuery = useLocation().state?.alertQuery
  const fromAlerts = typeof alertQuery === "string"
  const [record,setRecord]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0)
  useEffect(()=>{
    if(!organization)return
    let active=true;setLoading(true);setRecord(null);setError('')
    opportunitiesApi.get(id).then(response=>{if(active)setRecord(response.data)}).catch(e=>{if(active)setError(errorMessage(e))}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; organization is read at that moment.
  },[id,organization?.id,reload])
  if(!organization)return <p role="status">Esta conta não tem uma entidade associada para consultar esta oportunidade.</p>
  return <section className="page recovered-opportunities">
    <Link to={fromAlerts ? "/notificacoes" + (alertQuery ? "?" + alertQuery : "") : "/oportunidades"}>{fromAlerts ? "Voltar aos alertas" : "Voltar às oportunidades"}</Link>
    {loading&&<LoadingIndicator>A carregar revisão…</LoadingIndicator>}
    {error&&<p role="alert">{error}</p>}
    {!loading&&<button className="btn btn-outline" onClick={()=>setReload(value=>value+1)}>Recarregar revisão persistida</button>}
    {record&&!loading&&<>
      <p className="text-muted">Revisão {record.revisionNumber}</p>
      <OpportunityOverview fields={record.snapshot} readModel={record.readModel} lifecycleState={record.lifecycleState} validationState={record.validationState} registeredAt={record.createdAt} applicationCount={<OpportunityApplicationCount organizationId={organization.id} opportunityId={id} />}>
        {(record.lifecycleState||record.snapshot.lifecycleState)!=='ARCHIVED'&&<Link className="btn btn-primary" to={`/candidaturas?nova=1&oportunidade=${id}`}>Criar candidatura</Link>}
        <Link className="btn btn-outline btn-sm" to={`/matching?oportunidade=${id}&origem=PRIVATE`}>Pessoas correspondentes</Link>
      </OpportunityOverview>
      <OpportunityApplications key={`${organization.id}:${id}`} organizationId={organization.id} opportunityId={id} />
      {record.capabilities?.evidencedCriteria===true&&<CriteriaPanel key={organization.id+':'+id} opportunity={record} organization={organization} />}
    </>}
  </section>
}
