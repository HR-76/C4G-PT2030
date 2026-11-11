import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import './OpportunityEnrichment.css'

const labels = {
  programme: 'Programa publicado', instrument: 'Instrumento', budget: 'Orçamento publicado',
  support: 'Apoio por candidatura', rate: 'Taxa de financiamento', territories: 'Territórios',
  beneficiaries: 'Beneficiários', consortium: 'Consórcio', conditions: 'Condições publicadas',
  documents: 'Documentos', submission: 'Submissão',
}
const statusLabels = {
  NOT_FOUND: 'Não identificado nos dados recolhidos.',
  CONFLICT: 'Informação divergente entre versões da fonte — requer revisão.',
  UNSUPPORTED: 'Informação não interpretada com segurança.',
}
const scopeLabel = scope => scope === 'CALL' ? 'Orçamento do aviso' : 'Orçamento do tema ou partilhado'
// Formatting operates on the decimal string, preserving all published digits.
function decimal(value) {
  const [integer, fraction] = value.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (fraction === undefined ? '' : `,${fraction}`)
}
const currencyLabel = currency => currency ? ` ${currency}` : ' · moeda não indicada'
const money = (amount, currency) => decimal(amount) + currencyLabel(currency)
function supportLabel(value) {
  const amount = value.minimum == null ? `Até ${decimal(value.maximum)}` : value.maximum == null ? `A partir de ${decimal(value.minimum)}`
    : value.minimum === value.maximum ? decimal(value.minimum) : `${decimal(value.minimum)} – ${decimal(value.maximum)}`
  return `${amount}${currencyLabel(value.currency)} por candidatura`
}
export function enrichmentFunding(enrichment) {
  if (!enrichment) return null
  if (enrichment.schemaVersion !== 1) return { kind: 'enrichment', label: 'Financiamento por confirmar' }
  const { budget, support } = enrichment.fields
  if ([budget, support].some(field => field.status === 'CONFLICT' || field.status === 'UNSUPPORTED')) return { kind: 'enrichment', label: 'Financiamento por confirmar' }
  if ([budget, support].some(field => field.truncated) || budget.items.length > 1 || support.items.length > 1) return { kind: 'enrichment', label: 'Ver financiamento' }
  if (budget.items.length === 1) {
    const value = budget.items[0].value
    return { kind: 'enrichment', label: `${scopeLabel(value.scope)}: ${money(value.amount, value.currency)}${value.period ? ` · ${value.period}` : ''}` }
  }
  if (support.items.length === 1) return { kind: 'enrichment', label: supportLabel(support.items[0].value) }
  return { kind: 'enrichment', label: 'Valores não identificados' }
}
export function enrichmentProgramme(enrichment, fallback) {
  if (!enrichment) return fallback
  const field = enrichment.schemaVersion === 1 ? enrichment.fields.programme : null
  return field?.status === 'PUBLISHED' && field.items.length === 1 && !field.truncated ? field.items[0].value.label : 'Por identificar'
}
function safeLink(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || /[\u0000-\u0020]/.test(value)) return null
    if ([...url.searchParams.keys()].some(key => /token|secret|password|authorization|credential|signature|api[-_]?key|access[-_]?key/i.test(key))) return null
    return url.href
  } catch { return null }
}
function PublishedLink({ url, children }) {
  const href = safeLink(url)
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children} <small>(ligação indisponível)</small></span>
}
function Evidence({ evidence, label }) {
  const href = safeLink(evidence.url)
  return <details className="enrichment-evidence">
    <summary>Ver fonte: {label}</summary>
    <dl>
      <dt>Fonte</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{new URL(href).hostname}</a> : 'Ligação indisponível'}</dd>
      <dt>Localização</dt><dd>{evidence.locator}</dd>
      <dt>Excerto publicado</dt><dd className="enrichment-text">{evidence.excerpt}</dd>
      <dt>Recolhido em</dt><dd><time dateTime={evidence.observedAt}>{new Date(evidence.observedAt).toLocaleString('pt-PT', { timeZone: 'UTC' })} UTC</time></dd>
    </dl>
  </details>
}
function Value({ name, value }) {
  if (name === 'budget') return <>
    <p className="enrichment-amount">{money(value.amount, value.currency)}</p>
    <p>{scopeLabel(value.scope)}</p>{value.period && <p>{value.period}</p>}
    {value.action && <p className="enrichment-context">{value.action}</p>}
  </>
  if (name === 'support') return <><p className="enrichment-amount">{supportLabel(value)}</p>{value.action && <p className="enrichment-context">{value.action}</p>}</>
  if (name === 'programme') return <p>{value.label}</p>
  if (name === 'documents' || name === 'submission') return <p><PublishedLink url={value.url}>{value.title}</PublishedLink></p>
  return <p className="enrichment-text">{value.text}</p>
}
function EnrichedField({ name, field }) {
  return <div className="dl-row">
    <dt>{labels[name]}</dt>
    <dd>
      {name === 'programme' && field.status !== 'PUBLISHED' && <p className="enrichment-warning">Programa por identificar.</p>}
      {statusLabels[field.status] && <p className={field.status === 'NOT_FOUND' ? 'text-muted' : 'enrichment-warning'}>{statusLabels[field.status]}</p>}
      {field.truncated && <p className="enrichment-warning">Informação parcial: consulte a fonte para o conteúdo completo.</p>}
      {field.items.length > 0 && <ul className="enrichment-items">{field.items.map((item, index) => <li key={index}>
        <Value name={name} value={item.value} />
        <Evidence evidence={item.evidence} label={labels[name]} />
      </li>)}</ul>}
      {name === 'submission' && field.items.length > 0 && <p className="enrichment-context">Disponibilidade para submissão não confirmada. A ligação não confirma abertura.</p>}
    </dd>
  </div>
}
export default function OpportunityEnrichment({ enrichment, sourceReview, showUncollected = false }) {
  const finance = useRef(null), { hash } = useLocation()
  useEffect(() => {
    if (hash === '#financiamento-oportunidade') { finance.current?.scrollIntoView?.(); finance.current?.focus({ preventScroll: true }) }
  }, [hash, enrichment])
  if (!enrichment) return showUncollected ? <p className="enrichment-uncollected text-muted">Informação adicional ainda não recolhida.</p> : null
  if (enrichment.schemaVersion !== 1) return <p className="enrichment-warning">Informação adicional não disponível nesta versão.</p>
  const fields = enrichment.fields
  return <>
    {sourceReview != null && <p className="alert alert-warn" role="status">Os dados adicionais preservados requerem nova revisão da fonte.</p>}
    <section className="detail-section opportunity-enrichment" aria-label="Classificação publicada">
      <h2 className="opportunity-section-title">Classificação publicada</h2>
      <dl className="dl-list">{['programme', 'instrument'].map(name => <EnrichedField key={name} name={name} field={fields[name]} />)}</dl>
    </section>
    <section ref={finance} id="financiamento-oportunidade" tabIndex={-1} className="detail-section opportunity-enrichment" aria-label="Financiamento publicado">
      <h2 className="opportunity-section-title">Financiamento publicado</h2>
      <dl className="dl-list">{['budget', 'support', 'rate'].map(name => <EnrichedField key={name} name={name} field={fields[name]} />)}</dl>
    </section>
    <section className="detail-section opportunity-enrichment" aria-label="Condições de participação">
      <h2 className="opportunity-section-title">Condições de participação</h2>
      <p className="enrichment-context">Informação publicada pela fonte; não confirma a elegibilidade nem os critérios da organização.</p>
      <dl className="dl-list">{['territories', 'beneficiaries', 'consortium', 'conditions'].map(name => <EnrichedField key={name} name={name} field={fields[name]} />)}</dl>
    </section>
    <section className="detail-section opportunity-enrichment" aria-label="Documentos e submissão">
      <h2 className="opportunity-section-title">Documentos e submissão</h2>
      <dl className="dl-list">{['documents', 'submission'].map(name => <EnrichedField key={name} name={name} field={fields[name]} />)}</dl>
    </section>
  </>
}
