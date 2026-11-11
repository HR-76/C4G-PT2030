import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import eu from '../../../../context/references/opportunity-v2/examples/eu-11145.json'
import plan from '../../../../context/references/opportunity-v2/examples/pt2030-8614.json'
import zero from '../../../../context/references/opportunity-v2/examples/pt2030-8664.json'
import { OpportunityOverview, OpportunityTable } from './OpportunityPresentation'
import { OpportunityReadModelDetails } from './OpportunityReadModelView'
import { commonFunding, formatOpportunityTemporal, opportunityDisplay, opportunityPageCsv } from './opportunityReadModel'

afterEach(cleanup)
function model(snapshot, overrides = {}) {
  const { identity, sourceRecords, provenance, quality, schemaVersion, contractVersion, ...projection } = snapshot
  return { version: 'opportunity-read-v2.0', sourceVersion: 2, revisionId: 'revision', asOf: '2026-10-30T12:00:00.000Z', identity, sourceRecords, projection,
    temporal: { effectiveState: snapshot.publication.value === 'PLANNED' ? 'PLANNED' : 'OPEN', nextDeadline: snapshot.schedule.deadlines.value?.[0] || null, finalDeadline: snapshot.schedule.deadlines.value?.at(-1) || null, nextDeadlineCandidates: [], finalDeadlineCandidates: [], reasonCodes: [] },
    quality: { verification: 'NOT_CERTIFIED', reviewRequired: false, issues: quality.issues, fieldStates: { PRESENT: 8 }, totalFields: 35 }, freshness: { observedAt: '2026-10-30T12:00:00.000Z', sourceReview: null }, ...overrides }
}
const record = (snapshot, overrides) => ({ opportunityId: 'one', revisionId: 'revision', lifecycleState: 'ACTIVE', snapshot, readModel: model(snapshot, overrides) })

it('keeps the normative 11145 budget visible in list and detail with the EUR display default and unchanged canonical currency', () => {
  const item = record(eu)
  expect(commonFunding(item.readModel).label).toContain('120\u00a0000')
  expect(commonFunding(item.readModel).label).toContain('moeda não indicada')
  const view = render(<MemoryRouter><OpportunityTable central items={[item]} showApplications={false} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: /120.*000,00 €/ })).toBeTruthy()
  expect(screen.getByText('Gnomon Internships Offer')).toBeTruthy()
  view.unmount()
  render(<MemoryRouter><OpportunityOverview central fields={eu} readModel={item.readModel} lifecycleState="ACTIVE" /></MemoryRouter>)
  const finance = screen.getByRole('region', { name: 'Dotação da call' })
  expect(finance.textContent).toContain('120\u202f000,00 €')
  expect(finance.textContent).not.toContain('EUR por regra geral · moeda não indicada na fonte')
  expect(finance.textContent).not.toContain('1\u00a0500 EUR por pessoa e mês')
  expect(screen.queryByText('SUSA')).toBeNull()
  expect(screen.queryByText('101190010')).toBeNull()
  expect(document.querySelectorAll('.opportunity-deadlines li time')).toHaveLength(7)
})

it('keeps plural programmes and one plan allocation without confirming publication or opening', () => {
  const item = record(plan), display = opportunityDisplay(item)
  expect(display.temporalState).toBe('PLANNED')
  expect(display.programmeName).toContain(plan.programmes.value[0].label)
  expect(display.programmeName).toContain(plan.programmes.value[1].label)
  const table = render(<MemoryRouter><OpportunityTable items={[item]} central showApplications={false} /></MemoryRouter>)
  expect(screen.getAllByText('Previsão')).toHaveLength(2)
  table.unmount()
  render(<MemoryRouter><OpportunityOverview central fields={plan} readModel={item.readModel} lifecycleState="ACTIVE" /></MemoryRouter>)
  expect(screen.getAllByText('Previsto').length).toBeGreaterThan(0)
  expect(screen.getByText('Abertura prevista')).toBeTruthy()
  expect(screen.getByText('Fecho previsto')).toBeTruthy()
  expect(screen.queryByText('Aberta')).toBeNull()
  const finance = screen.getByRole('region', { name: 'Dotação da call' })
  expect(finance.querySelectorAll('[data-allocation]')).toHaveLength(1)
})

it('does not choose or sum plural allocations and keeps zero with unknown meaning', () => {
  const multi = structuredClone(eu)
  multi.financing.allocations.value.push({ ...multi.financing.allocations.value[0], key: 'second', money: { ...multi.financing.allocations.value[0].money, amount: '999999999999999999999999.12345678' } })
  expect(commonFunding(model(multi)).label).toBe('Ver 2 dotações')
  expect(commonFunding(model(zero)).label).toContain('0')
  render(<MemoryRouter><OpportunityOverview fields={multi} readModel={model(multi)} /></MemoryRouter>)
  expect(screen.getByRole('region', { name: 'Dotação da call' }).textContent).toContain('999\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999,12345678')
})

it('preserves date precision and distinguishes planned values and ambiguous next cutoffs', () => {
  expect(formatOpportunityTemporal({ precision: 'DATE', value: '2027-01-02' })).toBe('02/01/2027 · hora não indicada')
  expect(formatOpportunityTemporal({ precision: 'INSTANT', value: '2027-01-02T14:30:00.000Z' })).toBe('02/01/2027 às 14:30:00 UTC')
  expect(formatOpportunityTemporal({ precision: 'PERIOD', start: '2027-01-01', end: '2027-04-30', label: '1.º quadrimestre' })).toContain('1.º quadrimestre')
  const value = record(eu, { temporal: { effectiveState: 'UNKNOWN', nextDeadline: null, finalDeadline: null, nextDeadlineCandidates: eu.schedule.deadlines.value.slice(0, 2), finalDeadlineCandidates: [] } })
  expect(opportunityDisplay(value).deadlineAmbiguous).toBe(true)
})

