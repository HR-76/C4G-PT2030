import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { opportunityDisplay, formatOpportunityTemporal } from '../Opportunities/opportunityReadModel'
import { dateLabel } from './lifecycle'

export function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.3, marginLeft: 3, flexShrink: 0 }} />
  return dir === 'asc'
    ? <ChevronUp size={12} style={{ marginLeft: 3, flexShrink: 0 }} />
    : <ChevronDown size={12} style={{ marginLeft: 3, flexShrink: 0 }} />
}

export function ApplicationsTable({ children, scrollLabel }) {
  return <div className="table-wrap" {...(scrollLabel ? { tabIndex:0, role:'region', 'aria-label':scrollLabel } : {})}><table role="table" className="data-table applications-table mobile-card-table">{children}</table></div>
}

function ValidatedInput({ message, id, onChange, ...props }) {
  const [invalid, setInvalid] = useState(false)
  return <><input {...props} id={id} aria-invalid={invalid || undefined}
    aria-describedby={invalid ? id + '-error' : undefined}
    onInvalid={() => setInvalid(true)}
    onChange={event => {
      if (invalid) setInvalid(!event.target.validity.valid)
      onChange(event)
    }} />
    {invalid && <small id={id + '-error'} className="application-field-error" role="alert">{message}</small>}
  </>
}

export function ApplicationFields({ form, set, disabled = false, extendedDisabled = false, opportunityControl = null, responsibleControl = null, unitControl = null, teamControl = null, grouped = false, deadlineRequired = false, titleLabel = 'Título da candidatura *', deadlineLabel = 'Prazo interno', organizationLabel = 'organização' }) {
  const dataFields = <>
    <div className="field field-full"><label htmlFor="application-title">{titleLabel}</label><ValidatedInput pattern=".*\S.*" message="Introduza um título para a candidatura." id="application-title" maxLength={200} disabled={disabled} type="text" value={form.title} onChange={event => set('title', event.target.value)} placeholder="Ex: Candidatura ao Aviso XYZ — Projeto ABC" required /></div>
    {responsibleControl}
    <div className="field"><label htmlFor="application-deadline">{deadlineLabel}</label><ValidatedInput message="Indique uma data válida para o prazo interno." id="application-deadline" required={deadlineRequired} disabled={disabled} type="date" value={form.internal_deadline} onChange={event => set('internal_deadline', event.target.value)} /></div>
    {unitControl}
    {teamControl}
  </>
  const budgetFields = <>
    <div className="field"><label htmlFor="application-total-budget">Orçamento total da candidatura (EUR)</label><ValidatedInput message="Introduza um montante entre 0 e 99 999 999 999 999,99 €, com até duas casas decimais." disabled={disabled || extendedDisabled} max="99999999999999.99" type="number" min="0" step="0.01" id="application-total-budget" value={form.total_budget} onChange={event => set('total_budget', event.target.value)} placeholder="0,00" /></div>
    <div className="field"><label htmlFor="application-organization-budget">Orçamento afeto à {organizationLabel} (EUR)</label><ValidatedInput message="Introduza um montante entre 0 e 99 999 999 999 999,99 €, com até duas casas decimais." disabled={disabled || extendedDisabled} max="99999999999999.99" type="number" min="0" step="0.01" id="application-organization-budget" value={form.university_budget} onChange={event => set('university_budget', event.target.value)} placeholder="0,00" /></div>
    <div className="field field-full"><label htmlFor="application-notes">Notas</label><textarea id="application-notes" maxLength={10000} disabled={disabled || extendedDisabled} rows={3} value={form.notes} onChange={event => set('notes', event.target.value)} placeholder="Observações, referências, contactos…" /></div>
  </>
  if (grouped) return <>{opportunityControl}<div className="application-create-fields">
    <section className="application-create-section" aria-label="Dados da candidatura"><h2>Dados da candidatura</h2><div className="field-grid">{dataFields}</div></section>
    <section className="application-create-section" aria-label="Orçamento e notas"><h2>Orçamento e notas</h2><div className="field-grid">{budgetFields}</div></section>
  </div></>
  return <div className="field-grid">{opportunityControl}{dataFields}{budgetFields}</div>
}

export function ApplicationOpportunityContext({opportunity, showLabel = true}) {
 if(!opportunity)return null
 const display=opportunityDisplay(opportunity)
 return <div className="field field-full application-opportunity-context">{showLabel && <label>Oportunidade</label>}<strong>{display.title}</strong>
  {(display.programmeName||display.callReference)&&<p>{[display.programmeName,display.callReference].filter(Boolean).join(' · ')}</p>}
  <p>{display.deadlineKind==='PLANNED'?'Fecho previsto':'Prazo oficial'}: {display.deadlineAmbiguous?'Vários prazos por confirmar':display.deadline?formatOpportunityTemporal(display.deadline):'Não identificado'}</p>
  {display.officialUrl&&<a href={display.officialUrl} target="_blank" rel="noopener noreferrer">Fonte oficial</a>}
 </div>
}

function Detail({ label, value }) {
  if (!value && value !== 0) return null
  return <div className="dl-row"><dt>{label}</dt><dd>{value}</dd></div>
}

export function ApplicationInformation({ app, organizationLabel = 'organização', formatBudget, compact = false }) {
  const fmt = value => value ? dateLabel(value) : null
  return <dl className="dl-list">
    {!compact && <Detail label="Oportunidade" value={app.opportunity_title} />}
    <Detail label="Coordenador" value={app.coordinator_name} />
    <Detail label="Prazo oportunidade" value={fmt(app.closing_date)} />
    {!compact && <div className="dl-row"><dt>Prazo interno</dt><dd>{fmt(app.internal_deadline) || <span className="text-muted" style={{ fontStyle: 'italic' }}>Não definido</span>}</dd></div>}
    <Detail label="Orçamento total" value={formatBudget(app.total_budget)} />
    <Detail label={`Orçamento afeto à ${organizationLabel}`} value={formatBudget(app.university_budget)} />
    <Detail label="Criado em" value={fmt(app.created_at)} />
    {app.notes && <div className="dl-row dl-full"><dt>Notas</dt><dd className="pre-wrap">{app.notes}</dd></div>}
  </dl>
}
