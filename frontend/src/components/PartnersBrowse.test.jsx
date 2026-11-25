import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ browse: vi.fn(), auth: { user: { id: 'user' }, organization: { id: 'org', name: 'Organização' } } }))
vi.mock('../api/api', () => ({ privateApplicationsApi: { partnersBrowse: mocks.browse } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }))
import Partners from '../pages/Partners'
const partner = { id: 'p1', entity_name: 'Universidade Parceira', country: 'Portugal', people: [] }
const answer = (items = [partner]) => ({ data: { items, countries: ['Portugal'], total: items.length, nextCursor: null, previousCursor: null } })
const view = () => render(<MemoryRouter><Partners /></MemoryRouter>)
const settle = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
beforeEach(() => { vi.useFakeTimers(); mocks.browse.mockReset(); mocks.browse.mockResolvedValue(answer()) })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('asks for the partners at once when the page opens and when a filter other than the search changes', async () => {
  view(); await settle(0)
  expect(mocks.browse).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Ver ficha de Universidade Parceira' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('País'), { target: { value: 'Portugal' } }); await settle(0)
  expect(mocks.browse).toHaveBeenCalledTimes(2); expect(mocks.browse.mock.calls[1][0]).toEqual({ country: 'Portugal' })
})

it('waits before asking only while the search is being typed', async () => {
  view(); await settle(0)
  fireEvent.change(screen.getByLabelText('Pesquisar parceiros'), { target: { value: 'uni' } }); await settle(249)
  expect(mocks.browse).toHaveBeenCalledTimes(1)
  await settle(1)
  expect(mocks.browse).toHaveBeenCalledTimes(2); expect(mocks.browse.mock.calls[1][0]).toEqual({ q: 'uni' })
})

it('keeps the previous rows on screen, dimmed and inactive, until the new selection answers', async () => {
  view(); await settle(0)
  let finish; mocks.browse.mockReturnValue(new Promise(resolve => { finish = resolve }))
  fireEvent.change(screen.getByLabelText('País'), { target: { value: 'Portugal' } }); await settle(0)
  const body = screen.getByRole('button', { name: 'Ver ficha de Universidade Parceira' }).closest('tbody')
  expect(body.classList.contains('partners-stale')).toBe(true); expect(body.hasAttribute('inert')).toBe(true)
  await act(async () => { finish(answer([{ ...partner, id: 'p2', entity_name: 'Instituto Novo' }])); await vi.advanceTimersByTimeAsync(0) })
  expect(screen.queryByRole('button', { name: 'Ver ficha de Universidade Parceira' })).toBeNull()
  const fresh = screen.getByRole('button', { name: 'Ver ficha de Instituto Novo' }).closest('tbody')
  expect(fresh.hasAttribute('inert')).toBe(false)
})
