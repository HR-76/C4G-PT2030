import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardCharts from './DashboardCharts'
import { exactMoney } from '../api/organizationDashboard'

afterEach(cleanup)

it('shows organization budgets by unit independently of application counts and preserves missing values', () => {
  const dashboard = {
    applications: { total: 0, by_status: {}, totalBudget: { total: '999.00', missing: 0 }, organizationBudget: { total: '150.25', missing: 1 } },
    unit_totals: [
      { unitId: 'a', label: 'Unidade A', total: 9, organizationBudget: { total: '50.00', missing: 0 } },
      { unitId: 'b', label: 'Unidade B', total: 1, lifecycle: 'ARCHIVED', organizationBudget: { total: '100.25', missing: 0 } },
      { unitId: null, label: 'Sem unidade atribuída', total: 1, organizationBudget: { total: null, missing: 1 } },
    ],
  }
  render(<MemoryRouter><DashboardCharts dashboard={dashboard}/></MemoryRouter>)
  const panel = screen.getByRole('heading', { name: 'Orçamento da organização por unidade' }).closest('section')
  expect(within(panel).getByText(exactMoney('100.25')).textContent).toBe(exactMoney('100.25'))
  expect(panel.querySelector('.chart-budget').textContent).toContain('Unidade B (arquivada)')
  expect(within(panel).getByText('Não disponível')).toBeTruthy()
  expect(within(panel).getByText('1 sem valor registado')).toBeTruthy()
  expect(panel.querySelectorAll('.chart-track')).toHaveLength(2)
  expect(screen.queryByRole('region', { name: 'Alinhamento estratégico' })).toBeNull()
})

const alignmentDashboard = strategyAlignment => ({ applications: { total: 3, by_status: { PREPARATION: 3 } }, report: { strategyAlignment } })

it('shows the strategy index, objective counts and links to the matching applications', async () => {
  const dashboard = alignmentDashboard({ state: 'READY', total: 3, aligned: 2, objectives: [
    { id: 'first', title: 'Digitalizar serviços', areaIds: ['digital'], count: 2 },
    { id: 'second', title: 'Modernizar infraestruturas', areaIds: [], count: 0 },
  ], areaNames: { digital: 'Ciência de Dados e Big Data' }, applications: [
    { applicationId: 'a', title: 'Projeto de dados', areaIds: ['digital'] },
    { applicationId: 'b', title: 'Projeto sem correspondência', areaIds: [] },
    { applicationId: 'c', title: 'Projeto de formação', areaIds: ['digital'] },
  ] })
  render(<MemoryRouter><DashboardCharts dashboard={dashboard}/></MemoryRouter>)
  const chart = within(screen.getByRole('region', { name: 'Alinhamento estratégico' }))
  expect(chart.getByText(/66,7\s?%/)).toBeTruthy()
  expect(chart.getByText('2 de 3 candidaturas com correspondência')).toBeTruthy()
  expect(chart.getByText('Sem áreas associadas')).toBeTruthy()
  expect(chart.getByText('Sem correspondência')).toBeTruthy()
  const details = chart.getByText('Digitalizar serviços').closest('li').querySelector('details')
  details.open = true
  expect((await within(details).findByRole('link', { name: 'Projeto de dados' })).getAttribute('href')).toBe('/candidaturas/a')
  expect(within(details).getAllByText('Ciência de Dados e Big Data')).toHaveLength(2)
  expect(within(details).queryByText('Projeto sem correspondência')).toBeNull()
  expect(chart.getByRole('link', { name: 'Ver lista em preparação' }).getAttribute('href')).toBe('/candidaturas?status=PREPARATION')
})

it('can reveal all matching applications when a result has more than eight', async () => {
  const dashboard = alignmentDashboard({ state: 'READY', total: 9, aligned: 9,
    objectives: [{ id: 'first', title: 'Digitalizar serviços', areaIds: ['digital'], count: 9 }],
    areaNames: { digital: 'Digital' }, applications: Array.from({ length: 9 }, (_, index) => ({
      applicationId: `app-${index}`, title: `Projeto ${index + 1}`, areaIds: ['digital'],
    })),
  })
  render(<MemoryRouter><DashboardCharts dashboard={dashboard}/></MemoryRouter>)
  const details = screen.getByText('Digitalizar serviços').closest('li').querySelector('details')
  details.open = true
  const more = await within(details).findByRole('button', { name: 'Mais candidaturas (8 de 9)' })
  expect(within(details).queryByRole('link', { name: 'Projeto 9' })).toBeNull()
  fireEvent.click(more)
  expect(within(details).getByRole('link', { name: 'Projeto 9' })).toBeTruthy()
})

it.each([
  ['NO_OBJECTIVE_AREAS', 'Associe áreas temáticas aos objetivos para calcular o índice.'],
  ['NO_PREPARATION', 'Ainda não há candidaturas em preparação.'],
  ['UNAVAILABLE', 'Não foi possível calcular o índice para todas as candidaturas em preparação.'],
])('shows the %s state without a percentage', (state, message) => {
  const dashboard = alignmentDashboard({ state, total: 0, aligned: null, objectives: [], unmatched: null })
  render(<MemoryRouter><DashboardCharts dashboard={dashboard}/></MemoryRouter>)
  const chart = within(screen.getByRole('region', { name: 'Alinhamento estratégico' }))
  expect(chart.getByText(message)).toBeTruthy()
  expect(chart.queryByText(/\d\s?%/)).toBeNull()
})
