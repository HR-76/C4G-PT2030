import React from 'react'
import { afterEach, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import AccountSecurity from '../pages/AccountSecurity'
const load = vi.hoisted(() => vi.fn())
const change = vi.hoisted(() => vi.fn())
vi.mock('../api/api', () => ({ authApi: { accountSecurity: load, emailVerification: change } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it.each([undefined, {available:true,enabled:true}, {available:false,reauthenticationRequired:true}])('removes email verification while preserving native security management (%j)', async emailVerification => {
  load.mockResolvedValue({data:{mfaOptional:true,emailVerification}})
  render(<AccountSecurity />)
  expect(await screen.findByRole('heading',{name:'Aplicação autenticadora'})).toBeTruthy()
  expect(screen.getByRole('link',{name:'Gerir aplicação autenticadora'}).getAttribute('href')).toBe('/api/auth/account')
  expect(screen.getByRole('link',{name:'Gerir palavra-passe'})).toBeTruthy()
  expect(screen.queryByText('Verificação adicional por email')).toBeNull()
  expect(screen.queryByRole('button',{name:/verificação por email/})).toBeNull()
  expect(change).not.toHaveBeenCalled()
})
it('expired account token requires explicit login instead of assuming disabled or looping', async () => {
  load.mockRejectedValue({ response: { data: { code: 'ACCOUNT_REAUTH_REQUIRED' } } })
  render(<AccountSecurity />)
  expect(await screen.findByRole('link', { name: 'Confirmar sessão' })).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
it('preserves enhanced authentication outside documentary review', async () => {
  load.mockResolvedValue({ data: { mfaOptional: false } })
  render(<AccountSecurity />)
  expect(await screen.findByText(/operações fora da revisão documental/)).toBeTruthy()
  expect(screen.getByText(/sem exigir um código adicional para decidir/)).toBeTruthy()
  expect(screen.queryByText('Opcional')).toBeNull()
})
it('does not invent security state when settings fail to load', async () => {
  load.mockRejectedValue(new Error('unavailable'))
  render(<AccountSecurity />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
})
it('shows provider consultation rather than inventing password or authenticator status', async () => {
  load.mockResolvedValue({ data: { mfaOptional: true, emailVerification: {available:true,enabled:false} } })
  render(<AccountSecurity />)
  await screen.findByRole('heading',{name:'Palavra-passe'})
  expect(screen.getAllByText('Consultar no fornecedor')).toHaveLength(2)
  expect(screen.getByRole('link',{name:'Gerir palavra-passe'}).getAttribute('href')).toBe('/api/auth/account')
  expect(screen.queryByText('Ativa')).toBeNull()
})
