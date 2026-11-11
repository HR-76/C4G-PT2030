import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DirectLogin from './DirectLogin'
afterEach(cleanup)
it('does not automatically restart a cancelled authentication', () => {
  window.history.replaceState(null, '', '/login?authentication=cancelled')
  try {
    const openLogin = vi.fn()
    render(<DirectLogin openLogin={openLogin} />)
    expect(openLogin).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Voltar a entrar' })).toBeTruthy()
  } finally { window.history.replaceState(null, '', '/') }
})
it('offers an explicit retry for an expired authentication without restarting under StrictMode', () => {
  window.history.replaceState(null, '', '/login?authentication=expired')
  try {
    const openLogin = vi.fn()
    const view = render(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    view.rerender(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    expect(openLogin).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Esta tentativa de autenticação terminou.')
    expect(screen.getByRole('link', { name: 'Voltar a entrar' }).getAttribute('href')).toBe('/api/auth/oidc/login?returnTo=%2F')
  } finally { window.history.replaceState(null, '', '/') }
})
it('starts login normally for an unknown authentication status', () => {
  window.history.replaceState(null, '', '/login?authentication=unknown')
  try {
    const openLogin = vi.fn()
    render(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    expect(openLogin).toHaveBeenCalledExactlyOnceWith('/api/auth/oidc/login?returnTo=%2F')
    expect(screen.queryByRole('link', { name: 'Voltar a entrar' })).toBeNull()
  } finally { window.history.replaceState(null, '', '/') }
})
it('preserves a protected internal destination', () => {
  const openLogin=vi.fn()
  render(<DirectLogin openLogin={openLogin} returnTo="/conta/seguranca?tab=mfa#settings"/>)
  expect(openLogin).toHaveBeenCalledWith('/api/auth/oidc/login?returnTo=%2Fconta%2Fseguranca%3Ftab%3Dmfa%23settings')
})
it.each(['https://outside.invalid','//outside.invalid','/\\outside.invalid','/\n/outside.invalid'])('refuses unsafe return path %j', returnTo => {
  const openLogin=vi.fn()
  render(<DirectLogin openLogin={openLogin} returnTo={returnTo}/>)
  expect(openLogin).toHaveBeenCalledWith('/api/auth/oidc/login?returnTo=%2F')
})
it('starts one OIDC transaction under StrictMode without an intermediate button', () => {
  const openLogin=vi.fn()
  const view=render(<StrictMode><DirectLogin openLogin={openLogin}/></StrictMode>)
  view.rerender(<StrictMode><DirectLogin openLogin={openLogin}/></StrictMode>)
  expect(openLogin).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
it('offers explicit retry if navigation fails instead of automatically retrying', () => {
  const openLogin=vi.fn(()=>{throw Error('navigation unavailable')})
  render(<StrictMode><DirectLogin openLogin={openLogin}/></StrictMode>)
  expect(openLogin).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByRole('link',{name:'Tentar novamente'}).getAttribute('href')).toBe('/api/auth/oidc/login?returnTo=%2F')
})

it('preserves organization-bound application destination in the OIDC request',()=>{
 const target='/candidaturas/00000000-0000-4000-8000-000000000002?organizacao=00000000-0000-4000-8000-000000000001'
 const openLogin=vi.fn();render(<DirectLogin openLogin={openLogin} returnTo={target}/>)
 expect(openLogin).toHaveBeenCalledWith(`/api/auth/oidc/login?returnTo=${encodeURIComponent(target)}`)
})
