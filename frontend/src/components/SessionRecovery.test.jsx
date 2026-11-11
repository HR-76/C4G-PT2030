import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { authApi } from '../api/api'

vi.mock('../api/api', () => ({ authApi: { me: vi.fn() }, clearCsrfToken: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
function Content() {
  const { user, loading } = useAuth()
  return <p>{loading ? 'Validating' : user ? 'Protected content' : 'Login required'}</p>
}
test.each([new Error('network'), { response: { status: 503 } }, { code: 'ECONNABORTED' }])('temporary session failure offers retry without logging out', async error => {
  authApi.me.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: { user: { id: 'user' }, organization: { id: 'org' } } })
  render(<AuthProvider><Content /></AuthProvider>)
  const retry = await screen.findByRole('button', { name: 'Tentar novamente' })
  expect(screen.queryByText('Login required')).toBeNull()
  expect(screen.queryByText('Protected content')).toBeNull()
  fireEvent.click(retry)
  await screen.findByText('Protected content')
  expect(authApi.me).toHaveBeenCalledTimes(2)
})
test('401 preserves the unauthenticated flow', async () => {
  authApi.me.mockRejectedValueOnce({ response: { status: 401 } })
  render(<AuthProvider><Content /></AuthProvider>)
  await screen.findByText('Login required')
  expect(screen.queryByRole('alert')).toBeNull()
})
test('unmount cancels initial session validation', async () => {
  authApi.me.mockImplementation(() => new Promise(() => {}))
  const view = render(<AuthProvider><Content /></AuthProvider>)
  await waitFor(() => expect(authApi.me).toHaveBeenCalledOnce())
  const signal = authApi.me.mock.calls[0][0]?.signal
  view.unmount()
  expect(signal?.aborted).toBe(true)
})
