import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRequire } from 'node:module'
import eu from '../../../../context/references/opportunity-v2/examples/eu-11145.json'
import plan from '../../../../context/references/opportunity-v2/examples/pt2030-8614.json'
import zero from '../../../../context/references/opportunity-v2/examples/pt2030-8664.json'
import { OpportunityOverview, OpportunityTable } from './OpportunityPresentation'

afterEach(cleanup)
const { createOpportunityReadModel } = createRequire(import.meta.url)('../../../../backend/src/opportunities/v2/readModel')
function model(snapshot) {
  const { identity, sourceRecords, quality, schemaVersion, contractVersion, provenance, ...projection } = structuredClone(snapshot)
  return { version: 'opportunity-read-v2.0', sourceVersion: 2, identity, sourceRecords, projection, quality,
    temporal: { effectiveState: snapshot.publication.value === 'PLANNED' ? 'PLANNED' : 'OPEN', nextDeadline: snapshot.schedule.deadlines.value?.[0], finalDeadline: snapshot.schedule.deadlines.value?.at(-1) } }
}
it('limits list columns to first analysis and preserves official and internal navigation', () => {
  const readModel = model(eu)
  render(<MemoryRouter><OpportunityTable central search="?programme=DIGITAL" showApplications={false} items={[{ opportunityId: 'one', readModel }]} /></MemoryRouter>)
  expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Oportunidade', 'Estado do aviso', 'Tipificação', 'Abertura', 'Fecho', 'Áreas de intervenção', 'Dotação da call', 'Programa financiador'])
  expect(screen.getByRole('link', { name: 'Gnomon Internships Offer' }).getAttribute('href')).toBe('/catalogo/one?programme=DIGITAL')
  expect(screen.getByRole('link', { name: /Consultar fonte oficial/ }).getAttribute('href')).toContain('/11145')
  expect(document.body.textContent).toContain('120\u202f000,00 €')
  expect(document.body.textContent).not.toContain('1\u00a0500')
})
it('removes diagnostic and secondary sections from EU details while keeping attribution', () => {
  render(<MemoryRouter><OpportunityOverview central fields={eu} readModel={model(eu)} /></MemoryRouter>)
  for (const name of ['Classificação publicada', 'Condições publicadas', 'Projeto associado', 'Ligações publicadas', 'Qualidade da informação']) expect(screen.queryByRole('region', { name })).toBeNull()
  expect(screen.queryByText('Não recolhido')).toBeNull()
  expect(screen.queryByText('SUSA')).toBeNull()
  expect(screen.getByText('Programa financiador')).toBeTruthy()
  expect(screen.getByText(/Dados resumidos e formatados pela C4G/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Condições de reutilização' }).getAttribute('href')).toBe('https://commission.europa.eu/legal-notice_en')
})
it('uses the same essentials for planned and legacy opportunities without calling individual support a budget', () => {
  const view = render(<MemoryRouter><OpportunityOverview readModel={model(plan)} /></MemoryRouter>)
  expect(screen.getByText('Abertura prevista')).toBeTruthy()
  expect(screen.getByText('Fecho previsto')).toBeTruthy()
  for (const programme of plan.programmes.value) expect(screen.getByText(programme.label)).toBeTruthy()
  view.unmount()
  render(<MemoryRouter><OpportunityOverview fields={{ title: 'Manual', programmeName: 'Programa local', summary: 'Apoio EUR 1500 mensal', currencyCode: 'EUR', fundingAmountMin: '1500', fundingAmountMax: '1500' }} /></MemoryRouter>)
  expect(screen.getByText('Programa local')).toBeTruthy()
  const finance = screen.getByRole('region', { name: 'Dotação da call' })
  expect(finance.textContent).not.toContain('1500')
  expect(finance.textContent).toContain('Não indicada')
})
it('does not fall back to support, percentages or programme budgets when call allocation is missing', () => {
  const readModel = model(eu)
  readModel.projection.financing.allocations = { state: 'NOT_FOUND', value: null }
  render(<MemoryRouter><OpportunityOverview readModel={readModel} /></MemoryRouter>)
  const finance = screen.getByRole('region', { name: 'Dotação da call' })
  expect(finance.textContent).toContain('Não indicada')
  expect(finance.textContent).not.toContain('1\u00a0500')
})
it('keeps attribution for a historical EU record with an empty typed source list', () => {
  const readModel = model(eu)
  readModel.sourceVersion = 1
  readModel.sourceRecords = []
  render(<MemoryRouter><OpportunityOverview source="EU_FUNDING_TENDERS" fields={{ title: 'Historical call', summary: 'Historical call', officialUrl: 'https://ec.europa.eu/call' }} readModel={readModel} /></MemoryRouter>)
  expect(screen.getByText(/Fonte: EU Funding & Tenders/)).toBeTruthy()
  expect(screen.getAllByText('Historical call')).toHaveLength(1)
  expect(screen.getByText('Consultar a descrição na fonte oficial.')).toBeTruthy()
})
it('preserves published zero and its uncertainty without inferring a positive amount', () => {
  render(<MemoryRouter><OpportunityOverview readModel={model(zero)} /></MemoryRouter>)
  const finance = screen.getByRole('region', { name: 'Dotação da call' })
  expect(finance.textContent).toContain('0 · moeda não indicada')
  expect(finance.textContent).not.toContain('EUR')
  expect(finance.textContent).toContain('Zero publicado; significado por confirmar')
})
it('renders actual v1 compatibility allocations in list and detail without changing their scope', () => {
  const observedAt = '2026-10-29T00:00:00.000Z'
  const fields = Object.fromEntries(['programme', 'instrument', 'budget', 'support', 'rate', 'territories', 'beneficiaries', 'consortium', 'conditions', 'documents', 'submission'].map(key => [key, { status: 'NOT_FOUND', items: [], truncated: false }]))
  fields.budget = { status: 'PUBLISHED', truncated: false, items: [{ value: { amount: '125000000.00', currency: 'EUR', period: '2026', scope: 'TOPIC_OR_SHARED', group: 'budget-group', action: 'CALL' }, evidence: { url: 'https://ec.europa.eu/call', locator: 'Budget', excerpt: 'Published budget', observedAt } }] }
  const snapshot = { schemaVersion: 1, title: 'Historical budget', funderName: 'Publisher', provenanceId: '01900000-0000-7000-8000-000000000001', lifecycleState: 'ACTIVE', validationState: 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1', qualityRuleVersion: 'opportunity-quality-v1', sourceEnrichment: { schemaVersion: 1, mappingVersion: 'eu-framework-2026-10-29', observedAt, fields } }
  const readModel = createOpportunityReadModel(snapshot, { asOf: '2026-10-30T12:00:00.000Z' })
  const view = render(<MemoryRouter><OpportunityTable showApplications={false} items={[{ opportunityId: 'v1', snapshot, readModel, source: 'EU_FUNDING_TENDERS' }]} /></MemoryRouter>)
  expect(document.body.textContent).toContain('125\u00a0000\u00a0000,00 EUR')
  expect(document.body.textContent).toContain('Dotação do tema ou partilhada')
  view.unmount()
  render(<MemoryRouter><OpportunityOverview fields={snapshot} readModel={readModel} source="EU_FUNDING_TENDERS" /></MemoryRouter>)
  expect(screen.getByRole('region', { name: 'Dotação da call' }).textContent).toContain('125\u00a0000\u00a0000,00 EUR')
})
it('preserves the server-selected v1 cutoff when two rounds occur on the same civil date', () => {
  const snapshot = { schemaVersion: 1, title: 'Two rounds', funderName: 'Publisher', provenanceId: '01900000-0000-7000-8000-000000000001', lifecycleState: 'ACTIVE', validationState: 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1', qualityRuleVersion: 'opportunity-quality-v1', sourceTemporal: { status: 'OPEN', openings: [], deadlines: ['2027-01-01T09:00:00Z', '2027-01-01T17:00:00Z'] } }
  const readModel = createOpportunityReadModel(snapshot, { asOf: '2027-01-01T12:00:00.000Z' })
  render(<MemoryRouter><OpportunityOverview fields={snapshot} readModel={readModel} /></MemoryRouter>)
  const closing = screen.getByText('Fecho').parentElement.querySelector('time')
  expect(closing.getAttribute('datetime')).toBe('2027-01-01T17:00:00.000Z')
  expect(closing.textContent).toContain('17:00:00 UTC')
})
it('keeps manual-correction conflicts visible independently of source review and technical quality', () => {
  const view = render(<MemoryRouter><OpportunityOverview fields={{ title: 'Manual' }} validationState="CONFLICT" /></MemoryRouter>)
  expect(screen.getByRole('status').textContent).toContain('Divergência com correções manuais')
  expect(screen.queryByRole('region', { name: 'Qualidade da informação' })).toBeNull()
  view.unmount()
  render(<MemoryRouter><OpportunityTable showApplications={false} items={[{ opportunityId: 'manual', snapshot: { title: 'Manual', validationState: 'CONFLICT' } }]} /></MemoryRouter>)
  expect(screen.getByText('Divergência com correções manuais')).toBeTruthy()
})

it('links a planned call without its own URL to the official plan', () => {
  render(<MemoryRouter><OpportunityOverview central readModel={model(plan)} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Consultar fonte oficial' }).getAttribute('href')).toBe('https://portugal2030.pt/plano-anual-de-avisos/')
})
