import InterventionAreas from './InterventionAreas'
import { OpportunityStatus, PresentationText, formatCatalogAmount } from './CatalogPresentation'
import { CHIP } from '../Applications/lifecycle'
import './CatalogApplicationStatuses.css'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { applicationStatusLabels } from '../../utils/applicationStatuses'
import { enrichmentFunding } from './OpportunityEnrichment'
import OpportunityReadModelOverview from './OpportunityReadModelView'
import { allocationScopes, commonFunding, formatOpportunityTemporal, getOpportunityReadModel } from './opportunityReadModel'
import { firstAnalysis } from './opportunityFirstAnalysis'
import './OpportunityPresentation.css'
import { useCatalogInterests } from '../Interests/CatalogInterests'

export const recordStates = { ACTIVE: 'Ativa no catálogo', DRAFT: 'Rascunho', STALE: 'A rever', ARCHIVED: 'Arquivada' }
export const opportunityDate = value => value ? new Date(value.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('pt-PT', { timeZone: 'UTC' }) : 'Não indicado'
export function opportunityAmount(fields) {
  if (!fields.currencyCode || fields.fundingAmountMin == null || fields.fundingAmountMax == null) return 'Não indicado'
  return fields.fundingAmountMin === fields.fundingAmountMax ? `${fields.fundingAmountMin} ${fields.currencyCode}` : `${fields.fundingAmountMin} – ${fields.fundingAmountMax} ${fields.currencyCode}`
}
// Compatibility helper for historical consumers; the first-analysis view uses
// only typed allocations, never these unscoped ranges or textual mentions.
export function opportunityFunding(fields = {}) {
  const model = getOpportunityReadModel(fields)
  if (model) return commonFunding(model)
  const enriched = enrichmentFunding(fields.sourceEnrichment)
  if (enriched) return enriched
  if (fields.currencyCode && fields.fundingAmountMin != null && fields.fundingAmountMax != null) return { kind: 'amount', label: opportunityAmount(fields) }
  const mentions = /(?:[€$£]\s*\d|\b(?:EUR|USD|GBP)\s*\d|\d[\d\s.,]*\s*(?:%|[€$£]|\b(?:EUR|USD|GBP|euros?|dollars?|pounds?)\b))/i
  return mentions.test(fields.summary || '') ? { kind: 'description', label: 'Valores na descrição' } : { kind: 'unknown', label: 'Montante não identificado' }
}
function ApplicationSummary({ summary, state, item }) {
  if (state !== 'ready' || !summary) return <span className="text-muted">{state === 'loading' ? 'A consultar…' : 'Indisponível'}</span>
  if (!summary.count) return <span className="text-muted">Sem candidaturas visíveis</span>
  const statuses = Object.entries(summary.statuses).map(([status, count]) => `${summary.count > 1 ? `${count} ` : ''}${applicationStatusLabels[status]}`).join(' · ')
  return summary.count === 1 ? <Link className={`chip ${CHIP[Object.keys(summary.statuses)[0]] || 'chip-grey'}`} to={`/candidaturas/${summary.applicationId}`} aria-label={`${statuses} — candidatura de ${item.title}`}>{statuses}</Link> : <div><Link to={`/candidaturas?oportunidade=${item.opportunityId}`}>{summary.count} candidaturas</Link><div className="cr-application-status-badges">{Object.entries(summary.statuses).map(([status,count])=><span key={status} className={`chip ${CHIP[status] || 'chip-grey'}`}>{count} {applicationStatusLabels[status]}</span>)}</div></div>
}
function CatalogAllocation({ allocation }) {
  if (allocation.items.length !== 1) return allocation.label
  const [item] = allocation.items
  const notes = [allocationScopes[item.scope] || 'Âmbito por confirmar', item.basis === 'PLANNED' && 'prevista', allocation.partial && 'informação parcial'].filter(Boolean)
  return <><strong className="catalog-amount">{formatCatalogAmount(item.money.amount, item.money.currency)}</strong><small className="catalog-amount-note">{notes.join(' · ')}</small></>
}

function SortHeading({field, label, sort, onSort, hidden}) {
  const ascending = sort === field + '_asc'
  const descending = sort === field + '_desc'
  const next = ascending ? 'desc' : descending ? 'asc' : field === 'amount' ? 'desc' : 'asc'
  return <th role="columnheader" scope="col" aria-label={label} hidden={hidden} aria-sort={ascending ? 'ascending' : descending ? 'descending' : undefined}>
    {onSort ? <button type="button" className="catalog-sort-button" data-active={ascending || descending || undefined} title={ascending ? 'Ordenado por ordem crescente' : descending ? 'Ordenado por ordem decrescente' : 'Ordenar'} onClick={() => onSort(field + '_' + next)}>{label}{ascending ? <ArrowUp size={14} aria-hidden="true"/> : descending ? <ArrowDown size={14} aria-hidden="true"/> : <ArrowUpDown size={14} aria-hidden="true"/>}</button> : label}
  </th>
}

export function OpportunityTable({ items, sort, onSort, visibleColumns = null, central = false, search = '', summaries = {}, summaryState = 'loading', showApplications = true, renderApplicationAction, applicationsLabel = 'Candidaturas', interestOnly = false }) {
  const hiddenColumn = key => visibleColumns !== null && !visibleColumns.includes(key)
  const interests = useCatalogInterests()
  const root = central ? '/catalogo' : '/oportunidades', displayed = items.map(item => ({ item, data: firstAnalysis({...item,central}) }))
  return <>
    <div className="table-wrap opportunity-table-wrap" role="region" aria-label="Tabela de oportunidades" tabIndex={0}><table role="table" className={`data-table mobile-card-table opportunities-mobile-table opportunity-analysis-table${central ? ' habitual-catalog-table' : ''}`}>
      <caption className="sr-only">{central ? 'Oportunidades do catálogo C4G' : 'Oportunidades privadas'}</caption>
      <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Oportunidade</th>{central && <><th role="columnheader" scope="col" hidden={hiddenColumn('estado') }>Estado do aviso</th><th role="columnheader" scope="col" hidden={hiddenColumn('tipo') }>Tipificação</th></>}<th role="columnheader" scope="col" hidden={hiddenColumn('abertura') }>Abertura</th><SortHeading field="closing" label="Fecho" sort={sort} onSort={onSort} hidden={hiddenColumn('fecho')}/>{central && <th role="columnheader" scope="col" hidden={hiddenColumn('areas') }>Áreas de intervenção</th>}<SortHeading field="amount" label="Dotação da call" sort={sort} onSort={onSort} hidden={hiddenColumn('dotacao')}/>{!central && <th role="columnheader" scope="col">Descrição da call</th>}<th role="columnheader" scope="col" hidden={hiddenColumn('programa') }>Programa financiador</th>{showApplications && <th role="columnheader" scope="col" hidden={hiddenColumn('interesse')}>{applicationsLabel}</th>}</tr></thead>
      <tbody role="rowgroup">{displayed.map(({ item, data }) => {
        const href = `${root}/${item.opportunityId}${search}`
        const registered = interestOnly && interests?.state === 'ready' && interests.summaries[item.opportunityId]?.interestId && interests.summaries[item.opportunityId]?.status === 'ACTIVE'
        return <tr role="row" key={item.opportunityId} className={registered ? 'catalog-interest-registered' : undefined}>
          <td role="cell" data-label="Oportunidade" className="col-title"><div className="opportunity-cell-content"><Link className="link-cell" to={href}>{data.title}</Link>{data.callReference && <small className="opportunity-reference">{data.callReference}</small>}{central && data.programmes.length > 0 && <small className="catalog-summary-programme">{data.programmes.join(" · ")}</small>}{data.sourceReview && <small className="enrichment-warning">Fonte em revisão</small>}{data.manualConflict && <small className="enrichment-warning">Divergência com correções manuais</small>}{data.documentConflict && <small className="enrichment-warning">Prazos divergentes — confirmar</small>}{data.officialUrl && <a className="opportunity-official-link" href={data.officialUrl} target="_blank" rel="noopener noreferrer" aria-label={`Consultar fonte oficial de ${data.title}`}>Consultar fonte oficial ↗</a>}</div></td>
          {central && <><td role="cell" hidden={hiddenColumn('estado')} data-label="Estado do aviso"><OpportunityStatus state={data.temporalState}/></td>
          <td role="cell" hidden={hiddenColumn('tipo')} data-label="Tipificação"><PresentationText field={item.catalogPresentation?.presentation?.typification}/></td></>}
          <td role="cell" hidden={hiddenColumn('abertura')} data-label="Abertura"><div className="opportunity-cell-content">{data.opening ? formatOpportunityTemporal(data.opening, { time: false }) : data.openingFallback}{data.deadlineKind === 'PLANNED' && <small className="opportunity-source">Previsão</small>}</div></td>
          <td role="cell" hidden={hiddenColumn('fecho')} data-label="Fecho"><div className="opportunity-cell-content">{data.deadlineAmbiguous ? 'Vários prazos — consultar' : data.deadline ? formatOpportunityTemporal(data.deadline, { time: false }) : data.deadlineFallback}{data.deadlineKind === 'PLANNED' && <small className="opportunity-source">Previsão</small>}{data.deadlines.length > 1 && <small className="opportunity-source">Várias rondas</small>}{['CLOSED', 'CANCELLED'].includes(data.temporalState) && <small className="opportunity-source">{data.temporalState === 'CLOSED' ? 'Encerrada' : 'Cancelada'}</small>}</div></td>
          {central && <td role="cell" hidden={hiddenColumn('areas')} data-label="Áreas de intervenção"><InterventionAreas classification={item.interventionClassification}/></td>}
          <td role="cell" hidden={hiddenColumn('dotacao')} data-label="Dotação da call"><div className="opportunity-cell-content">{data.allocation.items.length ? <Link to={`${href}#financiamento-oportunidade`}>{central ? <CatalogAllocation allocation={data.allocation} /> : data.allocation.label}</Link> : data.allocation.label}</div></td>
          {!central && <td role="cell" data-label="Descrição da call"><div className="opportunity-cell-content"><p className="opportunity-summary">{data.description ? data.description.length > 180 ? `${data.description.slice(0, 180)}…` : data.description : data.descriptionFallback}</p>{data.description?.length > 180 && <Link to={`${href}#descricao-oportunidade`}>Ler descrição</Link>}</div></td>}
          <td role="cell" hidden={hiddenColumn('programa')} data-label="Programa financiador"><div className="opportunity-cell-content">{data.programmes.join(' · ') || data.programmeFallback}</div></td>
          {showApplications && <td role="cell" hidden={hiddenColumn('interesse')} data-label={applicationsLabel}><div className="opportunity-cell-content">{!interestOnly && <ApplicationSummary item={{ ...item, title: data.title }} summary={summaries[item.opportunityId]} state={summaryState} />}{renderApplicationAction?.({ ...item, title: data.title })}</div></td>}
        </tr>
      })}</tbody>
    </table></div>
    {displayed.some(({ data }) => data.eu) && <p className="opportunity-attribution">Fonte: EU Funding &amp; Tenders. Dados resumidos e formatados pela C4G. <a href="https://commission.europa.eu/legal-notice_en" target="_blank" rel="noopener noreferrer">Condições de reutilização</a></p>}
  </>
}
export function OpportunityOverview(props) { return <OpportunityReadModelOverview {...props} /> }
