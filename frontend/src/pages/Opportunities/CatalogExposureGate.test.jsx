import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import CatalogExposureGate from './CatalogExposureGate'
vi.mock('../../api/api', () => ({ catalogReadApi: vi.fn() }))
vi.mock('./catalogReadSession', () => ({ clearCatalogSessions: vi.fn() }))
afterEach(() => { cleanup(); vi.useRealTimers() })
const allowed = () => ({ version: 'gcni-catalog-exposure/1.0', available: true, revision: 1, validUntil: new Date(Date.now() + 30000).toISOString() })
it('keeps polling unchanged availability without re-rendering protected content', async () => {
  vi.useFakeTimers()
  const api = vi.fn().mockImplementation(async () => allowed()), commits = vi.fn()
  render(<CatalogExposureGate scope="admin" api={api}><React.Profiler id="content" onRender={commits}><p>Protected opportunity</p></React.Profiler></CatalogExposureGate>)
  await act(async () => { await Promise.resolve() })
  expect(screen.getByText('Protected opportunity')).toBeTruthy()
  const count = commits.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(api).toHaveBeenCalledTimes(2)
  expect(commits).toHaveBeenCalledTimes(count)
})
it('keeps content hidden until authorized and removes it when availability fails', async () => {
  vi.useFakeTimers()
  const api = vi.fn().mockResolvedValueOnce(allowed()).mockRejectedValue(new Error('closed'))
  render(<CatalogExposureGate scope="admin" api={api}><p>Protected opportunity</p></CatalogExposureGate>)
  expect(screen.queryByText('Protected opportunity')).toBeNull()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByText('Protected opportunity')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.queryByText('Protected opportunity')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Catálogo temporariamente indisponível' })).toBeTruthy()
})
it('expires visible content even if the next network check never completes', async () => {
  vi.useFakeTimers()
  const api = vi.fn().mockResolvedValueOnce(allowed()).mockImplementation(() => new Promise(() => {}))
  render(<CatalogExposureGate scope="admin" api={api}><p>Protected opportunity</p></CatalogExposureGate>)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(30001) })
  expect(screen.queryByText('Protected opportunity')).toBeNull()
})
it('ignores a late availability response after scope changes', async () => {
  let resolve
  const api = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r })).mockRejectedValue(new Error('denied'))
  const view = render(<CatalogExposureGate scope="old" api={api}><p>Protected opportunity</p></CatalogExposureGate>)
  view.rerender(<CatalogExposureGate scope="new" api={api}><p>Protected opportunity</p></CatalogExposureGate>)
  await act(async () => { resolve(allowed()); await Promise.resolve() })
  expect(screen.queryByText('Protected opportunity')).toBeNull()
})

it('hides an already visible old scope immediately while the new scope is checked', async () => {
  const api = vi.fn().mockResolvedValueOnce(allowed()).mockImplementation(() => new Promise(() => {}))
  const view = render(<CatalogExposureGate scope="old" api={api}><p>Protected opportunity</p></CatalogExposureGate>)
  await act(async () => { await Promise.resolve() })
  expect(screen.getByText('Protected opportunity')).toBeTruthy()
  view.rerender(<CatalogExposureGate scope="new" api={api}><p>Protected opportunity</p></CatalogExposureGate>)
  expect(screen.queryByText('Protected opportunity')).toBeNull()
})
