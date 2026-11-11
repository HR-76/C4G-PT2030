import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OpportunityListTable from './OpportunityListTable'
import { privateApplicationsApi as api } from '../../api/api'
vi.mock('../../api/api', () => ({ privateApplicationsApi: { opportunitySummaries: vi.fn() } }))
const row = (opportunityId, statuses = {}, applicationId = null) => ({ opportunityId, statuses, applicationId, count: Object.values(statuses).reduce((a, b) => a + b, 0) })
const response = items => ({ data: { items } })
const view = (organizationId = 'a', ids = ['one']) => <MemoryRouter><OpportunityListTable organizationId={organizationId} items={ids.map(opportunityId => ({ opportunityId, title: opportunityId }))} /></MemoryRouter>
afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())
it('cancels summary reads on page replacement and unmount', async () => {
  api.opportunitySummaries.mockReturnValue(new Promise(() => {}))
  const mounted = render(view('a', ['one']))
  const firstSignal = api.opportunitySummaries.mock.calls[0][1]
  expect(firstSignal).toBeInstanceOf(AbortSignal)
  expect(firstSignal.aborted).toBe(false)
  mounted.rerender(view('a', ['two']))
  expect(firstSignal.aborted).toBe(true)
  const activeSignal = api.opportunitySummaries.mock.lastCall[1]
  expect(activeSignal.aborted).toBe(false)
  mounted.unmount()
  expect(activeSignal.aborted).toBe(true)
})
it('makes one bounded request and shows none, one direct status or multiple status counts', async () => {
  api.opportunitySummaries.mockResolvedValue(response([row('one'), row('two', { PREPARATION: 1 }, 'app'), row('three', { IDENTIFIED: 2, ARCHIVED: 1 })]))
  render(view('a', ['one', 'two', 'three']))
  expect(await screen.findByText('Sem candidaturas visíveis')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Em preparação — candidatura de two' }).getAttribute('href')).toBe('/candidaturas/app')
  expect(screen.getByRole('link', { name: '3 candidaturas' }).getAttribute('href')).toBe('/candidaturas?oportunidade=three')
  expect(screen.getByText('2 Identificada').className).toContain('chip')
  expect(screen.getByText('1 Arquivada').className).toContain('chip')
  expect(api.opportunitySummaries).toHaveBeenCalledExactlyOnceWith(['one', 'two', 'three'], expect.any(AbortSignal))
})
it('never reports failure as zero and permits retry', async () => {
  api.opportunitySummaries.mockRejectedValueOnce(new Error('denied')).mockResolvedValue(response([row('one')]))
  render(view()); await screen.findByRole('alert')
  expect(screen.queryByText('Sem candidaturas visíveis')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Repetir consulta de candidaturas' }))
  expect(await screen.findByText('Sem candidaturas visíveis')).toBeTruthy()
})
it.each([[], [row('wrong')], [{ ...row('one'), count: 1 }], [row('one', { UNKNOWN: 1 }, 'app')]])('rejects incomplete or inconsistent summary %j', async items => {
  api.opportunitySummaries.mockResolvedValue(response(items))
  render(view()); await screen.findByRole('alert'); expect(screen.queryByText('Sem candidaturas visíveis')).toBeNull()
})
it.each([['b', ['one']], ['a', ['two']]])('discards late responses after organization/page change', async (org, ids) => {
  let finish
  api.opportunitySummaries.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue(response(ids.map(id => row(id))))
  const mounted = render(view()); expect(screen.getByText('A consultar…')).toBeTruthy()
  mounted.rerender(view(org, ids)); await screen.findByText('Sem candidaturas visíveis')
  finish(response([row('one', { IDENTIFIED: 1 }, 'private-old')]))
  await waitFor(() => expect(api.opportunitySummaries).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('link', { name: /Identificada/ })).toBeNull()
})
