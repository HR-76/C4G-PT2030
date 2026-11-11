import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OpportunityApplicationCount from './OpportunityApplicationCount'
const api = vi.hoisted(() => ({ opportunitySummaries: vi.fn() }))
vi.mock('../../api/api', () => ({ privateApplicationsApi: api }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const view = organizationId => <MemoryRouter><OpportunityApplicationCount opportunityId="opp" organizationId={organizationId} /></MemoryRouter>
it('never queries private summaries without an organization', () => {
  render(view(null))
  expect(screen.getByText('Sem organização ativa')).toBeTruthy()
  expect(api.opportunitySummaries).not.toHaveBeenCalled()
})
it('distinguishes refusal from zero and retries an authorized count', async () => {
  api.opportunitySummaries.mockRejectedValueOnce(new Error('Forbidden')).mockResolvedValueOnce({ data: { items: [{ opportunityId: 'opp', count: 0 }] } })
  render(view('a'))
  fireEvent.click(await screen.findByRole('button', { name: 'Repetir contagem' }))
  expect((await screen.findByRole('link', { name: '0 candidaturas acessíveis nesta organização' })).getAttribute('href')).toBe('/candidaturas?oportunidade=opp')
})
it('discards an old organization response and rejects a different opportunity', async () => {
  let resolve
  api.opportunitySummaries.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValueOnce({ data: { items: [{ opportunityId: 'other', count: 7 }] } })
  const mounted = render(view('a')); mounted.rerender(view('b'))
  await screen.findByText('Indisponível')
  await act(async () => resolve({ data: { items: [{ opportunityId: 'opp', count: 99 }] } }))
  expect(screen.queryByRole('link')).toBeNull()
})
it('aborts an obsolete request without showing an error or applying its response', async () => {
  let oldSignal
  api.opportunitySummaries.mockImplementationOnce((_,signal)=>{
    oldSignal=signal
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Canceled'),{code:'ERR_CANCELED'})),{once:true}))
  }).mockResolvedValueOnce({ data: { items: [{ opportunityId: 'opp', count: 2 }] } })
  const mounted=render(view('a'))
  mounted.rerender(view('b'))
  expect(oldSignal.aborted).toBe(true)
  expect((await screen.findByRole('link',{name:'2 candidaturas acessíveis nesta organização'})).getAttribute('href')).toBe('/candidaturas?oportunidade=opp')
  expect(screen.queryByText('Indisponível')).toBeNull()
})
