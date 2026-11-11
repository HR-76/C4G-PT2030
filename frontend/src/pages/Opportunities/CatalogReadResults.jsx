import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import './catalog-list-preview.css'
import { Link } from 'react-router-dom'
import CatalogInterestButton from './CatalogInterestButton'
import { CatalogStatus, PresentationText } from './CatalogPresentation'
import { ApplicationStatusCell } from './CatalogApplicationStatuses'
import { OfficialLink } from './CatalogReadValues'

const inlineQuery = '(max-width: 1023px)'
function subscribeToPreviewLayout(update) {
  const media = window.matchMedia?.(inlineQuery)
  media?.addEventListener('change', update)
  return () => media?.removeEventListener('change', update)
}
const useInlinePreview = () => useSyncExternalStore(
  subscribeToPreviewLayout,
  () => window.matchMedia?.(inlineQuery).matches ?? false,
  () => false,
)

function Funding({ item, Value }) {
  return item.funding?.state === 'UNSUPPORTED'
    ? 'Consultar detalhe do financiamento'
    : <Value value={item.funding} />
}

function Deadline({ deadline, Value }) {
  return deadline.state === 'supported' && deadline.at
    ? <Value value={deadline.at} />
    : <>{deadline.label}{deadline.at && <> · <Value value={deadline.at} /></>}</>
}

function CatalogPreview({ item, id, href, labels, Value, onClose }) {
  const heading = useRef(null)
  useEffect(() => heading.current?.focus(), [item.id])
  return (
    <section id={id} className="catalog-preview-content" aria-labelledby={id + '-heading'}>
      <div className="cr-preview-heading">
        <h3 id={id + '-heading'} ref={heading} tabIndex={-1}>Resumo da oportunidade</h3>
        <button type="button" onClick={onClose}>Fechar resumo</button>
      </div>
      <h4><Value value={item.title} /></h4>
      <CatalogStatus status={item.status} />
      <dl className="cr-preview-facts">
        <div><dt>Prazo</dt><dd><Deadline deadline={item.deadline} Value={Value} />
          {item.deadline.scopeLabel && <small>{item.deadline.scopeLabel}</small>}
        </dd></div>
        <div><dt>Programa</dt><dd>{item.programmes.items.map(programme => programme.label).join(' · ') || 'Não indicado'}</dd></div>
        <div><dt>Dotação</dt><dd><Funding item={item} Value={Value} />
          {item.fundingLabel && <small>{item.fundingLabel}</small>}
        </dd></div>
        <div><dt>Fonte</dt><dd>
          {item.sources?.length ? <ul className="cr-preview-sources">
            {item.sources.map(source => (
              <li key={`${source.namespace}:${source.externalId}`}>
                {labels[source.namespace] || source.namespace}
                {source.externalId && <small>Referência: {source.externalId}</small>}
                <OfficialLink url={source.officialUrl} />
              </li>
            ))}
          </ul> : 'Não indicada'}
        </dd></div>
      </dl>
      {item.descriptionExcerpt?.state === 'PRESENT' && item.descriptionExcerpt.value !== item.title.value &&
        <p className="cr-preview-excerpt"><Value value={item.descriptionExcerpt} /></p>}
      {item.presentation && <dl className="cr-preview-secondary">
        <div><dt>Tipificação</dt><dd><PresentationText field={item.presentation.typification} fallback={labels[item.kind] || 'Não indicada'} /></dd></div>
        <div><dt>Áreas</dt><dd><PresentationText field={item.presentation.areas} /></dd></div>
      </dl>}
      <Link className="cr-preview-open" to={href}>Abrir ficha completa</Link>
    </section>
  )
}

