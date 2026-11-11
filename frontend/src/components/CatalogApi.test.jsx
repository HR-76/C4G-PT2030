import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ get: state.get, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }) } }))
import { centralOpportunitiesApi, platformCentralOpportunitiesApi } from '../api/api'

afterEach(() => vi.resetAllMocks())

it.each([
  [centralOpportunitiesApi, '/central-opportunities'],
  [platformCentralOpportunitiesApi, '/admin/central-opportunities'],
])('forwards catalog cancellation without adding a query parameter', async (api, root) => {
  const { signal } = new AbortController()
  state.get.mockResolvedValue({ data: { items: [] } })
  await api.list({ q: 'climate', cursor: 'next' }, signal)
  expect(state.get).toHaveBeenLastCalledWith(root, { params: { q: 'climate', cursor: 'next' }, signal })
  await api.get('opportunity', signal)
  expect(state.get).toHaveBeenLastCalledWith(`${root}/opportunity`, { signal })
})

it('preserves the legacy cursor shorthand for central catalog readers', async () => {
  state.get.mockResolvedValue({ data: { items: [] } })
  await centralOpportunitiesApi.list('next')
  expect(state.get).toHaveBeenLastCalledWith('/central-opportunities', { params: { cursor: 'next' } })
})
