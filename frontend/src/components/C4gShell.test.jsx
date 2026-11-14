import React from 'react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import Sidebar from './Layout/Sidebar'
import Layout from './Layout/Layout'

const state = vi.hoisted(() => ({ auth: {}, directory: true, access: true }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => state.auth }))
vi.mock('../api/api', () => ({ organizationDirectoryApi: () => ({context: () => state.directory ? Promise.resolve({data:{permissions:{units:true}}}) : Promise.reject({response:{status:403}}), access: () => state.access ? Promise.resolve({data:{items:[]}}) : Promise.reject({response:{status:403}})}), customerBillingApi: () => ({access: vi.fn().mockResolvedValue({data:{canRead:false}})}), organizationNotificationsApi: { refresh: vi.fn().mockResolvedValue({}), list: vi.fn().mockResolvedValue({ data: { items: [], unread_count: 0 } }) } }))
vi.mock('./OrganizationSelector', () => ({ default: () => <span>Entidade: Entidade A</span> }))
beforeEach(() => {
  state.directory = true; state.access = true
  state.auth = { user: { id: 'one', name: 'Gestor', platformRoles: [] }, organization: { id: 'a' }, isAdmin: false, logout: vi.fn() }
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
it('hides denied organization pages in navigation and search', async () => {
  state.directory = false; state.access = false
  HTMLDialogElement.prototype.showModal = function(){this.open=true}
  HTMLDialogElement.prototype.close = function(){this.open=false}
  render(<MemoryRouter><Routes><Route element={<Layout/>}><Route path="/" element={<p>Conteúdo</p>}/></Route></Routes></MemoryRouter>)
  await waitFor(() => expect(screen.queryByRole('region',{name:'Organização'})).toBeNull())
  fireEvent.click(screen.getByRole('button',{name:'Pesquisar páginas'}))
  fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar páginas'}),{target:{value:'organização'}})
  expect(screen.queryByRole('link',{name:'Perfil da organização'})).toBeNull()
  expect(screen.getByText('Nenhuma página encontrada.')).toBeTruthy()
})
afterEach(cleanup)
const sidebar = () => render(<MemoryRouter><Sidebar /></MemoryRouter>)
it('labels sign out visibly and preserves the existing logout action', () => {
  sidebar()
  const exit = screen.getByRole('button', { name: 'Sair', exact: true })
  expect(exit.textContent).toBe('Sair')
  expect(exit.getAttribute('type')).toBe('button')
  expect(exit.classList.contains('btn-logout')).toBe(true)
  fireEvent.click(exit)
  expect(state.auth.logout).toHaveBeenCalledTimes(1)
})
it.each([
  ['/perfil-organizacao', 'Perfil da organização'],
  ['/perfil-organizacao/unidades', 'Departamentos / Unidades'],
  ['/perfil-organizacao/pessoas', 'Pessoas'],
])('marks only the current organization section at %s', (path, name) => {
  render(<MemoryRouter initialEntries={[path]}><Sidebar /></MemoryRouter>)
  const current = screen.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page')
  expect(current).toHaveLength(1)
  expect(current[0]).toBe(screen.getByRole('link', { name, exact: true }))
})
it('keeps catalog, matching and import discoverable without granting platform administration', () => {
  sidebar()
  expect(screen.getByRole('link', { name: 'Oportunidades' }).getAttribute('href')).toBe('/catalogo')
  expect(screen.getByRole('link', { name: /Matching/ }).textContent).not.toContain('Em integração')
  expect(screen.queryByRole('link', { name: 'Importar oportunidades' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Importar Portugal 2030' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Plataforma C4G' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Fontes de oportunidades' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Entidades e utilizadores' })).toBeNull()
})
it('does not use an application role to expose central source administration', () => {
  state.auth.user.role = 'ADMIN'; state.auth.isAdmin = true
  sidebar()
  expect(screen.queryByRole('link', { name: 'Fontes de oportunidades' })).toBeNull()
})
it('exposes central administration only for the platform assignment', () => {
  state.auth.user.platformRoles = ['C4G_ADMIN']; state.auth.isAdmin = true
  sidebar()
  expect(screen.getByRole('region', { name: 'Plataforma C4G' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Fontes de oportunidades' }).getAttribute('href')).toBe('/integracoes')
  expect(screen.getByRole('link', { name: 'Entidades e utilizadores' }).getAttribute('href')).toBe('/administracao/entidades')
})
function page(path, child) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<Layout />}><Route path="*" element={child} /></Route></Routes></MemoryRouter>)
}
it('opens the C4G directory without a private organization membership', () => {
  state.auth.user.platformRoles = ['C4G_ADMIN']; state.auth.organization = null
  page('/administracao/entidades', <p>Directory content</p>)
  expect(screen.getByText('Directory content')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Área da organização' })).toBeNull()
})
it('mounts the organization alerts route', () => {
  state.auth.isAdmin = true
  page('/notificacoes', <p>Organization alerts</p>)
  expect(screen.getByText('Organization alerts')).toBeTruthy()
  expect(screen.getByText('Entidade: Entidade A')).toBeTruthy()
})
it('preserves catalog and matching route content', () => {
  const view = page('/catalogo', <p>Central catalog content</p>)
  expect(screen.getByText('Central catalog content')).toBeTruthy()
  view.unmount()
  page('/matching', <p>Matching da organização</p>)
  expect(screen.getByText('Matching da organização')).toBeTruthy()
})
it('keeps platform-only navigation free of private organization routes', () => {
  state.auth.user.platformRoles = ['C4G_ADMIN']; state.auth.organization = null
  sidebar()
  expect(screen.getByRole('link', { name: 'Oportunidades' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Fontes de oportunidades' })).toBeTruthy()
  for (const name of ['Oportunidades privadas', 'Candidaturas', 'Perfil da organização']) expect(screen.queryByRole('link', { name })).toBeNull()
})
it('does not mount private pages without an active organization and provides a way back', () => {
  state.auth.user.platformRoles = ['C4G_ADMIN']; state.auth.organization = null
  page('/candidaturas', <p>Private data</p>)
  expect(screen.queryByText('Private data')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Área da organização' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Consultar catálogo C4G' })).toBeTruthy()
})
it('can reclaim desktop workspace and reopen navigation without hiding the content', () => {
  page('/catalogo', <p>Catalog</p>)
  fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }))
  expect(document.querySelector('.sidebar').hasAttribute('inert')).toBe(true)
  expect(document.querySelector('.app-shell').classList.contains('sidebar-collapsed')).toBe(true)
  expect(screen.getByText('Catalog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
  expect(document.querySelector('.sidebar').hasAttribute('inert')).toBe(false)
})
it('opens mobile navigation as a keyboard-accessible dialog', () => {
  window.matchMedia = vi.fn(query => ({ matches: query === '(max-width: 768px)', addEventListener() {}, removeEventListener() {} }))
  page('/catalogo', <p>Catalog</p>)
  const trigger = screen.getByRole('button', { name: 'Abrir menu' })
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Navegação principal' })
  expect(document.activeElement.textContent).toBe('Fechar menu')
  expect(document.querySelector('.main-area').hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('mounts the recovered partner route in the organization shell',()=>{ page('/parceiros',<p>Parceiros atuais</p>);expect(screen.getByText('Parceiros atuais')).toBeTruthy();expect(screen.queryByText('Em integração')).toBeNull() })

it('confines manual opportunity authoring to C4G and removes private creation navigation', () => {
  const first=sidebar()
  expect(screen.queryByRole('link',{name:'Oportunidades privadas'})).toBeNull()
  expect(screen.queryByRole('link',{name:'Criar oportunidade'})).toBeNull()
  first.unmount();state.auth.user.platformRoles=['C4G_ADMIN'];state.auth.organization=null;sidebar()
  expect(screen.getByRole('link',{name:'Criar oportunidade'}).getAttribute('href')).toBe('/administracao/oportunidades/nova')
})

it('renders manual opportunity authoring in the shell without a client membership',()=>{
 state.auth.user.platformRoles=['C4G_ADMIN'];state.auth.organization=null
 page('/administracao/oportunidades/nova',<p>Manual central form</p>)
 expect(screen.getByText('Manual central form')).toBeTruthy()
 expect(screen.queryByRole('heading',{name:'Área da organização'})).toBeNull()
})
it('returns focus to the original action when a filtered list finishes loading', async () => {
  function List() {
    const [ready, setReady] = React.useState(false)
    React.useEffect(() => {
      const timer = setTimeout(() => setReady(true), 10)
      return () => clearTimeout(timer)
    }, [])
    return ready && <div>
      <Link to="/candidaturas/one">Título</Link>
      <Link to="/candidaturas/one" aria-label="Abrir candidatura Um">Abrir</Link>
    </div>
  }
  render(<MemoryRouter initialEntries={['/candidaturas?status=IDENTIFIED']}>
    <Routes><Route element={<Layout/>}>
      <Route path="/candidaturas" element={<List/>}/>
      <Route path="/candidaturas/:id" element={<Link to="/candidaturas?status=IDENTIFIED">Voltar</Link>}/>
    </Route></Routes>
  </MemoryRouter>)
  fireEvent.click(await screen.findByRole('link', {name:'Abrir candidatura Um'}))
  expect(document.activeElement.id).toBe('main-content')
  fireEvent.click(screen.getByRole('link', {name:'Voltar'}))
  const action = await screen.findByRole('link', {name:'Abrir candidatura Um'})
  await waitFor(() => expect(document.activeElement).toBe(action))
})
it.each([false,true])('restores alert focus when the opened row disappears: %s',async disappeared=>{
  let opened=false
  function Inbox(){
    return <section data-alert-results-ready>
      <button data-alert-focus-fallback aria-pressed="true">Candidatura</button>
      <Link to="/candidaturas/one" data-alert-id="first">Primeiro alerta</Link>
      {(!opened||!disappeared)&&<Link to="/candidaturas/one" data-alert-id="second" onClick={()=>{opened=true}}>Segundo alerta</Link>}
    </section>
  }
  render(<MemoryRouter initialEntries={['/notificacoes?type=APPLICATION_STATUS_CHANGED']}>
    <Routes><Route element={<Layout/>}><Route path="/notificacoes" element={<Inbox/>}/>
    <Route path="/candidaturas/:id" element={<Link to="/notificacoes?type=APPLICATION_STATUS_CHANGED">Voltar aos alertas</Link>}/></Route></Routes>
  </MemoryRouter>)
  fireEvent.click(screen.getByRole('link',{name:'Segundo alerta'}))
  fireEvent.click(screen.getByRole('link',{name:'Voltar aos alertas'}))
  const expected=disappeared?screen.getByRole('button',{name:'Candidatura'}):screen.getByRole('link',{name:'Segundo alerta'})
  await waitFor(()=>expect(document.activeElement).toBe(expected))
})
it('returns focus through both levels of the units directory',async()=>{
  const people='/perfil-organizacao/pessoas?unitId=a', unitList='/perfil-organizacao/unidades'
  render(<MemoryRouter initialEntries={[unitList]}><Routes><Route element={<Layout/>}>
    <Route path={unitList} element={<Link to={people}>Pessoas do gabinete</Link>}/>
    <Route path="/perfil-organizacao/pessoas" element={<><Link to={unitList}>Voltar às unidades</Link><Link to="/perfil-organizacao/pessoas/one?unitId=a">Pessoa do gabinete</Link></>}/>
    <Route path="/perfil-organizacao/pessoas/:id" element={<Link to={people}>Voltar às pessoas</Link>}/>
  </Route></Routes></MemoryRouter>)
  for(const name of ['Pessoas do gabinete','Pessoa do gabinete','Voltar às pessoas'])fireEvent.click(screen.getByRole('link',{name}))
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('link',{name:'Pessoa do gabinete'})))
  fireEvent.click(screen.getByRole('link',{name:'Voltar às unidades'}))
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('link',{name:'Pessoas do gabinete'})))
})
it('returns keyboard focus from account security to the personal profile action',async()=>{
  render(<MemoryRouter initialEntries={['/perfil']}><Routes><Route element={<Layout/>}>
    <Route path="/perfil" element={<Link to="/conta/seguranca">Consultar segurança</Link>}/>
    <Route path="/conta/seguranca" element={<Link to="/perfil">Voltar ao perfil pessoal</Link>}/>
  </Route></Routes></MemoryRouter>)
  fireEvent.click(screen.getByRole('link',{name:'Consultar segurança'}))
  expect(document.activeElement.id).toBe('main-content')
  fireEvent.click(screen.getByRole('link',{name:'Voltar ao perfil pessoal'}))
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('link',{name:'Consultar segurança'})))
})
it('dismisses the mobile menu and moves focus into the page even when its active link is selected',async()=>{
  window.matchMedia = vi.fn(query => ({ matches:query === '(max-width: 768px)',addEventListener(){},removeEventListener(){} }))
  page('/catalogo',<button>Primeira ação</button>)
  fireEvent.click(screen.getByRole('button',{name:'Abrir menu'}))
  fireEvent.click(screen.getByRole('link',{name:'Oportunidades'}))
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.activeElement.id).toBe('main-content')
})
it('orders the organization navigation as Oportunidades, Interesses, Candidaturas and hides Parceiros when the backend navigation list says so', () => {
  sidebar()
  const names = screen.getAllByRole('link').map(link => link.textContent)
  expect(names.indexOf('Interesses')).toBe(names.indexOf('Oportunidades') + 1)
  expect(names.indexOf('Candidaturas')).toBeGreaterThan(names.indexOf('Interesses'))
  expect(screen.getByRole('link', { name: 'Parceiros' })).toBeTruthy()
  cleanup(); state.auth.organization = { ...state.auth.organization, navigation: { partners: false } }
  sidebar()
  expect(screen.queryByRole('link', { name: 'Parceiros' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Interesses' })).toBeTruthy()
})

it('shows the organization calendar only when the backend navigation list allows it, without looking at the profile', () => {
  state.auth.organization = { id: 'a', profileCode: 'ORG_ADMIN' }
  sidebar()
  expect(screen.queryByRole('link', { name: 'Calendário da entidade' })).toBeNull()
  cleanup(); state.auth.organization = { id: 'a', profileCode: 'VIEWER', navigation: { calendar: true } }
  sidebar()
  expect(screen.getByRole('link', { name: 'Calendário da entidade' }).getAttribute('href')).toBe('/calendario')
  cleanup(); state.auth.organization = { id: 'a', profileCode: 'ORG_ADMIN', navigation: { calendar: false } }
  sidebar()
  expect(screen.queryByRole('link', { name: 'Calendário da entidade' })).toBeNull()
})