export default function CatalogReadResults({ page, state, store, interestOrganization, basePath, query, labels, Value, view, setView }) {
  const [selected, setSelected] = useState(null)
  const trigger = useRef(null)
  const previewId = useId()
  const inline = useInlinePreview()
  const organizationId = interestOrganization?.id
  useEffect(() => setSelected(null), [page, query, state.error, state.busy, state.index, organizationId])
  const item = !state.error && !state.busy && selected?.page === page && selected?.query === query &&
    selected?.organizationId === organizationId && selected?.index === state.index
    ? page?.data.find(row => row.id === selected.id) : null
  const hrefFor = id => `${basePath}/${id}?${query}`
  function closePreview() {
    setSelected(null)
    trigger.current?.focus()
  }
  function changeView(nextView) {
    setView(nextView)
    setSelected(null)
  }
  const preview = item && <CatalogPreview item={item} id={previewId} href={hrefFor(item.id)} labels={labels} Value={Value} onClose={closePreview} />
  return page && (
            <>
              <p role="status">
                {page.data.length}{' '}
                {page.data.length === 1 ? 'oportunidade' : 'oportunidades'}{' '}
                nesta página · página {state.index + 1}
              </p>
              <div className="cr-view-toggle" role="group" aria-label="Vista do catálogo">
                <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}>Lista</button>
                <button type="button" aria-pressed={view === 'table'} onClick={() => changeView('table')}>Tabela</button>
              </div>
              {view === 'list' && <div className={`cr-list-layout${item && !inline ? ' cr-list-with-preview' : ''}`}
                onKeyDown={event => {
                  if (event.key === 'Escape' && item && !event.defaultPrevented) {
                    event.preventDefault()
                    closePreview()
                  }
                }}>
                <ul className="cr-result-cards" role="list" aria-label="Oportunidades">
                  {page.data.map(row => {
                    const active = item?.id === row.id
                    return <li key={row.id} className="cr-result-entry" data-selected={active}>
                      <article className="cr-result-card">
                        <div>
                          <h2><Link to={hrefFor(row.id)}><Value value={row.title} /></Link></h2>
                          <p><Value value={row.externalCode} /></p>
                          <CatalogStatus status={row.status} />
                        </div>
                        <dl>
                          <div><dt>Programa</dt><dd>{row.programmes.items.map(programme => programme.label).join(' · ') || 'Não indicado'}</dd></div>
                          <div><dt>Dotação</dt><dd><Funding item={row} Value={Value} /></dd></div>
                          <div><dt>Prazo</dt><dd><Deadline deadline={row.deadline} Value={Value} /></dd></div>
                        </dl>
                        <div className="cr-card-actions">
                          <button type="button" disabled={state.busy || Boolean(state.error)} aria-expanded={active}
                            aria-label={`Resumo de ${row.title.value || 'oportunidade'}`}
                            aria-controls={active ? previewId : undefined} onClick={event => {
                              if (active) closePreview()
                              else {
                                trigger.current = event.currentTarget
                                setSelected({ id: row.id, page, query, organizationId, index: state.index })
                              }
                            }}>Resumo</button>
                          {interestOrganization && <CatalogInterestButton item={{ opportunityId: row.id, title: row.title.value }} />}
                        </div>
                      </article>
                      {active && inline && preview}
                    </li>
                  })}
                </ul>
                {!inline && preview}
              </div>}
              {view==='table'&&<div className="cr-table-scroll" role="region" aria-label="Tabela de oportunidades" tabIndex={0}><table>
                <thead>
                  <tr>
                    {[
                      'Oportunidade',
                      'Estado do aviso',
                      ...(interestOrganization ? ['Estado da candidatura'] : []),
                      'Programa',
                      'Tipificação',
                      'Áreas',
                      'Financiamento',
                      'Prazo',
                      'Ações',
                    ].map((v) => (
                      <th key={v} scope="col">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Oportunidade">
                        <strong>
                          {item.kind === 'planned_notice' ? `ID do plano · ${item.sources?.find((source) => source.namespace === 'PORTUGAL2030_PLAN')?.externalId || 'Por confirmar'}` : <Value value={item.externalCode} />}
                        </strong>
                        <p>
                          <Link to={`${basePath}/${item.id}?${query}`}>
                            <Value value={item.title} />
                          </Link>
                        </p>
                        <small>{item.sources?.map((source) => labels[source.namespace] || source.namespace).join(' · ')}</small>
                        {item.descriptionExcerpt?.state === 'PRESENT' && item.descriptionExcerpt.value !== item.title.value && <p className="cr-excerpt"><Value value={item.descriptionExcerpt} /></p>}
                      </td>
                      <td data-label="Estado do aviso">
                        <CatalogStatus status={item.status} />
                        <small>
                          {item.quality.flags
                            .map((f) => labels[f] || f)
                            .join(' · ')}
                        </small>
                      </td>
                      {interestOrganization && <td data-label="Estado da candidatura"><ApplicationStatusCell id={item.id} /></td>}
                      <td data-label="Programa">
                        {item.programmes.items
                          .map((v) => v.label)
                          .join(' · ') || 'Não indicado'}
                      </td>
                      <td data-label="Tipificação"><PresentationText field={item.presentation?.typification} fallback={labels[item.kind] || 'Não indicada'} /></td>
                      <td data-label="Áreas"><PresentationText field={item.presentation?.areas} /></td>
                      <td data-label="Financiamento">
                        {item.funding?.state === 'UNSUPPORTED' ? 'Consultar detalhe do financiamento' : <Value value={item.funding} />}
                        <small>{item.fundingLabel}</small>
                      </td>
                      <td data-label="Prazo">
                        {item.deadline.label}
                        {item.deadline.at && (
                          <small>
                            <Value value={item.deadline.at} />
                          </small>
                        )}
                        <small>{item.deadline.scopeLabel}</small>
                        <small>
                          Abertura: <Value value={item.opening} />
                        </small>
                      </td>
                      <td data-label="Ações">
                        <Link
                          aria-label={`Abrir ${item.title.value || 'oportunidade'}`}
                          to={`${basePath}/${item.id}?${query}`}
                        >
                          Abrir ficha →
                        </Link>
                        {interestOrganization && <CatalogInterestButton item={{opportunityId:item.id,title:item.title.value}} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>}
              {!page.data.length && (
                <p>Nenhuma oportunidade corresponde aos filtros aplicados.</p>
              )}
              <nav className="cr-pages" aria-label="Paginação">
                <button
                  disabled={state.busy || !state.index}
                  onClick={() => store.previous()}
                >
                  Anterior
                </button>
                <button
                  disabled={state.busy || !page.page.hasMore}
                  onClick={() => store.next()}
                >
                  Seguinte
                </button>
              </nav>
            </>
  )
}
