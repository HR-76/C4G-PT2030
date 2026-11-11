// Presentation of the server's common read contract. No provider parsing,
// eligibility inference, monetary arithmetic or client-side temporal decisions.
export const READ_MODEL_VERSION = 'opportunity-read-v2.0'
export const commonTemporalLabels = { OPEN: 'Aberta', PLANNED: 'Planeada', UPCOMING: 'Por abrir', CLOSED: 'Encerrada', CANCELLED: 'Cancelada', UNKNOWN: 'Por confirmar' }
export const commonSourceNames = { C4G_MANUAL: 'Registo manual C4G', EU_FUNDING_TENDERS: 'EU Funding & Tenders', PORTUGAL2030_PLAN: 'Portugal 2030', PORTUGAL2030_NOTICE: 'Portugal 2030', INTERREG_EUROPE: 'Interreg Europe', POCTEP: 'Interreg POCTEP', MULTIPLE_SOURCES: 'Várias fontes' }
export const factValue = fact => fact?.state === 'PRESENT' ? fact.value : null
export const factStatus = fact => ({ NOT_FOUND: 'Não encontrado na fonte', NOT_COLLECTED: 'Não recolhido', NOT_APPLICABLE: 'Não aplicável', CONFLICT: 'Informação divergente — requer revisão', UNSUPPORTED: 'Informação não interpretada com segurança' })[fact?.state] || 'Não indicado'
export const getOpportunityReadModel = record => record?.readModel?.version === READ_MODEL_VERSION && [1, 2].includes(record.readModel.sourceVersion) ? record.readModel : null
export const conceptLabels = fact => (factValue(fact) || []).map(value => typeof value === 'string' ? value : value.label || value.text || '').filter(Boolean)
export function exactDecimal(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return 'Não indicado'
  const [integer, fraction] = value.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (fraction === undefined ? '' : `,${fraction}`)
}
export function currencyText(currency) {
  const code = typeof currency === 'string' ? currency : factValue(currency)
  if (code) return ` ${code}`
  return ({ CONFLICT: ' · moeda divergente — requer revisão', UNSUPPORTED: ' · moeda não interpretada com segurança', NOT_COLLECTED: ' · moeda não recolhida', NOT_APPLICABLE: ' · moeda não aplicável' })[currency?.state] || ' · moeda não indicada'
}
export const moneyText = (amount, currency) => exactDecimal(amount) + currencyText(currency)
export function rangeText(minimum, maximum) {
  return minimum == null ? `Até ${exactDecimal(maximum)}` : maximum == null ? `A partir de ${exactDecimal(minimum)}` : minimum === maximum ? exactDecimal(minimum) : `${exactDecimal(minimum)} – ${exactDecimal(maximum)}`
}
export const supportUnits = { PER_PROJECT: 'por candidatura', PER_PERSON: 'por pessoa', PER_MONTH: 'por mês', PER_PERSON_MONTH: 'por pessoa e mês', OTHER: 'unidade indicada nas condições' }
export const allocationScopes = { CALL_TOTAL: 'Dotação da chamada', FUND_ALLOCATION: 'Dotação do fundo', TOPIC_OR_SHARED: 'Dotação do tema ou partilhada', CALL: 'Orçamento do aviso', TOPIC: 'Orçamento do tema ou partilhado' }
export function commonFunding(model) {
  if (!model?.projection) return null
  const { allocations, support } = model.projection.financing
  if ([allocations, support].some(fact => ['CONFLICT', 'UNSUPPORTED'].includes(fact?.state))) return { kind: 'enrichment', label: 'Financiamento por confirmar' }
  const budgets = factValue(allocations) || [], supports = factValue(support) || []
  if (allocations?.complete === false && allocations?.state === 'PRESENT' || support?.complete === false && support?.state === 'PRESENT') return { kind: 'enrichment', label: 'Ver financiamento parcial' }
  if (budgets.length > 1) return { kind: 'enrichment', label: `Ver ${budgets.length} dotações` }
  if (budgets.length === 1) {
    const value = budgets[0], money = value.money || value
    return { kind: 'enrichment', label: `${allocationScopes[value.scope] || 'Dotação'}: ${moneyText(money.amount, money.currency)}${value.basis === 'PLANNED' ? ' · prevista' : ''}` }
  }
  if (supports.length > 1) return { kind: 'enrichment', label: 'Ver apoios por candidatura' }
  if (supports.length === 1) {
    const value = supports[0]
    return { kind: 'enrichment', label: `${rangeText(value.minimum, value.maximum)}${currencyText(value.currency)} ${supportUnits[value.unit] || 'por candidatura'}` }
  }
  const range = factValue(model.projection.legacy?.fundingRange)
  if (range) return { kind: 'amount', label: `${rangeText(range.minimum, range.maximum)}${currencyText(range.currency)}` }
  return { kind: 'enrichment', label: factStatus(allocations) }
}
const civilText = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : 'Não indicado'
export function formatOpportunityTemporal(at, { time = true } = {}) {
  if (!at) return 'Não indicado'
  if (at.precision === 'PERIOD') return `${at.label || 'Período'}${at.start && at.end ? ` · ${civilText(at.start)} – ${civilText(at.end)}` : ''}`
  if (at.precision === 'DATE') return civilText(at.value) + (time ? ' · hora não indicada' : '')
  if (at.precision === 'INSTANT' && typeof at.value === 'string') {
    const suffix = at.value.endsWith('Z') ? 'UTC' : `UTC${at.value.match(/[+-]\d{2}:?\d{2}$/)?.[0] || ''}`
    return `${civilText(at.value.slice(0, 10))}${time ? ` às ${at.value.slice(11, 19)} ${suffix}` : ''}`
  }
  return 'Não indicado'
}
export function safeOpportunityUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || /[\u0000-\u0020]/.test(value)) return null
    if ([...url.searchParams.keys()].some(key => /token|secret|password|authorization|credential|signature|api[-_]?key|access[-_]?key/i.test(key))) return null
    return url.href
  } catch { return null }
}
export function opportunityDisplay(record = {}) {
  const model = getOpportunityReadModel(record), flat = record.snapshot || record
  if (!model) return { title: flat.title || record.title || '', programmeName: flat.programmeName || record.programmeName || '', callReference: flat.callReference || record.callReference || record.externalIdentifier || '', source: record.source,
    opening: flat.openingDate ? { precision: 'DATE', value: flat.openingDate } : null,
    deadline: record.temporal?.nextDeadline || flat.closingDate ? { precision: 'DATE', value: (record.temporal?.nextDeadline || flat.closingDate).slice(0, 10) } : null,
    deadlineKind: 'LEGACY', deadlineAmbiguous: false, temporalState: record.temporal?.state || null, officialUrl: safeOpportunityUrl(flat.officialUrl || record.officialUrl) }
  const p = model.projection, planned = factValue(p.publication) === 'PLANNED', temporal = model.temporal || {}
  const refs = factValue(model.identity?.references) || []
  const openingValue = factValue(planned ? p.schedule.plannedOpening : p.schedule.opening)
  const legacyOpening = factValue(p.legacy?.openingDate)
  const opening = typeof openingValue === 'object' && !Array.isArray(openingValue) ? openingValue : legacyOpening ? { precision: 'DATE', value: legacyOpening } : null
  const ambiguous = !planned && !temporal.nextDeadline && (temporal.nextDeadlineCandidates || []).length > 1
  const legacyClosing = factValue(p.legacy?.closingDate)
  const deadline = planned ? factValue(p.schedule.plannedClosing) : ambiguous ? null : temporal.nextDeadline?.at || temporal.finalDeadline?.at || (legacyClosing ? { precision: 'DATE', value: legacyClosing } : null)
  const namespaces = [...new Set((model.sourceRecords || []).map(source => source.namespace))]
  const source = namespaces.length > 1 ? 'MULTIPLE_SOURCES' : namespaces[0] || record.source
  return { title: factValue(p.description.title) || '', programmeName: conceptLabels(p.programmes).join(' · '), callReference: refs.map(ref => ref.kind === 'PLAN_ID' ? `ID do plano ${ref.value}` : ref.value).join(' · ') || factValue(p.legacy?.callReference) || record.externalIdentifier || '',
    source, opening, deadline, deadlineKind: planned ? 'PLANNED' : model.sourceVersion === 1 && legacyClosing && !temporal.finalDeadline ? 'LEGACY' : 'CONFIRMED', deadlineAmbiguous: ambiguous,
    temporalState: temporal.effectiveState || 'UNKNOWN', officialUrl: safeOpportunityUrl(factValue(p.links.official)) }
}
function csvCell(value) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const safe = /^[\s\uFEFF]*[=+\-@\t\r]/.test(text) ? "'" + text : text
  return '"' + safe.replaceAll('"', '""') + '"'
}
export function opportunityPageCsv(items) {
  const columns = ['ID', 'Revisão', 'Versão dos dados', 'Título', 'Referências', 'Programas', 'Fonte', 'Estado temporal', 'Calendário', 'Financiamento', 'Projeto associado', 'Descrição', 'Fundos', 'Entidades', 'Classificação', 'Publicação', 'Estado publicado', 'Elegibilidade', 'Modalidades', 'Ligações', 'Qualidade', 'Informação histórica', 'Áreas de intervenção C4G']
  const rows = items.map(item => {
    const model = getOpportunityReadModel(item), display = opportunityDisplay(item), flat = item.funding || item.snapshot || item
    return [item.opportunityId, model?.revisionId || item.revisionId, model?.sourceVersion || 1, display.title, model?.identity.references || display.callReference,
      model?.projection.programmes || display.programmeName, model?.sourceRecords || display.source, display.temporalState,
      model?.projection.schedule || { openingDate: flat.openingDate || null, closingDate: flat.closingDate || null, sourceTemporal: flat.sourceTemporal || null },
      model?.projection.financing || { fundingAmountMin: flat.fundingAmountMin ?? null, fundingAmountMax: flat.fundingAmountMax ?? null, currencyCode: flat.currencyCode || null, sourceEnrichment: flat.sourceEnrichment || null }, model?.projection.relatedProject || null,
      model?.projection.description || flat.summary || null, model?.projection.funds || null, model?.projection.parties || flat.funderName || null,
      model?.projection.classification || null, model?.projection.publication || null, model?.projection.status || flat.sourceTemporal?.status || null,
      model?.projection.eligibility || flat.eligibilitySummary || null, model?.projection.applicationModes || null, model?.projection.links || flat.officialUrl || null, model?.quality || null, model?.projection.legacy || null, item.interventionClassification || null]
  })
  return [columns, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
}
export function downloadOpportunityPage(items) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + opportunityPageCsv(items)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'oportunidades-pagina.csv'; anchor.click(); URL.revokeObjectURL(url)
}
