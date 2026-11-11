import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import routePage from './RoutePage'

const state = vi.hoisted(() => ({ auth: {} }))
vi.mock('../contexts/AuthContext', () => ({ AuthProvider: ({ children }) => children, useAuth: () => state.auth }))
vi.mock('./Layout/Layout', () => ({ default: () => <Outlet /> }))
vi.mock('./DirectLogin', () => ({ default: ({ returnTo }) => <p>Login: {returnTo}</p> }))
vi.mock('../pages/Dashboard', () => ({ default: () => <h1>Dashboard autorizado</h1> }))
vi.mock('../pages/Opportunities/CentralOpportunities', () => ({ default: () => <h1>Catálogo autorizado</h1> }))
vi.mock('../pages/Organization/OrganizationProfile', () => ({ default: () => <h1>Perfil da entidade</h1> }))
vi.mock('../pages/Organization/PersonalProfile', () => ({ default: () => <h1>Perfil da pessoa</h1> }))
vi.mock('../pages/Editorial/EditorialProfile', () => ({ default: () => <><h1>Perfil editorial</h1><Link to="/publicacao-perfil/revisao?version=2#dados">Publicação</Link></> }))
vi.mock('../pages/Pq1/Pq1Profile', () => ({ default: () => <h1>Publicação do perfil</h1> }))
vi.mock('../pages/Platform/PlatformDashboard', () => ({ default: () => <h1>Administração C4G</h1> }))
vi.mock('../pages/Organization/EntityAdmission', () => ({ default: () => <h1>Adesão limitada</h1> }))
import App from '../App'

function NavigationProbe() {
  const location = useLocation(), navigate = useNavigate()
  return <><output aria-label="Localização">{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate(-1)}>Voltar</button></>
}
beforeEach(() => {
  state.auth = { user: { id: 'user', platformRoles: [] }, organization: { id: 'org' }, loading: false }
})
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })
function mount(path) {
  window.history.replaceState(null, '', path)
  return render(<BrowserRouter><NavigationProbe /><App /></BrowserRouter>)
}

it.each([
  ['/perfil-organizacao', 'Perfil da entidade'],
  ['/perfil-organizacao/unidades', 'Perfil da entidade'],
  ['/perfil-organizacao/pessoas/member', 'Perfil da pessoa'],
  ['/perfil-organizacao/competencias/detalhe', 'Perfil editorial'],
  ['/publicacao-perfil/revisao/detalhe', 'Publicação do perfil'],
])('preserves real App route precedence and splats at %s', async (path, title) => {
  mount(path)
  expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
  expect(screen.getByLabelText('Localização').textContent).toBe(path)
})

it('preserves absolute links, query/hash and browser back from a splat route', async () => {
  mount('/perfil-organizacao/competencias?tab=active#origem')
  fireEvent.click(await screen.findByRole('link', { name: 'Publicação' }))
  expect(await screen.findByRole('heading', { name: 'Publicação do perfil' })).toBeTruthy()
  expect(screen.getByLabelText('Localização').textContent).toBe('/publicacao-perfil/revisao?version=2#dados')
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  await screen.findByRole('heading', { name: 'Perfil editorial' })
  expect(screen.getByLabelText('Localização').textContent).toBe('/perfil-organizacao/competencias?tab=active#origem')
})

it('redirects anonymous deep links to login retaining the internal destination', async () => {
  state.auth.user = null
  mount('/catalogo/opportunity?q=water#descricao')
  expect(await screen.findByText('Login: /catalogo/opportunity?q=water#descricao')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Catálogo autorizado' })).toBeNull()
})

it('denies platform pages to ordinary members and admits the platform assignment', async () => {
  const view = mount('/administracao/dashboard')
  expect(await screen.findByRole('heading', { name: 'Dashboard autorizado' })).toBeTruthy()
  expect(screen.getByLabelText('Localização').textContent).toBe('/dashboard')
  expect(screen.queryByRole('heading', { name: 'Administração C4G' })).toBeNull()
  view.unmount()
  state.auth.user.platformRoles = ['C4G_ADMIN']; state.auth.organization = null
  mount('/administracao/dashboard')
  expect(await screen.findByRole('heading', { name: 'Administração C4G' })).toBeTruthy()
})

it('keeps limited admission outside protected catalogue pages', async () => {
  state.auth.admissions = { limited: true, items: [{ id: 'invitation' }] }
  mount('/catalogo')
  expect(await screen.findByRole('heading', { name: 'Adesão limitada' })).toBeTruthy()
  expect(screen.getByLabelText('Localização').textContent).toBe('/adesao/invitation')
  expect(screen.queryByRole('heading', { name: 'Catálogo autorizado' })).toBeNull()
})

it('finishes a lazy navigation under router transitions without recreating the loader', async () => {
  let resolve
  const load = vi.fn(() => new Promise(done => { resolve = done }))
  const Page = routePage(load)
  render(<BrowserRouter><Routes><Route path="/" element={<Link to="/lazy">Abrir</Link>} /><Route path="/lazy" element={<Page />} /></Routes></BrowserRouter>)
  fireEvent.click(screen.getByRole('link', { name: 'Abrir' }))
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  await act(async () => resolve({ default: () => <h1>Página carregada</h1> }))
  expect(await screen.findByRole('heading', { name: 'Página carregada' })).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(1)
})

it('retains organization-bound application email destination through the real protected route',async()=>{
 state.auth.user=null
 const destination='/candidaturas/00000000-0000-4000-8000-000000000002?organizacao=00000000-0000-4000-8000-000000000001'
 mount(destination)
 expect(await screen.findByText(`Login: ${destination}`)).toBeTruthy()
})
