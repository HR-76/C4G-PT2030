import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import ConnectionNotice from './ConnectionNotice'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('reports offline and clears the notice on reconnect without sending a request', () => {
  let online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  const fetch = vi.spyOn(window, 'fetch')
  render(<ConnectionNotice />)
  expect(screen.queryByRole('status')).toBeNull()
  online = false
  act(() => window.dispatchEvent(new Event('offline')))
  expect(screen.getByRole('status').textContent).toContain('não são repetidos automaticamente')
  online = true
  act(() => window.dispatchEvent(new Event('online')))
  expect(screen.queryByRole('status')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
