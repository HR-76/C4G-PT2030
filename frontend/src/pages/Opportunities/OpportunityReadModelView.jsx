import InterventionAreas from './InterventionAreas'
import { OpportunityStatus, PresentationText } from './CatalogPresentation'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { commonTemporalLabels, formatOpportunityTemporal, safeOpportunityUrl } from './opportunityReadModel'
import { allocationLabel, firstAnalysis } from './opportunityFirstAnalysis'
import ManualCallInformation from './ManualCallInformation'
import './OpportunityEnrichment.css'

function Field({ label, children }) { return <div className="dl-row"><dt>{label}</dt><dd>{children}</dd></div> }
function Temporal({ at, fallback = 'Não indicado' }) {
  return !at ? <span>{fallback}</span> : at.precision === 'PERIOD' ? <span>{formatOpportunityTemporal(at)}</span> : <time dateTime={at.value}>{formatOpportunityTemporal(at)}</time>
}
function SourceResolution({ resolution, sourceReview }) {
  if (resolution?.schemaVersion !== 1) return null
  return <section className="detail-section" aria-label="Resolução documental">
    <h2 className="opportunity-section-title">Resolução documental</h2>
    {sourceReview && <p role="status" className="alert alert-warn">Resolução anterior — requer nova revisão.</p>}
    <p>{resolution.reason}</p>{resolution.note && <p>{resolution.note}</p>}
    {resolution.decidedAt && <p><Temporal at={{ precision: 'INSTANT', value: resolution.decidedAt }} /></p>}
    {!!resolution.sources?.length && <ul>{resolution.sources.map((source, index) => {
      const href = safeOpportunityUrl(source.url)
      return <li key={index}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}{source.locator && <small className="opportunity-source">{source.locator}</small>}</li>
    })}</ul>}
  </section>
}
export function OpportunityReadModelDetails(props) { return <OpportunityReadModelOverview {...props} compact /> }
export default function OpportunityReadModelOverview({ fields = {}, readModel, source, temporal, sourceReview, reference, lifecycleState, validationState, compact = false, central = false, centralPresentation, interventionClassification, children }) {
  const data = firstAnalysis({ fields, readModel, source, temporal, sourceReview, validationState, central, catalogPresentation:centralPresentation }), planned = data.deadlineKind === 'PLANNED'
  const description = useRef(null), finance = useRef(null), { hash } = useLocation(), [expanded, setExpanded] = useState(hash === '#descricao-oportunidade')
  useEffect(() => {
    setExpanded(hash === '#descricao-oportunidade')
    const target = hash === '#descricao-oportunidade' ? description.current : hash === '#financiamento-oportunidade' ? finance.current : null
    target?.scrollIntoView?.(); target?.focus({ preventScroll: true })
  }, [hash, readModel?.revisionId, fields.summary])
  const status = commonTemporalLabels[data.temporalState]
  return <div className="opportunity-overview opportunity-first-analysis">
    {!compact && <header className="opportunity-overview-header">
      <h1 className="detail-title">{data.title}</h1>
      <div className="opportunity-badges"><span className="opportunity-reference">{data.callReference || reference || 'Código não indicado'}</span>{central ? <OpportunityStatus state={data.temporalState}/> : status && <OpportunityStatus state={data.temporalState} label={status}/>}{(lifecycleState || fields.lifecycleState) === 'ARCHIVED' && <span className="chip chip-grey">Arquivada</span>}</div>
      <p className="opportunity-priority-date"><span>{planned ? "Fecho previsto" : "Fecho"}</span><strong>{data.deadlineAmbiguous ? "Vários prazos — consultar a fonte" : <Temporal at={data.deadline} fallback={data.deadlineFallback}/>}</strong>{data.deadlines.length > 1 && <small>{readModel?.temporal?.nextDeadline || temporal?.nextDeadline ? "Próxima ronda" : "Último prazo publicado"}</small>}</p>
      <div className="detail-actions opportunity-detail-actions">{data.officialUrl ? <a className="btn btn-outline btn-sm" href={data.officialUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Consultar fonte oficial</a> : <span>Fonte oficial sem ligação indicada</span>}{children}</div>
    </header>}
    {data.documentConflict && <p role="status" className="alert alert-warn">Os documentos oficiais apresentam horários divergentes. Confirme os prazos na fonte.</p>}
    {data.sourceReview && <p role="status" className="alert alert-warn">A fonte requer nova revisão. Os dados anteriores foram preservados.</p>}
    {data.manualConflict && <p role="status" className="alert alert-warn">Divergência com correções manuais; confirme os dados na fonte.</p>}
    <section className="detail-section" aria-label="Informação da oportunidade">
      <h2 className="opportunity-section-title">Informação da oportunidade</h2>
      <dl className="dl-list">
        {central && <>
          <Field label="Tipificação"><PresentationText field={centralPresentation?.presentation?.typification}/></Field>
          <Field label="Áreas de intervenção"><InterventionAreas classification={interventionClassification} detail/></Field>
          {[['topic','Topic'],['eligibleCandidates','Candidatos elegíveis'],['duration','Duração'],['location','Localização']].map(([key,label])=><Field key={key} label={label}><PresentationText field={centralPresentation?.callInformation?.[key]} fallback="Não indicado nos dados disponíveis"/>{centralPresentation?.callInformation?.[key]?.source==='archived' && <small className="opportunity-source">Informação da fonte arquivada</small>}</Field>)}
        </>}
        <Field label={planned ? 'Abertura prevista' : 'Abertura'}><Temporal at={data.opening} fallback={data.openingFallback} /></Field>
        {compact && <Field label={planned ? 'Fecho previsto' : 'Fecho'}>{data.deadlineAmbiguous ? 'Vários prazos — consultar a fonte' : <Temporal at={data.deadline} fallback={data.deadlineFallback} />}{data.deadlines.length > 1 && <small className="opportunity-source">{readModel?.temporal?.nextDeadline || temporal?.nextDeadline ? 'Próxima ronda' : 'Último prazo publicado'}</small>}</Field>}
        <Field label="Programa financiador">{data.programmes.length ? <ul className="opportunity-programmes">{data.programmes.map((name, index) => <li key={index}>{name}</li>)}</ul> : data.programmeFallback}</Field>
      </dl>
      {planned && <p className="opportunity-source">Datas previstas; a publicação do aviso está por confirmar.</p>}
      {data.deadlines.length > 1 && <details className="opportunity-deadlines"><summary>Ver {data.deadlines.length} prazos publicados</summary><ul>{data.deadlines.map((deadline, index) => <li key={deadline.key || index}><Temporal at={deadline.at} />{deadline.phase && <span> · {deadline.phase}</span>}</li>)}</ul></details>}
    </section>
    <ManualCallInformation fields={fields} source={source} />
    <section ref={finance} id="financiamento-oportunidade" tabIndex={-1} className="detail-section shell-scroll-target" aria-label="Dotação da call">
      <h2 className="opportunity-section-title">Dotação da call</h2>
      {data.allocation.items.length ? <ul className="opportunity-allocations">{data.allocation.items.map((value, index) => <li key={value.key || index} data-allocation={value.key || index}>
        <span className="enrichment-amount">{allocationLabel(value,central)}</span>
        {value.period && <small className="opportunity-source">{value.period}</small>}
        {value.aggregation === 'SHARED' && <small className="opportunity-source">Dotação partilhada</small>}
        {value.aggregation === 'BREAKDOWN' && <small className="opportunity-source">Parcela da dotação; não adicionar ao total</small>}
        {value.money.interpretation === 'ZERO_UNEXPLAINED' && <small className="opportunity-source">Zero publicado; significado por confirmar</small>}
        {value.qualifiers?.length > 0 && <small className="opportunity-source">{value.qualifiers.map(value => ({ INITIAL: 'Dotação inicial', ESTIMATE: 'Estimativa' })[value]).filter(Boolean).join(' · ')}</small>}
      </li>)}</ul> : <p>{data.allocation.label}</p>}
      {data.allocation.partial && <p className="enrichment-warning">Dotação parcial; consulte a fonte.</p>}
    </section>
    <section ref={description} id="descricao-oportunidade" tabIndex={-1} className="detail-section shell-scroll-target" aria-label="Descrição da fonte">
      <h2 className="opportunity-section-title">Descrição da call</h2>
      <p id="opportunity-description-text" className="catalog-description">{data.description ? expanded || data.description.length <= 800 ? data.description : `${data.description.slice(0, 800)}…` : data.descriptionFallback}</p>
      {data.description?.length > 800 && <button className="btn btn-outline btn-sm" aria-expanded={expanded} aria-controls="opportunity-description-text" onClick={() => setExpanded(value => !value)}>{expanded ? 'Recolher descrição' : 'Ler descrição completa'}</button>}
    </section>
    <SourceResolution resolution={fields.sourceResolution} sourceReview={data.sourceReview} />
    {data.sources.length > 0 && <footer className="opportunity-attribution">
      {data.sources.length > 0 && <p>Fonte: {data.sources.join(' · ')}.{data.eu && ' Dados resumidos e formatados pela C4G.'} {data.eu && <a href="https://commission.europa.eu/legal-notice_en" target="_blank" rel="noopener noreferrer">Condições de reutilização</a>}</p>}
    </footer>}
  </div>
}
