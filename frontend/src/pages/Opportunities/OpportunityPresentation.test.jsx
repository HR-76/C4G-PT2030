import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OpportunityOverview, OpportunityTable, opportunityAmount, opportunityFunding } from './OpportunityPresentation'
afterEach(cleanup)
const resolution = overrides => ({
  schemaVersion: 1,
  resolutionId: 'c9c08817-2217-4b2a-9b0b-03332737c935',
  sourceFingerprint: 'a'.repeat(64),
  decidedAt: '2026-10-28T23:00:00Z',
  reason: 'Calendário confirmado por documentação oficial.',
  note: 'As revisões anteriores foram preservadas.',
  sources: [{ url: 'https://ec.europa.eu/example/call.pdf', title: 'Ficha oficial', locator: 'p. 5' }],
  ...overrides,
})
const resolvedCases = [
  ['CEF-T-2021-AFIFCOEN-WORKS-LNG', '2023-11-07T17:00:00+01:00', 'CLOSED'],
  ['CEF-T-2021-AFIFCOEN-WORKS-ZE', '2023-11-07T17:00:00+01:00', 'CLOSED'],
  ['CEF-T-2021-AFIFGEN-UNITS', '2023-11-07T17:00:00+01:00', 'CLOSED'],
  ['CEF-T-2021-AFIFGEN-WORKS-LNG', '2023-11-07T17:00:00+01:00', 'CLOSED'],
  ['ERASMUS-EDU-2022-ECHE-CERT-FP', '2026-03-24T17:00:00+01:00', 'OPEN'],
  ['ESC-HUMAID-2021-QUAL-LABEL-FP', '2026-09-22T17:00:00+02:00', 'CLOSED'],
]
it.each(resolvedCases)('shows documentary resolution and exact deadline for %s', (reference, deadline, publishedState) => {
  render(<MemoryRouter><OpportunityOverview central temporal={{ state: 'CLOSED' }} fields={{
    title: 'Aviso revisto', callReference: reference, closingDate: deadline.slice(0, 10),
    sourceTemporal: { status: publishedState, deadlines: [deadline] }, sourceResolution: resolution(),
  }} /></MemoryRouter>)
  const section = screen.getByRole('region', { name: 'Resolução documental' })
  expect(within(section).getByText('Calendário confirmado por documentação oficial.')).toBeTruthy()
  expect(within(section).getByText('As revisões anteriores foram preservadas.')).toBeTruthy()
  expect(section.querySelector('time').getAttribute('dateTime')).toBe('2026-10-28T23:00:00Z')
  expect(section.textContent).toContain('28/10/2026')
  const link = within(section).getByRole('link', { name: 'Ficha oficial' })
  expect(link.getAttribute('href')).toBe('https://ec.europa.eu/example/call.pdf')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  expect(within(section).getByText('p. 5')).toBeTruthy()
  expect(screen.getByText('Encerrado')).toBeTruthy()
  expect(screen.queryByText('Estado publicado na revisão')).toBeNull()
  const displayedDeadline = document.querySelector(`time[datetime="${deadline}"]`)
  expect(displayedDeadline.textContent).toContain(`17:00:00 UTC${deadline.slice(-6)}`)
  expect(section.textContent).not.toContain('c9c08817')
  expect(section.textContent).not.toContain('a'.repeat(64))
})
it('shows the certification caveat without treating the ESC session closure as the end of the certificate', () => {
  const note = 'A sessão de submissão está encerrada. A certificação mantém-se contínua durante o período de programação; não é uma subvenção direta.'
  render(<MemoryRouter><OpportunityOverview central temporal={{ state: 'CLOSED' }} fields={{ title: 'Selo humanitário', sourceResolution: resolution({ note }) }} /></MemoryRouter>)
  expect(within(screen.getByRole('region', { name: 'Resolução documental' })).getByText(note)).toBeTruthy()
})
it.each(['CONFLICT', 'ABSENT', 'ERROR'])('identifies the previous resolution as requiring review after %s', sourceReview => {
  render(<MemoryRouter><OpportunityOverview central sourceReview={sourceReview} temporal={{ state: 'UNKNOWN' }} fields={{ title: 'Aviso', sourceResolution: resolution() }} /></MemoryRouter>)
  const section = screen.getByRole('region', { name: 'Resolução documental' })
  expect(within(section).getByText('Resolução anterior — requer nova revisão.')).toBeTruthy()
  expect(screen.getByText('A fonte requer nova revisão. Os dados anteriores foram preservados.')).toBeTruthy()
  expect(within(section).getByText('Calendário confirmado por documentação oficial.')).toBeTruthy()
})
it('renders documentary text inertly and allows only credential-free HTTPS document links', () => {
  const unsafeUrls = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.org/call.pdf', 'https://user:password@example.org/call.pdf', '/relative.pdf']
  render(<MemoryRouter><OpportunityOverview fields={{ title: 'Aviso', sourceResolution: resolution({
    reason: '<img src=x onerror=alert(1)>',
    note: '<script>alert(1)</script>',
    rawPayloads: 'INTERNAL_EVIDENCE',
    sources: [...unsafeUrls.map((url, index) => ({ url, title: `Fonte ${index}` })), { url: 'https://ec.europa.eu/safe.pdf', title: '<b>Documento oficial</b>', locator: 'p. 2' }],
  }) }} /></MemoryRouter>)
  const section = screen.getByRole('region', { name: 'Resolução documental' })
  expect(within(section).getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  expect(within(section).getByText('<script>alert(1)</script>')).toBeTruthy()
  expect(section.querySelector('img, script')).toBeNull()
  expect(within(section).getAllByRole('link').map(link => link.href)).toEqual(['https://ec.europa.eu/safe.pdf'])
  expect(section.textContent).not.toContain('INTERNAL_EVIDENCE')
})
it('keeps civil deadlines without an invented hour and does not invent a resolution for older records', () => {
  render(<MemoryRouter><OpportunityOverview fields={{ title: 'Aviso anterior', sourceTemporal: { status: 'CLOSED', deadlines: ['2026-03-24'] } }} /></MemoryRouter>)
  expect(screen.getByText('24/03/2026 · hora não indicada')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Resolução documental' })).toBeNull()
})
it('keeps the next round and source review warning without a technical state column', () => {
  render(<MemoryRouter><OpportunityTable central items={[{ opportunityId:'future',title:'Future call',lifecycleState:'ACTIVE',sourceReview:'CONFLICT',temporal:{state:'UPCOMING',nextDeadline:'2027-06-01'},closingDate:'2026-01-01' }]} /></MemoryRouter>)
  expect(screen.queryByRole('columnheader', { name: 'Estado' })).toBeNull()
  expect(screen.getByText('Fonte em revisão')).toBeTruthy()
  expect(screen.queryByText('Ativa no catálogo')).toBeNull()
  expect(screen.queryByText('Requer revisão da fonte')).toBeNull()
  expect(screen.getByText('01/06/2027')).toBeTruthy()
  expect(screen.queryByText('01/01/2026')).toBeNull()
})
it('keeps the excerpt compact without losing the full source conditions', () => {
  render(<MemoryRouter><OpportunityOverview fields={{ title: 'Call', summary: 'Introduction '.repeat(90) + 'Final eligibility condition.' }} /></MemoryRouter>)
  expect(screen.queryByText(/Final eligibility condition/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ler descrição completa' }))
  expect(screen.getByText(/Final eligibility condition/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Recolher descrição' }).getAttribute('aria-expanded')).toBe('true')
})
it('omits registration and technical statistics from first analysis', () => {
  render(<MemoryRouter><OpportunityOverview central fields={{ title: 'Call', closingDate: '2027-01-03' }} registeredAt="2026-10-01T15:00:00Z" observedAt="2026-10-17T15:00:00Z" applicationCount={<span>3</span>} /></MemoryRouter>)
  expect(document.querySelector('.stats-strip')).toBeNull()
  expect(screen.getByRole('region', { name: 'Dotação da call' })).toBeTruthy()
  expect(screen.queryByText('01/10/2026')).toBeNull()
  expect(screen.queryByText('17/10/2026')).toBeNull()
})
it('omits generic caution controls while keeping the description', () => {
  render(<MemoryRouter><OpportunityOverview fields={{ title: 'Call', summary: 'Original source text' }} /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Informação sobre abertura e elegibilidade' })).toBeNull()
  expect(screen.getByText('Original source text')).toBeTruthy()
  expect(document.querySelector('.opportunity-note')).toBeNull()
})
it('retains exact financial amounts and distinguishes missing from zero', () => {
  expect(opportunityAmount({})).toBe('Não indicado')
  expect(opportunityAmount({ currencyCode: 'EUR', fundingAmountMin: '0.00', fundingAmountMax: '0.00' })).toBe('0.00 EUR')
  expect(opportunityAmount({ currencyCode: 'EUR', fundingAmountMin: '999999999999.99', fundingAmountMax: '999999999999.99' })).toBe('999999999999.99 EUR')
})
it('distinguishes recorded amounts, contextual mentions and missing evidence without extracting totals', () => {
  for (const summary of ['€1,500 per month', 'EUR 10 million for the call', 'up to 50%', '20 000 euros', '$ 10', '2.5 GBP']) expect(opportunityFunding({ summary }).kind).toBe('description')
  for (const summary of ['Eligibility from 2026 to 2028', 'Funding available', '', null]) expect(opportunityFunding({ summary })).toEqual({ kind: 'unknown', label: 'Montante não identificado' })
  expect(opportunityFunding({ currencyCode: 'EUR', fundingAmountMin: '0.00', fundingAmountMax: '0.00', summary: '€100 monthly' })).toEqual({ kind: 'amount', label: '0.00 EUR' })
})
it('keeps filters in the central detail link and supports direct description anchors', () => {
  const fields = { title: 'Public call', summary: '€1,500 per month. '.repeat(60) }
  const view = render(<MemoryRouter><OpportunityTable items={[{ ...fields, opportunityId: 'one', funding: fields }]} central search="?programme=DIGITAL" /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Public call' }).getAttribute('href')).toBe('/catalogo/one?programme=DIGITAL')
  expect(screen.queryByRole('link', { name: 'Ler descrição' })).toBeNull()
  view.unmount()
  render(<MemoryRouter initialEntries={['/catalogo/one?programme=DIGITAL#descricao-oportunidade']}><OpportunityOverview fields={fields} /></MemoryRouter>)
  expect(screen.queryByRole('link', { name: 'Valores na descrição' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Descrição da fonte' }))
})
it.each(['javascript:alert(1)', 'https://user:password@example.org', 'data:text/html,<script>alert(1)</script>'])('does not expose unsafe source URL %s', officialUrl => {
  render(<MemoryRouter><OpportunityOverview fields={{ title: 'Public call', officialUrl }} /></MemoryRouter>)
  expect(screen.queryByRole('link', { name: 'Consultar fonte oficial' })).toBeNull()
})
it('shows record lifecycle separately from dates and renders source HTML inertly', () => {
  render(<MemoryRouter><OpportunityOverview central fields={{ title: 'Public call', lifecycleState: 'ACTIVE', closingDate: '2020-01-31', officialUrl: 'https://example.org/call', summary: '<img src=x onerror=alert(1)>' }} /></MemoryRouter>)
  expect(screen.queryByText('Ativa no catálogo')).toBeNull()
  expect(screen.getByText('31/01/2020 · hora não indicada')).toBeTruthy()
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByRole('link', { name: 'Consultar fonte oficial' }).getAttribute('rel')).toBe('noopener noreferrer')
})
