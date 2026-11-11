import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const state = vi.hoisted(() => ({ result: {} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, organization: { id: 'org', displayName: 'Entidade' } }) }))
vi.mock('../hooks/useOrganizationDashboard', () => ({ default: () => state.result }))
import Dashboard from '../pages/Dashboard'

afterEach(cleanup)
const money = (total, missing = 0, count = 1) => ({ total, missing, count })
const metrics = (total, organizationBudget, totalBudget) => ({ total, organizationBudget, totalBudget })
const renderDashboard = states => {
  state.result = { dashboard: { report: { states }, applications: { total: 6, by_status: {}, submittedBudget: money('999999.00') }, budget: {}, opportunities: {} }, refresh: vi.fn() }
  return render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
}
const budgetCard = status => screen.getByRole('region', { name: 'Orçamentos por estado' }).querySelector(`li[data-status="${status}"]`)

it('recovers budgets by current state using exact authorized aggregates and links to the corresponding list', () => {
  renderDashboard({
    SUBMITTED: metrics(2, money('1234.56', 0, 2), money('4000.00', 0, 2)),
    APPROVED: metrics(1, money('25.25'), money('100.00')),
    IDENTIFIED: metrics(1, money('10.00'), money('20.00')),
  })
  const submitted = within(budgetCard('SUBMITTED')), approved = within(budgetCard('APPROVED'))
  expect(submitted.getByRole('link', { name: 'Submetida' }).getAttribute('href')).toBe('/candidaturas?status=SUBMITTED')
  expect(submitted.getByText('1 234,56 €', { exact: true })).toBeTruthy()
  expect(submitted.queryByText('4 000,00 €', { exact: true })).toBeNull()
  expect(approved.getByText('25,25 €', { exact: true })).toBeTruthy()
  expect(screen.queryByText('999 999,00 €')).toBeNull()
  expect(within(budgetCard('IDENTIFIED')).getByText('10,00 €')).toBeTruthy()
  expect(screen.getByText('Orçamentos registados nas candidaturas, agrupados pelo estado atual.')).toBeTruthy()
})

it('keeps the five primary states visible when no applications exist and omits unused additional states', () => {
  renderDashboard({})
  const section = screen.getByRole('region', { name: 'Orçamentos por estado' })
  for (const status of ['IDENTIFIED', 'PREPARATION', 'SUBMITTED', 'APPROVED', 'REJECTED']) {
    const row = within(budgetCard(status))
    expect(row.getByText('0', { exact: true })).toBeTruthy()
    expect(row.getAllByText('0,00 €', { exact: true })).toHaveLength(1)
  }
  expect(within(section).getByRole('link', { name: 'Reprovada' })).toBeTruthy()
  expect(budgetCard('INTENTION')).toBeNull(); expect(budgetCard('ARCHIVED')).toBeNull(); expect(budgetCard('CANCELLED')).toBeNull()
})

it('distinguishes unknown budgets, partial values and genuine zero without losing missing counts', () => {
  renderDashboard({
    SUBMITTED: metrics(3, money(null, 3, 3), money(null, 3, 3)),
    APPROVED: metrics(2, money('0.00', 1, 2), money('50.00', 1, 2)),
  })
  const submitted = within(budgetCard('SUBMITTED')), approved = within(budgetCard('APPROVED'))
  expect(submitted.getAllByText('Não disponível')).toHaveLength(1)
  expect(submitted.queryByText('0,00 €')).toBeNull()
  expect(submitted.getAllByText('3 sem valor')).toHaveLength(1)
  expect(approved.getByText('0,00 €')).toBeTruthy()
  expect(approved.getAllByText('1 sem valor')).toHaveLength(1)
})

it('preserves amounts beyond Number precision and displays existing archived and cancelled states', () => {
  renderDashboard({
    ARCHIVED: metrics(1, money('9007199254740993.01'), money('9999999999999999.99')),
    CANCELLED: metrics(1, money('1.00'), money('2.00')),
  })
  expect(within(budgetCard('ARCHIVED')).getByText('9 007 199 254 740 993,01 €')).toBeTruthy()
  expect(within(budgetCard('ARCHIVED')).queryByText('9 999 999 999 999 999,99 €')).toBeNull()
  expect(within(budgetCard('CANCELLED')).getByRole('link', { name: 'Cancelada' }).getAttribute('href')).toBe('/candidaturas?status=CANCELLED')
})

it('does not turn a missing aggregate into an empty budget summary', () => {
  renderDashboard(undefined)
  const section = screen.getByRole('region', { name: 'Orçamentos por estado' })
  expect(within(section).getByRole('status').textContent).toBe('Indicadores por estado indisponíveis.')
  expect(within(section).queryByText('0,00 €')).toBeNull()
})

it('does not turn a present but incomplete state into a zero budget', () => {
  renderDashboard({ APPROVED: { total: 1 }, SUBMITTED: null })
  for (const status of ['APPROVED', 'SUBMITTED']) {
    const row = within(budgetCard(status))
    expect(row.getAllByText('Não disponível')).toHaveLength(1)
    expect(row.queryByText('0,00 €')).toBeNull()
  }
  expect(within(budgetCard('SUBMITTED')).getByText('—')).toBeTruthy()
})