it('uses a safe provenance link when the official field is unsafe', () => {
  const snapshot = structuredClone(eu)
  snapshot.links.official.value = 'javascript:alert(1)'
  render(<MemoryRouter><OpportunityOverview fields={snapshot} readModel={model(snapshot)} /></MemoryRouter>)
  const link = screen.getByRole('link', { name: 'Consultar fonte oficial' })
  expect(link.getAttribute('href')).toBe(snapshot.sourceRecords.find(source => source.url.startsWith('https:')).url)
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
})

it('exposes missing states and known document conflicts without certification or unsafe links', () => {
  const snapshot = structuredClone(eu)
  snapshot.links.official.value = 'javascript:alert(1)'
  snapshot.sourceRecords = snapshot.sourceRecords.map(source => ({ ...source, url: 'javascript:alert(1)' }))
  snapshot.description.summary.value = '<img src=x onerror=alert(1)>'
  const readModel = model(snapshot, { quality: { verification: 'NOT_CERTIFIED', reviewRequired: true, issues: [{ code: 'OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW', field: '/schedule/deadlines' }] } })
  render(<MemoryRouter><OpportunityOverview fields={snapshot} readModel={readModel} /></MemoryRouter>)
  expect(screen.getByText(/Os documentos oficiais apresentam horários divergentes/)).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Consultar fonte oficial' })).toBeNull()
  expect(document.querySelector('img,script')).toBeNull()
  expect(screen.queryByText('Não recolhido')).toBeNull()
  expect(screen.queryByText(/100%|Certificada/)).toBeNull()
})

it('exports only current page with exact values, every cutoff and formula-safe cells', () => {
  const first = record(eu), second = record(plan)
  second.opportunityId = 'two'; second.readModel.projection = structuredClone(second.readModel.projection)
  second.readModel.projection.description.title.value = '=HYPERLINK("https://evil.test")'
  const csv = opportunityPageCsv([first, second])
  expect(csv).toContain('120000')
  expect(csv).toContain('NOT_FOUND')
  expect(csv).toContain('101190010')
  for (const cutoff of eu.schedule.deadlines.value) expect(csv).toContain(cutoff.at.value)
  expect(csv).toContain("'=HYPERLINK")
  expect(csv.split('\r\n')).toHaveLength(4)
})

it('keeps multiple sources, currency conflicts and collection coverage explicit', () => {
  const value = record(eu)
  value.readModel.sourceRecords = [...value.readModel.sourceRecords, { key: 'manual', namespace: 'C4G_MANUAL', externalId: 'EDITORIAL:one', url: null }]
  value.readModel.projection = structuredClone(value.readModel.projection)
  value.readModel.projection.financing.allocations.value[0].money.currency = { state: 'CONFLICT', value: null, reason: 'DIFFERENT_CURRENCIES' }
  value.readModel.quality = { verification: 'NOT_CERTIFIED', reviewRequired: true, issues: [], totalFields: 4, fieldStates: { PRESENT: 1, CONFLICT: 1, NOT_FOUND: 1, NOT_COLLECTED: 1 }, coverage: [{ sourceRecordKey: 'manual', coverage: 'EDITORIAL' }, { sourceRecordKey: 'eu', coverage: 'SELECTED_FIELDS' }] }
  expect(opportunityDisplay(value).source).toBe('MULTIPLE_SOURCES')
  expect(commonFunding(value.readModel).label).toContain('moeda divergente')
  render(<MemoryRouter><OpportunityOverview fields={eu} readModel={value.readModel} /></MemoryRouter>)
  expect(screen.queryByRole('region', { name: 'Qualidade da informação' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Dotação da call' }).textContent).toContain('moeda divergente')
  expect(screen.getByText(/Fonte: EU Funding & Tenders/)).toBeTruthy()
})

it('keeps legacy read-model funding ranges in the list, export and historical detail', () => {
  const readModel = model(eu, { sourceVersion: 1 })
  readModel.projection = structuredClone(readModel.projection)
  const absent = { state: 'NOT_COLLECTED', value: null, complete: false }
  readModel.projection.financing = { allocations: absent, support: absent, rates: absent, eligibleCosts: absent }
  readModel.projection.legacy = { fundingRange: { state: 'PRESENT', value: { minimum: '999999999999999999999999.01', maximum: '999999999999999999999999.09', currency: 'EUR' } } }
  const fields = { title: 'Historical call', currencyCode: 'EUR', fundingAmountMin: '999999999999999999999999.01', fundingAmountMax: '999999999999999999999999.09' }
  const value = { opportunityId: 'old', snapshot: fields, readModel }
  expect(opportunityPageCsv([value])).toContain('999999999999999999999999.01')
  expect(commonFunding(readModel).label).toContain(',01 – ')
  render(<MemoryRouter><OpportunityOverview fields={fields} readModel={readModel} /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Historical call' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Qualidade da informação' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Dotação da call' }).textContent).toContain('Não indicada')
})

it('shares all typed sections with interest details without duplicating page titles or actions', () => {
  render(<MemoryRouter><OpportunityReadModelDetails readModel={model(eu)} /></MemoryRouter>)
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Consultar fonte oficial' })).toBeNull()
  expect(document.querySelectorAll('.opportunity-deadlines li time')).toHaveLength(7)
  expect(screen.getByText('Ver 7 prazos publicados')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Dotação da call' }).textContent).toContain('120\u00a0000')
})
