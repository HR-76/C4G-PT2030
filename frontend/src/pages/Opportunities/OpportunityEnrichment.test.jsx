import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OpportunityOverview, OpportunityTable, opportunityFunding } from './OpportunityPresentation'
import OpportunityEnrichment from './OpportunityEnrichment'

afterEach(cleanup)
const observedAt = '2026-10-29T00:00:00.000Z'
const evidence = { url: 'https://ec.europa.eu/call', locator: 'Secção 3', excerpt: 'Texto publicado com condições.', observedAt }
const published = (...values) => ({ status: 'PUBLISHED', items: values.map(value => ({ value, evidence })), truncated: false })
const missing = () => ({ status: 'NOT_FOUND', items: [], truncated: false })
const enrichment = (fields = {}) => ({ schemaVersion: 1, mappingVersion: 'eu-framework-2026-10-29', observedAt, fields: {
  programme: published({ id: '43251567', code: 'CEF', label: 'Connecting Europe Facility' }),
  instrument: published({ text: 'Infrastructure projects' }),
  ...Object.fromEntries(['budget', 'support', 'rate', 'territories', 'beneficiaries', 'consortium', 'conditions', 'documents', 'submission'].map(key => [key, missing()])),
  ...fields,
} })
const budget = (patch = {}) => ({ amount: '125000000.00', currency: 'EUR', period: '2026', scope: 'TOPIC_OR_SHARED', group: 'published-group', action: 'CEF-CALL', ...patch })
// Retained enrichment renderer is tested independently; first-analysis pages no longer mount it.
const view = (value, props = {}) => <MemoryRouter><OpportunityEnrichment enrichment={value} sourceReview={props.sourceReview} showUncollected={props.central !== false && (!props.source || props.source === 'EU_FUNDING_TENDERS')} /></MemoryRouter>
it('separates call budget, shared budget and support without summing or losing decimal precision', () => {
  render(view(enrichment({ budget: published(budget(), budget({ amount: '999999999999999999.99', period: '2027', scope: 'CALL' })), support: published({ minimum: '10.01', maximum: '20.99', currency: 'EUR', unit: 'PER_PROJECT', action: 'CEF-CALL' }) })))
  const finance = screen.getByRole('region', { name: 'Financiamento publicado' })
  expect(within(finance).getByText('125\u00a0000\u00a0000,00 EUR', { normalizer: text => text })).toBeTruthy()
  expect(within(finance).getByText('999\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999,99 EUR', { normalizer: text => text })).toBeTruthy()
  expect(within(finance).getByText('Orçamento do aviso')).toBeTruthy()
  expect(within(finance).getByText('Orçamento do tema ou partilhado')).toBeTruthy()
  expect(within(finance).getByText('10,01 – 20,99 EUR por candidatura')).toBeTruthy()
  expect(within(finance).getByText('2026')).toBeTruthy()
  expect(within(finance).getByText('2027')).toBeTruthy()
})
it.each([[null, '20.50', 'Até 20,50'], ['10.25', null, 'A partir de 10,25']])('keeps one-sided support %s/%s and explicitly unknown currency', (minimum, maximum, text) => {
  render(view(enrichment({ support: published({ minimum, maximum, currency: null, unit: 'PER_PROJECT', action: null }) })))
  const finance = screen.getByRole('region', { name: 'Financiamento publicado' })
  expect(within(finance).getByText(`${text} · moeda não indicada por candidatura`)).toBeTruthy()
  expect(finance.textContent).not.toContain('EUR')
})
it('keeps rates and participation conditions as published text without inventing eligibility', () => {
  const fields = Object.fromEntries(['rate', 'territories', 'beneficiaries', 'consortium', 'conditions'].map(key => [key, published({ text: `${key}: conforme a secção 5; há exceções.` })]))
  render(view(enrichment(fields)))
  for (const key of Object.keys(fields)) expect(screen.getByText(`${key}: conforme a secção 5; há exceções.`)).toBeTruthy()
  expect(screen.getByText('Informação publicada pela fonte; não confirma a elegibilidade nem os critérios da organização.')).toBeTruthy()
  expect(screen.queryByText('Elegível')).toBeNull()
})
it('shows unknown programme mapping, field conflicts and truncated evidence explicitly', () => {
  render(view(enrichment({
    programme: { ...published({ id: 'NEW-PROGRAMME', code: null, label: 'Programa publicado' }), status: 'UNSUPPORTED' },
    budget: { ...published(budget(), budget({ amount: '200000000' })), status: 'CONFLICT' },
    conditions: { ...published({ text: 'Condições parciais.' }), truncated: true },
  })))
  expect(screen.getByText('Programa por identificar.')).toBeTruthy()
  expect(screen.getAllByText('Informação divergente entre versões da fonte — requer revisão.').length).toBeGreaterThan(0)
  expect(screen.getByText('Informação parcial: consulte a fonte para o conteúdo completo.')).toBeTruthy()
  expect(screen.getByText('Condições parciais.')).toBeTruthy()
})
it('exposes field provenance through a native disclosure with source, locator, excerpt and observation time', () => {
  render(view(enrichment({ budget: published(budget()) })))
  const disclosure = screen.getByText('Ver fonte: Orçamento publicado').closest('details')
  expect(disclosure).toBeTruthy()
  fireEvent.click(within(disclosure).getByText('Ver fonte: Orçamento publicado'))
  expect(within(disclosure).getByRole('link', { name: 'ec.europa.eu' }).getAttribute('href')).toBe(evidence.url)
  expect(within(disclosure).getByText('Secção 3')).toBeTruthy()
  expect(within(disclosure).getByText(evidence.excerpt)).toBeTruthy()
  expect(disclosure.querySelector('time').getAttribute('dateTime')).toBe(observedAt)
  expect(disclosure.textContent).toContain('29/10/2026')
})
it('keeps documents separate from submission and does not claim submission is available', () => {
  render(view(enrichment({ documents: published({ title: 'Convocatória', url: 'https://ec.europa.eu/call.pdf' }), submission: published({ title: 'Portal de submissão', url: 'https://ec.europa.eu/apply', availability: 'UNKNOWN' }) })))
  const documents = screen.getByRole('region', { name: 'Documentos e submissão' })
  expect(within(documents).getByRole('link', { name: 'Convocatória' }).getAttribute('rel')).toBe('noopener noreferrer')
  expect(within(documents).getByRole('link', { name: 'Portal de submissão' }).getAttribute('href')).toBe('https://ec.europa.eu/apply')
  expect(within(documents).getByText('Disponibilidade para submissão não confirmada. A ligação não confirma abertura.')).toBeTruthy()
})
it('renders values and excerpts inertly and rejects non-HTTPS, credentials and sensitive query parameters', () => {
  const urls = ['javascript:alert(1)', 'http://example.org', 'https://user:password@example.org', 'https://example.org/?token=secret', 'https://example.org/?api_key=secret']
  const docs = published(...urls.map((url, index) => ({ title: `Documento ${index}`, url })))
  docs.items.forEach(item => { item.evidence = { ...evidence, url: item.value.url, excerpt: '<img src=x onerror=alert(1)>' } })
  render(view(enrichment({ documents: docs, conditions: published({ text: '<script>alert(1)</script>' }) })))
  const documents = screen.getByRole('region', { name: 'Documentos e submissão' })
  expect(within(documents).queryAllByRole('link')).toHaveLength(0)
  expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
  expect(document.querySelector('script, img')).toBeNull()
  expect(document.body.textContent).not.toContain('password@example')
})
it('labels preserved enrichment as requiring review', () => {
  render(view(enrichment(), { sourceReview: 'CONFLICT', temporal: { state: 'UNKNOWN' }, fields: { title: 'Aviso', sourceEnrichment: enrichment(), sourceResolution: { schemaVersion: 1, reason: 'Decisão anterior.', sources: [] }, sourceTemporal: { status: 'OPEN', deadlines: ['2026-03-24T17:00:00+01:00'] } } }))
  expect(screen.getByText('Os dados adicionais preservados requerem nova revisão da fonte.')).toBeTruthy()
})
it('distinguishes a legacy EU snapshot from collected-but-missing facts without adding notices to other sources', () => {
  const mounted = render(view(undefined))
  expect(screen.getByText('Informação adicional ainda não recolhida.')).toBeTruthy()
  mounted.rerender(view(enrichment()))
  expect(screen.queryByText('Informação adicional ainda não recolhida.')).toBeNull()
  expect(screen.getAllByText('Não identificado nos dados recolhidos.').length).toBeGreaterThan(0)
  mounted.rerender(view(undefined, { source: 'POCTEP' }))
  expect(screen.queryByText('Informação adicional ainda não recolhida.')).toBeNull()
  mounted.rerender(view(undefined, { central: false }))
  expect(screen.queryByText('Informação adicional ainda não recolhida.')).toBeNull()
})
it('summarizes one budget with explicit scope and sends multiple budgets to the detail without a total', () => {
  const one = opportunityFunding({ sourceEnrichment: enrichment({ budget: published(budget()) }), summary: 'Grant EUR 1 million' })
  expect(one.label).toContain('Orçamento do tema ou partilhado')
  expect(one.label).toContain('125\u00a0000\u00a0000,00 EUR')
  const fields = { sourceEnrichment: enrichment({ budget: published(budget(), budget({ period: '2027' })) }), summary: 'EUR 500' }
  render(<MemoryRouter><OpportunityTable central search="?programme=CEF" items={[{ opportunityId: 'one', title: 'Aviso', funding: fields }]} /></MemoryRouter>)
  expect(screen.getByRole('columnheader', { name: 'Dotação da call' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: 'Connecting Europe Facility' })).toBeTruthy()
  expect(screen.queryByText('EUR 500')).toBeNull()
  expect(screen.getByRole('link', { name: 'Ver 2 dotações' }).getAttribute('href')).toBe('/catalogo/one?programme=CEF#financiamento-oportunidade')
  expect(document.body.textContent).not.toContain('250')
  expect(screen.queryByText('Valores na descrição')).toBeNull()
})
it('does not fall back to a summary amount when enriched financial fields are unknown', () => {
  const result = opportunityFunding({ sourceEnrichment: enrichment(), summary: 'EUR 1000000 or 90%' })
  expect(result.label).toBe('Valores não identificados')
  expect(result.kind).not.toBe('description')
})
