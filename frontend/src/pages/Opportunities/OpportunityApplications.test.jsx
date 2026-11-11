import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OpportunityApplications from './OpportunityApplications'
import { privateApplicationsApi as api } from '../../api/api'
vi.mock('../../api/api', () => ({ privateApplicationsApi: { list: vi.fn() } }))
const response = (items = [], nextCursor = null) => ({ data: { items, nextCursor } })
const item = (applicationId, title) => ({ applicationId, title, status: 'PREPARATION', deadline: '2027-01-31' })
const view = (organizationId = 'a', opportunityId = 'op') => <MemoryRouter><OpportunityApplications organizationId={organizationId} opportunityId={opportunityId} /></MemoryRouter>
afterEach(cleanup)
beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue(response()) })

it('distinguishes permission failure from empty results and allows retry', async () => {
  api.list.mockRejectedValueOnce({ response: { status: 403 } })
  render(view()); await screen.findByRole('alert')
  expect(screen.queryByText('Sem candidaturas associadas nesta organização.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Repetir consulta de candidaturas' }))
  expect(await screen.findByText('Sem candidaturas associadas nesta organização.')).toBeTruthy()
  expect(api.list).toHaveBeenLastCalledWith({ opportunityId: 'op' })
})
it('paginates authorized applications without duplicating entries', async () => {
  const first = item('one', 'Candidatura A'), second = item('two', 'Candidatura B')
  api.list.mockResolvedValueOnce(response([first], 'next')).mockResolvedValueOnce(response([first, second]))
  render(view()); await screen.findByText('Candidatura A')
  fireEvent.click(screen.getByRole('button', { name: 'Mais candidaturas' }))
  expect(await screen.findByText('Candidatura B')).toBeTruthy()
  expect(screen.getAllByText('Candidatura A')).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Candidatura A' }).getAttribute('href')).toBe('/candidaturas/one')
  expect(api.list).toHaveBeenLastCalledWith({ opportunityId: 'op', cursor: 'next' })
})
it.each([['b', 'op'], ['a', 'other']])('discards visible and delayed data after context changes to %s/%s', async (organization, opportunity) => {
  let finish
  api.list.mockResolvedValueOnce(response([item('old', 'Privada A')], 'next'))
    .mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const mounted = render(view()); await screen.findByText('Privada A')
  fireEvent.click(screen.getByRole('button', { name: 'Mais candidaturas' }))
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  mounted.rerender(view(organization, opportunity))
  expect(screen.queryByText('Privada A')).toBeNull()
  await screen.findByText('Sem candidaturas associadas nesta organização.')
  await act(async () => finish(response([item('late', 'Resposta antiga')])) )
  expect(screen.queryByText('Resposta antiga')).toBeNull()
  expect(api.list).toHaveBeenLastCalledWith({ opportunityId: opportunity })
})
