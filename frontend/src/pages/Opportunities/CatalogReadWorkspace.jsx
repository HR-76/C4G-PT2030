import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import CatalogFilters from './CatalogReadFilters'
import CatalogReadResults from './CatalogReadResults'
import { catalogReadApi, centralOpportunitiesApi } from '../../api/api'
import CatalogInterests from '../Interests/CatalogInterests'
import CatalogInterestButton from './CatalogInterestButton'
import { catalogSession } from './catalogReadSession'
import { CallInformation } from './CatalogPresentation'
import { cleanFilters, filterKeys, sections, labels, explainStatus, Value, OfficialLink } from './CatalogReadValues'
import { ErrorState, Summary, Section } from './CatalogReadDetails'
export { cleanFilters, exactAmount, safeLink, Value } from './CatalogReadValues'
import CatalogApplicationStatuses from './CatalogApplicationStatuses'
import './catalogRead.css'

export default function CatalogReadWorkspace({ scope, basePath = '/catalogo', isolated = true, interestOrganization = null }) {
  const { id } = useParams(),
    [params, setParams] = useSearchParams()
  const initial = useMemo(
    () =>
      params.size
        ? cleanFilters(params)
        : {},
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; params is read at that moment.
    [],
  )
  const store = useMemo(
    () => catalogSession(scope, catalogReadApi, initial),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; initial is read at that moment.
    [scope],
  )
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [draft, setDraft] = useState(state.filters)
  const [view, setView] = useState('table')
  const query = new URLSearchParams({
    ...state.filters,
    view: 'all',
  }).toString()
  const page = state.pages[state.index]
  const interestItems = (state.error ? [] : id ? (state.detail?.summary?.id === id ? [state.detail.summary] : []) : page?.data || []).map(summary => ({opportunityId: summary.id, revisionId: summary.revisionId, title: summary.title.value || 'Oportunidade'}))
  const interestCatalog = {async get(opportunityId) {
    const selected = interestItems.find(item => item.opportunityId === opportunityId)
    if (!selected || !state.meta?.snapshot) throw Error('CATALOG_SELECTION_UNAVAILABLE')
    const visible = await catalogReadApi('/opportunities/' + opportunityId, {snapshot: state.meta.snapshot})
    if (visible.data.summary.id !== opportunityId || visible.data.summary.revisionId !== selected.revisionId) throw Error('CATALOG_SELECTION_CHANGED')
    const current = await centralOpportunitiesApi.get(opportunityId)
    if (current.data.opportunityId !== opportunityId || current.data.revisionId !== selected.revisionId) throw Error('CATALOG_SELECTION_CHANGED')
    return current
  }}
  useEffect(() => {
    setDraft(state.filters)
  }, [state.filters])
  useEffect(() => {
    const urlFilters = params.size ? cleanFilters(params) : initial
    const current = store.getSnapshot()
    if (filterKeys.some((key) => urlFilters[key] !== current.filters[key])) {
      store.apply(urlFilters).then(() => {
        if (id && !store.getSnapshot().error) store.detail(id)
      })
      return
    }
    if (current.error && [401, 403, 410].includes(current.error.status)) return
    if (id) store.detail(id)
    else if (!current.busy) {
      if (!current.pages.length) store.list()
      else store.revalidate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; initial, params are read at that moment.
  }, [id, store, params.toString()])
  useEffect(() => {
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [id])
  useEffect(() => {
    const focus = () => {
      if (!store.getSnapshot().error) {
        store.revalidate(id)
      }
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [id, store])
  useEffect(() => () => store.pause(), [store])
  function apply(values) {
    const clean = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== ''),
    )
    setParams({ ...clean, view: 'all' }, { replace: true })
    store.apply(clean)
  }
  function refresh() {
    store.apply(state.filters).then(() => {
      if (id && !store.getSnapshot().error) store.detail(id)
    })
  }
  const content = (
    <main className="catalog-read">
      <header>
        <p className="cr-eyebrow">{isolated ? 'GCNI · Laboratório de oportunidades' : 'GCNI · Catálogo unificado'}</p>
        <p>{isolated ? 'Ambiente isolado · fontes suspensas' : 'Consulta de oportunidades'}</p>
      </header>
      {id ? (
        <>
          <Link to={`${basePath}?${query}`}>← Voltar aos resultados</Link>
          {state.detail?.summary?.id === id && (
            <>
              <Summary item={state.detail.summary} />
              {interestOrganization && <CatalogInterestButton item={{opportunityId:state.detail.summary.id,title:state.detail.summary.title.value}} />}
              <CallInformation information={state.detail.callInformation} />
              <h2>Descrição da call / aviso</h2>
              <p className="cr-description">
                {state.detail.description?.state === 'PRESENT' && state.detail.description.value !== state.detail.summary.title.value ? <Value value={state.detail.description} /> : 'A descrição detalhada não está disponível nos dados recolhidos.'}
              </p>
              {state.detail.descriptionTruncated && (
                <p>
                  Descrição abreviada.{' '}
                  <OfficialLink url={state.detail.descriptionSourceUrl}>
                    Ler descrição completa
                  </OfficialLink>
                </p>
              )}
              <p>{explainStatus(state.detail.statusExplanation)}</p>
              {sections.map(([name, title]) => (
                <Section
                  key={`${id}:${name}`}
                  {...{ id, name, title, store, state, basePath }}
                  descriptor={
                    state.detail.collections?.[
                      name === 'funding-rules' ? 'fundingRules' : name
                    ]
                  }
                />
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <h1>Oportunidades de financiamento</h1>
          <p>
            Explore os avisos, compare prazos e consulte a informação que
            sustenta cada oportunidade.
          </p>
          <CatalogFilters {...{ draft, setDraft, state, store, apply, labels, ErrorState }} />
          <div className="cr-chips" aria-label="Filtros aplicados">
            {Object.keys(state.filters).length > 0 && <strong>{Object.keys(state.filters).length} {Object.keys(state.filters).length === 1 ? 'filtro ativo' : 'filtros ativos'}</strong>}
            {Object.entries(state.filters).map(([key, value]) => (
              <button
                key={key}
                disabled={state.busy}
                onClick={() => apply({ ...state.filters, [key]: '' })}
              >
                {labels[key]}: {labels[value] || value} ×
              </button>
            ))}
            <button disabled={state.busy} onClick={() => apply({})}>
              Limpar filtros
            </button>
          </div>
          <CatalogReadResults {...{ page, state, store, interestOrganization, basePath, query, labels, Value, view, setView }} />
        </>
      )}
      {state.busy && <p role="status">A carregar a consulta…</p>}
      {state.error && <ErrorState error={state.error} retry={refresh} />}
      <footer>
        {state.meta && (
          <p>
            Consulta de {state.meta.asOf.replace('T', ' ').replace('Z', ' UTC')}{' '}
            · validade máxima de 15 minutos
          </p>
        )}
        <p>
          A autorização é verificada em cada pedido. Uma alteração de acesso
          será refletida na próxima leitura.
        </p>
      </footer>
    </main>
  )
  const withInterests = interestOrganization && interestItems.length > 0 ? <CatalogInterests organization={interestOrganization} items={interestItems} catalogApi={interestCatalog}>{content}</CatalogInterests> : content
  return !id && interestOrganization && interestItems.length > 0 ? <CatalogApplicationStatuses organizationId={interestOrganization.id} scope={scope} items={interestItems.map(item => ({id:item.opportunityId,title:item.title}))}>{withInterests}</CatalogApplicationStatuses> : withInterests
}
