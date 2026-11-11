import { readLogoutResult, clearLogoutResult } from '../api/logoutResult'
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
const transport = vi.hoisted(() => ({ responseError: null, get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ get: transport.get, post: transport.post,
  interceptors: { request: { use() {} }, response: { use(ok, error) { transport.responseError = error } } } }) } }))
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { cancelLogoutNavigation, isLogoutNavigationPending } from '../api/logoutNavigation'
let auth
function Probe() { auth = useAuth(); return <p>{auth.loading ? 'boundary pending' : auth.user ? 'signed in' : 'automatic login allowed'}</p> }
afterEach(() => { cleanup(); clearLogoutResult(); cancelLogoutNavigation(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('keeps automatic login and a residual 401 from replacing federated logout navigation', async () => {
  const assign = vi.fn()
  vi.stubGlobal('location', { pathname: '/candidaturas/example', assign })
  transport.get.mockResolvedValue({ data: { user: { id: 'synthetic' } } })
  let complete
  transport.post.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  render(<AuthProvider><Probe /></AuthProvider>); await screen.findByText('signed in')
  let pending
  act(() => { pending = auth.logout() })
  expect(screen.getByText('boundary pending')).toBeTruthy()
  const refusal = { response: { status: 401 } }
  await expect(transport.responseError(refusal)).rejects.toBe(refusal)
  expect(assign).not.toHaveBeenCalled()
  await act(async () => { complete({ data: { redirectUrl: 'https://idp.example.test/logout' } }); await pending })
  expect(screen.getByText('boundary pending')).toBeTruthy()
  expect(assign).toHaveBeenCalledExactlyOnceWith('https://idp.example.test/logout')
  expect(readLogoutResult()).toBe('complete')
})
it('a failed local request releases the navigation boundary without announcing logout', async () => {
  transport.get.mockResolvedValue({ data: { user: { id: 'synthetic' } } })
  transport.post.mockRejectedValue(new Error('local unavailable'))
  render(<AuthProvider><Probe /></AuthProvider>); await screen.findByText('signed in')
  await act(async () => { await expect(auth.logout()).rejects.toThrow('local unavailable') })
  expect(screen.getByText('signed in')).toBeTruthy()
  expect(isLogoutNavigationPending()).toBe(false)
  expect(readLogoutResult()).toBeNull()
})
it('degraded local revocation still owns the federated navigation without declaring completion', async () => {
  const assign = vi.fn(); vi.stubGlobal('location', { pathname: '/candidaturas/example', assign })
  transport.get.mockResolvedValue({ data: { user: { id: 'synthetic' } } })
  transport.post.mockRejectedValue({ response: { status: 503, data: { code: 'LOGOUT_INCOMPLETE', redirectUrl: 'https://idp.example.test/logout' } } })
  render(<AuthProvider><Probe /></AuthProvider>); await screen.findByText('signed in')
  await act(() => auth.logout())
  expect(screen.getByText('boundary pending')).toBeTruthy()
  expect(assign).toHaveBeenCalledExactlyOnceWith('https://idp.example.test/logout')
  expect(readLogoutResult()).toBe('incomplete')
})
it('ordinary 401 outside logout retains the login redirect', async () => {
  const assign = vi.fn(); vi.stubGlobal('location', { pathname: '/candidaturas/example', assign })
  const refusal = { response: { status: 401 } }
  await expect(transport.responseError(refusal)).rejects.toBe(refusal)
  expect(assign).toHaveBeenCalledExactlyOnceWith('/login')
})

it('provider preparation failure is displayed as incomplete even after local revocation succeeds',async()=>{
 const assign=vi.fn();vi.stubGlobal('location',{pathname:'/dashboard',assign})
 transport.get.mockResolvedValue({data:{user:{id:'synthetic'}}})
 transport.post.mockResolvedValue({data:{redirectUrl:'/login',identityLogoutUnavailable:true}})
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('signed in')
 await act(()=>auth.logout());expect(readLogoutResult()).toBe('incomplete');expect(assign).toHaveBeenCalledWith('/login')
})
