import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DirectLogin from './DirectLogin'
afterEach(() => { cleanup(); window.sessionStorage.clear() })
it('does not automatically restart a cancelled authentication', () => {
  window.history.replaceState(null, '', '/login?authentication=cancelled')
  try {
    const openLogin = vi.fn()
    render(<DirectLogin openLogin={openLogin} />)
    expect(openLogin).not.toHaveBeenCalled()
    // Reported on 16/11/2026: the link looked like the sentence around it, so nobody saw it could be pressed.
    expect(screen.getByRole('link', { name: 'Voltar a entrar' }).classList.contains('btn-primary')).toBe(true)
  } finally { window.history.replaceState(null, '', '/') }
})
// Requested on 16/11/2026: an expired attempt reopens the login by itself, once.
it('reopens the login once for an expired authentication, also under StrictMode', () => {
  window.history.replaceState(null, '', '/login?authentication=expired')
  try {
    const openLogin = vi.fn()
    const view = render(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    view.rerender(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    expect(openLogin).toHaveBeenCalledExactlyOnceWith('/api/auth/oidc/login?returnTo=%2F')
    expect(screen.getByRole('status').textContent).toContain('A abrir o login C4G…')
    expect(screen.queryByRole('link', { name: 'Voltar a entrar' })).toBeNull()
  } finally { window.history.replaceState(null, '', '/') }
})
it('stops at a visible button when the attempt expires again right after the automatic retry', () => {
  window.history.replaceState(null, '', '/login?authentication=expired')
  try {
    render(<DirectLogin openLogin={vi.fn()} />)
    cleanup()
    const openLogin = vi.fn()
    const view = render(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    view.rerender(<StrictMode><DirectLogin openLogin={openLogin} /></StrictMode>)
    expect(openLogin).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Esta tentativa de autenticação terminou.')
    const link = screen.getByRole('link', { name: 'Voltar a entrar' })
    expect(link.getAttribute('href')).toBe('/api/auth/oidc/login?returnTo=%2F')
    expect(link.classList.contains('btn-primary')).toBe(true)
  } finally { window.history.replaceState(null, '', '/') }
})
it('retries automatically again once the previous automatic retry is old', () => {
  window.history.replaceState(null, '', '/login?authentication=expired')
  try {
    window.sessionStorage.setItem('c4g.login.expiredRetryAt', String(Date.now() - 121000))
    const openLogin = vi.fn()
    render(<DirectLogin openLogin={openLogin} />)
    expect(openLogin).toHaveBeenCalledTimes(1)
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
  expect(screen.getByRole('link',{name:'Tentar novamente'}).classList.contains('btn-primary')).toBe(true)
})

it('preserves organization-bound application destination in the OIDC request',()=>{
 const target='/candidaturas/00000000-0000-4000-8000-000000000002?organizacao=00000000-0000-4000-8000-000000000001'
 const openLogin=vi.fn();render(<DirectLogin openLogin={openLogin} returnTo={target}/>)
 expect(openLogin).toHaveBeenCalledWith(`/api/auth/oidc/login?returnTo=${encodeURIComponent(target)}`)
})
// Requested on 14/11/2026: entering the app without a session shows the shared loader, not a bare sentence.
it('shows the shared loader while the login opens, and plain messages for the other states', () => {
  window.history.replaceState({}, '', '/')
  const view = render(<DirectLogin openLogin={vi.fn()}/>)
  const status = screen.getByRole('status')
  expect(status.classList.contains('loading-indicator')).toBe(true)
  expect(status.classList.contains('page-loading')).toBe(true)
  expect(status.querySelector('svg.loading-indicator-icon')).toBeTruthy()
  expect(status.textContent).toContain('A abrir o login C4G…')
  expect(view.container.querySelector('p')).toBeNull()
  view.unmount()
  render(<DirectLogin openLogin={() => { throw new Error('blocked') }}/>)
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir o login.')
  expect(document.querySelector('.loading-indicator')).toBeNull()
})
