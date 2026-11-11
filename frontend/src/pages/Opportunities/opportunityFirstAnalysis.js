import { formatCatalogAmount } from './CatalogPresentation'
import { allocationScopes, commonSourceNames, conceptLabels, factStatus, factValue, getOpportunityReadModel, moneyText, opportunityDisplay, safeOpportunityUrl } from './opportunityReadModel'

const unavailable = (fact, fallback) => ['CONFLICT', 'UNSUPPORTED'].includes(fact?.state) ? factStatus(fact) : fallback
const at = value => value ? { precision: value.length === 10 ? 'DATE' : 'INSTANT', value } : null

// Presentation only: a support range or a sum of parcels is never a call budget.
export function firstAnalysisAllocation(record = {}) {
  const model = getOpportunityReadModel(record), flat = record.funding || record.fields || record.snapshot || record
  const fact = model?.projection.financing.allocations
  if (fact) {
    if (['CONFLICT', 'UNSUPPORTED'].includes(fact.state)) return { items: [], label: unavailable(fact), partial: false }
    const items = (factValue(fact) || []).map((value, index) => ({ ...value, key: value.key || `allocation-${index}`, money: value.money || { amount: value.amount, currency: value.currency } }))
    return allocationResult(items, fact.complete === false && fact.state === 'PRESENT',record.central)
  }
  const budget = flat.sourceEnrichment?.schemaVersion === 1 ? flat.sourceEnrichment.fields.budget : null
  if (['CONFLICT', 'UNSUPPORTED'].includes(budget?.status)) return { items: [], label: 'Dotação por confirmar', partial: false }
  return allocationResult(budget?.status === 'PUBLISHED' ? budget.items.map(({ value }, index) => ({ key: `legacy-${index}`, ...value, money: { amount: value.amount, currency: value.currency } })) : [], !!budget?.truncated)
}
function allocationResult(items, partial,formatted=false) {
  const label = items.length > 1 ? `Ver ${items.length} dotações` : items.length === 1 ? allocationLabel(items[0],formatted) : 'Não indicada'
  return { items, label: partial ? `${label} · informação parcial` : label, partial }
}
export function allocationLabel(value,formatted=false) {
  const scope = ['CALL_TOTAL', 'CALL'].includes(value.scope) ? '' : `${allocationScopes[value.scope] || 'Âmbito por confirmar'}: `
  return `${scope}${(formatted?formatCatalogAmount(value.money.amount,value.money.currency):moneyText(value.money.amount, value.money.currency))}${value.basis === 'PLANNED' ? ' · prevista' : ''}`
}
export function firstAnalysis(record = {}) {
  const model = getOpportunityReadModel(record), flat = record.fields || record.snapshot || record
  const display = opportunityDisplay({ ...record, snapshot: flat })
  const p = model?.projection, modern = model?.sourceVersion === 2
  const enrichment = flat.sourceEnrichment || record.funding?.sourceEnrichment
  const programme = enrichment?.schemaVersion === 1 ? enrichment.fields.programme : null
  const programmes = model ? conceptLabels(p.programmes) : programme ? programme.status === 'PUBLISHED' ? programme.items.map(item => item.value.label).filter(Boolean) : [] : flat.programmeName ? [flat.programmeName] : []
  const description = record.catalogPresentation?.description?.value || (modern ? factValue(p.description.summary) : flat.summary || record.funding?.summary || factValue(p?.description.summary))
  const title = modern ? display.title : flat.title || display.title
  const deadlines = modern ? factValue(p.schedule.deadlines) || [] : (flat.sourceTemporal?.deadlines || []).map((value, index) => ({ key: `legacy-${index}`, at: at(value) }))
  const deadlineValue = display.deadline?.value
  const matchingDeadlines = deadlines.filter(value => value.at.value.slice(0, 10) === deadlineValue?.slice(0, 10))
  const deadline = model ? display.deadline : record.temporal?.nextDeadline ? at(record.temporal.nextDeadline) : (matchingDeadlines.length === 1 ? matchingDeadlines[0].at : null) || display.deadline || (deadlines.length === 1 ? deadlines[0].at : null)
  const modelSources = model?.sourceRecords?.map(source => source.namespace) || []
  const namespaces = [...new Set(modelSources.length ? modelSources : [record.source].filter(Boolean))]
  return { ...display, title, deadline, opening: display.opening, deadlines, programmes,
    programmeFallback: unavailable(p?.programmes, ['CONFLICT', 'UNSUPPORTED'].includes(programme?.status) ? 'Programa por confirmar' : 'Não indicado'),
    description: description && description.trim() !== title?.trim() ? description : null,
    descriptionFallback: unavailable(p?.description.summary, display.officialUrl ? 'Consultar a descrição na fonte oficial.' : 'Descrição não disponível neste registo.'),
    openingFallback: unavailable(p?.schedule?.[display.deadlineKind === 'PLANNED' ? 'plannedOpening' : 'opening'], 'Não indicada'),
    deadlineFallback: unavailable(p?.schedule?.[display.deadlineKind === 'PLANNED' ? 'plannedClosing' : 'deadlines'], 'Não indicado'),
    officialUrl: (modern ? display.officialUrl : safeOpportunityUrl(flat.officialUrl)) || display.officialUrl ||
      model?.sourceRecords?.map(source => safeOpportunityUrl(source.url)).find(Boolean) ||
      safeOpportunityUrl(record.catalogPresentation?.description?.sourceUrl) ||
      (namespaces.includes('PORTUGAL2030_PLAN') ? 'https://portugal2030.pt/plano-anual-de-avisos/' : null),
    allocation: firstAnalysisAllocation(record), sources: [...new Set(namespaces.filter(source => source !== 'C4G_MANUAL').map(source => commonSourceNames[source] || 'Fonte publicada'))],
    eu: namespaces.includes('EU_FUNDING_TENDERS'), sourceReview: record.sourceReview || model?.freshness?.sourceReview,
    manualConflict: (record.validationState || flat.validationState) === 'CONFLICT',
    documentConflict: model?.quality?.issues?.some(issue => issue.code === 'OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW'),
    temporalState: display.temporalState || record.temporal?.state || flat.sourceTemporal?.status,
  }
}
