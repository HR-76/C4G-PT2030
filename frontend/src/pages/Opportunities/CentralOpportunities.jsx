import CatalogColumnVisibility, { selectedCatalogColumns } from './CatalogColumnVisibility'
import { Card, CardHeader } from '../../components/Layout/MetronicCatalog'
import CatalogReadWorkspace from './CatalogReadWorkspace'
import FilterBar from '../../components/FilterBar'
import './catalogFilters.css'
import SearchInput from '../../components/SearchInput'
import LoadingIndicator from '../../components/LoadingIndicator'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, SlidersHorizontal, X } from 'lucide-react'
import { centralOpportunitiesApi, platformCentralOpportunitiesApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import { OpportunityOverview } from './OpportunityPresentation'
import OpportunityListTable from './OpportunityListTable'
import OpportunityApplicationCount from './OpportunityApplicationCount'
import CatalogInterestButton, { CatalogApplicationButton } from './CatalogInterestButton'
import CatalogInterests from '../Interests/CatalogInterests'
import { downloadOpportunityPage, opportunityDisplay } from './opportunityReadModel'
import { emptyCatalogFilters as emptyFilters, initialCatalogFilters, catalogFilterParams, catalogPaginationParams, catalogPeriodDates, catalogQuery, catalogSourceOptions } from './catalogFilters'
export default function CentralOpportunities() {
  const { id } = useParams(), { organization, user } = useAuth()
  if (import.meta.env.MODE === 'catalog-isolated') return <CatalogReadWorkspace scope={`${user?.id || ''}:${organization?.id || ''}`} />
  const platformAdmin = !!user?.platformRoles?.includes('C4G_ADMIN')
  return <><Catalog key={`${user?.id}:${organization?.id}:${platformAdmin}:${id || 'list'}`} id={id} organization={organization} platformAdmin={platformAdmin} /></>
}
function Catalog({ id, organization, platformAdmin }) {
  const canRead = !!organization || platformAdmin
  const api = platformAdmin ? platformCentralOpportunitiesApi : centralOpportunitiesApi
  const [params, setParams] = useSearchParams()
  const [initialFilters] = useState(() => initialCatalogFilters(params))
  const [items, setItems] = useState([]), [record, setRecord] = useState(null), [next, setNext] = useState(null), [pages, setPages] = useState(() => [...params.getAll('catalogPrevious').map(value => value || null), params.get('catalogCursor') || null])
  const [draft, setDraft] = useState(initialFilters), [filters, setFilters] = useState(initialFilters), [mode, setMode] = useState(null), [retry, setRetry] = useState(0)
  const columns = selectedCatalogColumns(params, Boolean(organization))
  const sort = params.get('sort') || ''
  function changeSort(value) {
    setPages([null])
    const next = catalogPaginationParams(params, [null])
    if (value) next.set('sort', value)
    else next.delete('sort')
    setParams(next, {replace:true})
  }
  function changeColumns(keys) {
    const next = new URLSearchParams(params)
    if (keys === null) next.delete('colunas')
    else next.set('colunas', keys.join(','))
    setParams(next, {replace:true})
  }
  const [interventionAreas,setInterventionAreas]=useState([])
  const [programmes, setProgrammes] = useState([]), [period, setPeriod] = useState(params.get('period') || 'all')
  function applyFilters(selected, selectedPeriod = period) {
    setPages([null]); setFilters(selected)
    const next = new URLSearchParams(catalogFilterParams(selected, selectedPeriod))
    if (sort) next.set('sort', sort)
    if (columns !== null) next.set('colunas', columns.join(','))
    setParams(next, { replace: true })
  }
  const search = params.toString() ? `?${params}` : ''
  function changePage(values) {
    setPages(values)
    setParams(catalogPaginationParams(params, values), { replace: true })
  }
  function choosePeriod(value) {
    setPeriod(value)
    setDraft({ ...draft, ...catalogPeriodDates(value) })
  }
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const cursor = pages.at(-1)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true); setError(''); setRecord(null); setItems([]); setNext(null)
    if (!canRead) { setLoading(false); return () => { active = false } }
    const query = catalogQuery(filters, cursor)
    if (sort) query.sort = sort
    const request = id ? api.get(id, controller.signal) : api.list(query, controller.signal)
    request.then(r => { if (!active) return; setMode(r.data.sourceMode); if (id) setRecord(r.data); else { setItems(r.data.items); setInterventionAreas(r.data.interventionAreas || []); setProgrammes(r.data.programmes || []); setNext(r.data.nextCursor) } }).catch(error => { if (active) setError(error?.response?.data?.error?.code === 'INVALID_INPUT' ? 'Filtros inv\u00e1lidos. Reveja a sele\u00e7\u00e3o ou limpe os filtros.' : 'O catálogo não está disponível ou não tem acesso nesta organização.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [id, organization?.id, canRead, api, cursor, filters, sort, retry])
  const fields = record?.snapshot
  const contextItem = record ? { ...fields, ...opportunityDisplay(record), lifecycleState: record.lifecycleState || fields?.lifecycleState, opportunityId: record.opportunityId } : null
  const filtered = Object.values(filters).some(Boolean)
  const sourceOptions = catalogSourceOptions
  const activeFilters = [
    ['q', 'Pesquisa', filters.q],
    ['source', 'Fonte', filters.source && (sourceOptions.find(([code]) => code === filters.source)?.[1] || 'Fonte inválida')],
    ['interventionArea', 'Área', filters.interventionArea === 'UNCLASSIFIED' ? 'Por classificar' : interventionAreas.find(area => area.code === filters.interventionArea)?.label || filters.interventionArea],
    ['programme', 'Programa', filters.programme],
    ['temporalState', 'Estado', ({ OPEN: 'Abertas', PLANNED: 'Planeadas', UPCOMING: 'Por abrir', CLOSED: 'Encerradas', CANCELLED: 'Canceladas', UNKNOWN: 'Por confirmar' })[filters.temporalState] || filters.temporalState],
    ['period', 'Prazo', [filters.closingFrom && `desde ${filters.closingFrom}`, filters.closingTo && `até ${filters.closingTo}`].filter(Boolean).join(' ')],
  ].filter(([, , value]) => value)
  function removeFilter(key) {
    const cleared = key === 'period' ? { closingFrom: '', closingTo: '' } : { [key]: '' }
    if (key === 'period') setPeriod('all')
    setDraft(previous => ({ ...previous, ...cleared }))
    applyFilters({ ...filters, ...cleared }, key === 'period' ? 'all' : params.get('period') || 'all')
  }
  const pendingFilters = Object.keys(emptyFilters).some(key => draft[key] !== filters[key])
  const invalidDates = draft.closingFrom && draft.closingTo && draft.closingFrom > draft.closingTo
  return <CatalogInterests organization={organization} items={id ? (contextItem ? [contextItem] : []) : items} catalogApi={api}><div className={`page recovered-opportunities organization-catalog${id ? "" : columns === null ? " catalog-pilot catalog-summary" : " catalog-pilot catalog-summary catalog-custom" + (columns.length > 6 ? " catalog-wide" : "")}`}><div className="page-header"><div>{!id && <h1>Oportunidades</h1>}</div>
    {organization && <Link className="btn btn-outline" to="/interesses">Interesses</Link>}
    {organization && <Link className="btn btn-brand" to="/candidaturas">Candidaturas</Link>}
    {platformAdmin && <Link className="btn btn-primary" to="/administracao/oportunidades/nova"><Plus size={16} /> Criar oportunidade</Link>}
    {platformAdmin && !organization && <Link className="btn btn-outline" to="/integracoes">Fontes de oportunidades</Link>}</div>
    {mode && <aside className="catalog-source" aria-label="Dados do catálogo">
      <strong>{mode === 'fixture' ? 'Dados de teste' : mode === 'live-demo' ? 'Demonstração' : mode === 'live-rehearsal' ? 'Recolha limitada' : mode === 'live-staging' ? 'Recolha de staging' : 'Fontes oficiais'}</strong>
      <details className="catalog-guidance"><summary>Catálogo parcial · cobertura e interpretação dos prazos</summary>
        <p>{mode === 'fixture' ? 'Estes registos servem para testar a aplicação. Não são oportunidades reais.' : 'Consulte a fonte oficial para confirmar os dados e as condições.'} A listagem inclui registos recolhidos e oportunidades criadas manualmente pela C4G; não representa toda a fonte.</p>
        {!id && <p>A listagem inclui todos os prazos. Use os filtros para consultar apenas prazos atuais ou históricos. Os atalhos incluem hoje e a data final, em UTC. Um prazo futuro não garante abertura nem elegibilidade; confirme a fonte oficial.</p>}
      </details>
    </aside>}
    {id && <div className="detail-hd"><Link className="btn-back" to={`/catalogo${search}`}><ArrowLeft size={16} /> Voltar ao catálogo</Link></div>}
    {!canRead && <p>Escolha uma organização autorizada no cabeçalho para consultar o catálogo. Se não tiver nenhuma, contacte o administrador da sua organização.</p>}
    {!id && canRead && <FilterBar as="form" className="recovered-filters catalog-discovery-filters" onSubmit={event => { event.preventDefault(); if (!invalidDates) { applyFilters({ ...draft }); event.currentTarget.querySelector(".catalog-extra-filters").open = false } }}>
      <label className="opportunity-search filter-search">Pesquisar<SearchInput maxLength={200} placeholder="Título ou identificador da fonte" value={draft.q} onChange={e => setDraft({ ...draft, q: e.target.value })} /></label>
      <details className="catalog-extra-filters" open={Object.entries(initialFilters).some(([key,value]) => key !== "q" && value && value !== emptyFilters[key]) || undefined}><summary><SlidersHorizontal size={15} aria-hidden="true" />Filtros avançados</summary><div className="catalog-filter-fields">
      <label>Área de intervenção<select aria-label="Área de intervenção" value={draft.interventionArea} onChange={e => setDraft({...draft,interventionArea:e.target.value})}><option value="">Todas as áreas</option>{interventionAreas.map(area=><option key={area.code} value={area.code}>{area.label}</option>)}<option value="UNCLASSIFIED">Por classificar</option></select></label>
      <label>Fonte<select aria-label="Fonte" value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })}><option value="">Todas as fontes</option>{sourceOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}{draft.source && !sourceOptions.some(([code]) => code === draft.source) && <option value={draft.source}>Fonte inválida</option>}</select></label>
      <label>Programa<select aria-label="Programa" value={draft.programme} onChange={e => setDraft({ ...draft, programme: e.target.value })}><option value="">Todos os programas</option>{programmes.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Estado<select aria-label="Estado temporal" value={draft.temporalState} onChange={e=>{setDraft({...draft,temporalState:e.target.value})}}><option value="">Todos os estados</option><option value="OPEN">Abertas</option><option value="PLANNED">Planeadas</option><option value="UPCOMING">Por abrir</option><option value="CLOSED">Encerradas</option><option value="CANCELLED">Canceladas</option><option value="UNKNOWN">Por confirmar</option></select></label>
      <label>Prazo<select aria-label="Prazo" value={period} onChange={e => choosePeriod(e.target.value)}><option value="current">Prazos atuais</option><option value="7">A encerrar em 7 dias</option><option value="14">A encerrar em 14 dias</option><option value="30">A encerrar em 30 dias</option><option value="past">Prazos passados</option><option value="all">Todos os prazos</option><option value="custom" disabled>Intervalo personalizado</option></select></label>
      <details className="catalog-date-filters" open={period === 'custom'}><summary>Datas personalizadas</summary><div>
      <label>Fecho a partir de<input type="date" value={draft.closingFrom} onChange={e => { setPeriod('custom'); setDraft({ ...draft, closingFrom: e.target.value }) }} /></label>
      <label>Fecho até<input type="date" value={draft.closingTo} onChange={e => { setPeriod('custom'); setDraft({ ...draft, closingTo: e.target.value }) }} /></label>
      </div></details></div></details>
      <div className="form-actions filter-actions filter-wide"><button className="btn btn-outline" disabled={!!invalidDates}>Aplicar filtros</button><button className="btn btn-secondary" type="button" onClick={() => { setPeriod('all'); setDraft(emptyFilters); applyFilters(emptyFilters, 'all'); }}>Limpar filtros</button></div>
      {pendingFilters && <p className="filter-note" role="status">Alterações por aplicar</p>}
      {invalidDates && <p role="alert">A data final deve ser igual ou posterior à inicial.</p>}
    </FilterBar>}
    {!id && canRead && activeFilters.length > 0 && <section className="catalog-filter-badges" aria-label="Filtros aplicados">
      <strong>{activeFilters.length} {activeFilters.length === 1 ? 'filtro ativo' : 'filtros ativos'}</strong>
      {activeFilters.map(([key, label, value]) => <button key={key} type="button" data-slot="badge" aria-label={`Remover filtro de ${label.toLocaleLowerCase('pt-PT')}`} onClick={() => removeFilter(key)}>
        <span>{label}: {value}</span><X size={14} aria-hidden="true" />
      </button>)}
    </section>}
    {loading && <LoadingIndicator>A consultar oportunidades…</LoadingIndicator>}{error && <div className="catalog-empty"><p role="alert">{error}</p><button className="btn btn-outline" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button></div>}
    {fields && <article className="detail-page">
      <OpportunityOverview interventionClassification={record.interventionClassification} centralPresentation={record.catalogPresentation} readModel={record.readModel} lifecycleState={record.lifecycleState} validationState={record.validationState} temporal={record.temporal} sourceReview={record.sourceReview} fields={fields} source={record.source} reference={fields.callReference || record.externalIdentifier} observedAt={record.observedAt} registeredAt={record.createdAt} applicationCount={<OpportunityApplicationCount organizationId={organization?.id} opportunityId={id} />} central>
        {organization && <CatalogInterestButton item={contextItem} />}
        {organization?.navigation?.people===true&&<Link className="btn btn-outline btn-sm" to={`/matching?oportunidade=${record.opportunityId}&origem=CENTRAL`}>Pessoas correspondentes</Link>}
      </OpportunityOverview>
    </article>}
    {!id && canRead && <div className="catalog-compare-tools">
      <label>Ordenar resultados<select value={sort} onChange={event => changeSort(event.target.value)}>
        <option value="">Ordem do catálogo</option>
        <option value="closing_asc">Fecho mais próximo</option><option value="closing_desc">Fecho mais tardio</option>
        <option value="amount_desc">Maior dotação por moeda</option><option value="amount_asc">Menor dotação por moeda</option>
      </select></label>
    </div>}
    {!id && !loading && !error && canRead && <Card><CardHeader><p className="table-meta" role="status">{items.length} {items.length === 1 ? 'oportunidade' : 'oportunidades'} nesta página{filtered ? ' · filtros aplicados' : ''}</p>
      {!!items.length && <div className="catalog-actions"><CatalogColumnVisibility selected={columns} hasOrganization={Boolean(organization)} onChange={changeColumns}/><button className="btn btn-outline btn-sm" type="button" onClick={() => downloadOpportunityPage(items)}>Exportar página</button></div>}</CardHeader>
      {!!items.length && <OpportunityListTable sort={sort} onSort={changeSort} visibleColumns={columns} items={items} organizationId={organization?.id} central interestOnly search={search} applicationsLabel="Interesse" renderApplicationAction={organization?item=><div key={item.opportunityId} className="catalog-row-actions"><CatalogInterestButton item={item} compact/><CatalogApplicationButton item={item}/></div>:undefined} />}
      {!items.length && <div className="catalog-empty"><h2>{filtered ? 'Sem resultados para estes filtros' : 'Ainda não existem oportunidades no catálogo comum.'}</h2><p>{filtered ? 'Experimente outro termo ou limpe os filtros.' : 'As oportunidades ficam disponíveis depois de a Administração C4G as criar ou atualizar uma fonte.'}</p>{filtered && <button type="button" className="btn btn-outline" onClick={() => { setPeriod('all'); setDraft(emptyFilters); applyFilters(emptyFilters, 'all') }}>Ver todo o catálogo</button>}</div>}
      {(pages.length > 1 || next) && <nav className="catalog-actions" aria-label="Páginas do catálogo"><button className="btn btn-secondary" disabled={pages.length === 1} onClick={() => changePage(pages.slice(0, -1))}>Página anterior</button><span>Página {pages.length}</span><button className="btn btn-secondary" disabled={!next} onClick={() => changePage([...pages, next])}>Página seguinte</button></nav>}</Card>}
  </div></CatalogInterests>
}
