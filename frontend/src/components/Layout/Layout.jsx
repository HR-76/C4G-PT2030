import useListRouteFocus from './useListRouteFocus'
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuth } from '../../contexts/AuthContext'
import { organizationDirectoryApi } from '../../api/api'
import { directoryCacheKey, readDirectoryCache, writeDirectoryCache } from '../../pages/Organization/directoryCache'
import { afterPageRequests } from '../../api/pageRequests'
import { confirmedReadsEpoch, keepConfirmedRead, readScope } from '../../api/confirmedReads'

const titles = {
  '/meu-trabalho': 'O meu trabalho',
  '/dashboard':     'Dashboard',
  '/catalogo':      'Oportunidades',
  '/interesses':    'Interesses',
  '/oportunidades': 'Oportunidades privadas',
  '/perfil-organizacao': 'Perfil da organização',
  '/pre-qualificacao': 'Análise parcial',
  '/publicacao-perfil': 'Publicação multidomínio',
  '/candidaturas':  'Candidaturas',
  '/calendario':    'Calendário da entidade',
  '/parceiros':     'Parceiros',
  '/matching':      'Matching',
  '/notificacoes':  'Alertas',
  '/perfil':        'Perfil pessoal',
  '/utilizadores':  'Acessos',
  '/conta':         'Segurança da conta',
  '/faturacao':     'Faturação',
  '/faturacao/historico': 'Histórico de faturação',
  '/perfil-organizacao/unidades': 'Departamentos / Unidades',
  '/perfil-organizacao/pessoas': 'Pessoas',
  '/administracao/oportunidades/nova': 'Criar oportunidade',
  '/administracao/dashboard': 'Dashboard C4G',
  '/administracao/entidades': 'Entidades e utilizadores',
  '/administracao/faturacao': 'Faturação',
  '/administracao/logs': 'Logs',
  '/administracao/copias-seguranca': 'Cópias de segurança',
  '/administracao/email': 'Email',
  '/administracao/importar': 'Importar Portugal 2030',
  '/administracao/aprovacoes-eu': 'Pré-aprovações EU',
  '/administracao/aceitacoes-eu': 'Aceitações EU',
  '/importar':      'Importar Dados',
  '/integracoes':   'Fontes de oportunidades',
  '/administracao': 'Administração C4G',
}

export default function Layout() {
  const { organization, user } = useAuth()
  const [directoryAccess, setDirectoryAccess] = useState(null)
  // The session says which parts of the organization area this profile may open (decided by the server), so the menu
  // is complete at once. The requests below still run for what is allowed: they let those pages open at once and
  // correct the menu if the server refuses. A profile with none of them asks nothing. An older API sends no such
  // answer; the menu then waits for the requests, as before.
  const navigation = organization?.navigation
  const directoryAllowed = typeof navigation?.directory === 'boolean' ? navigation.directory : null
  const unitsAllowed = typeof navigation?.units === 'boolean' ? navigation.units : null
  const accessAllowed = typeof navigation?.access === 'boolean' ? navigation.access : null
  const sessionAccess = directoryAllowed === null || unitsAllowed === null || accessAllowed === null ? null : { directory: directoryAllowed, units: unitsAllowed, access: accessAllowed }
  useEffect(() => {
    if (!organization?.id || !user?.id) { setDirectoryAccess(null); return }
    const controller = new AbortController(), orgId = organization.id, userId = user.id
    setDirectoryAccess(null)
    const known = directoryAllowed !== null && accessAllowed !== null
    if (known && !directoryAllowed && !accessAllowed) return
    const api = organizationDirectoryApi(orgId), skipped = () => Promise.reject(Object.assign(new Error('Not offered to this profile'), { response: { status: 403 } }))
    // Only a refusal removes what the session offered; a failed request does not.
    const refused = result => result.status === 'rejected' && [401, 403, 404].includes(result.reason?.response?.status)
    const open = (result, offered) => result.status === 'fulfilled' || (known && offered === true && !refused(result))
    afterPageRequests(controller.signal, () => { const since = confirmedReadsEpoch(); return Promise.allSettled([known && !directoryAllowed ? skipped() : api.context(controller.signal), known && !accessAllowed ? skipped() : api.access(controller.signal)]).then(([directory, access]) => {
      if (controller.signal.aborted) return
      // The answer that decides the menu also lets the Acessos page open at once; that page reads it again on entry.
      if (access.status === 'fulfilled' && Array.isArray(access.value.data?.items)) keepConfirmedRead(readScope(userId, orgId), 'organization-access', access.value.data, since)
      // Lets the organization pages open at once; they read the context again on entry.
      if (directory.status === 'fulfilled' && directory.value.data?.permissions && !readDirectoryCache(directoryCacheKey(userId, orgId))) writeDirectoryCache(directoryCacheKey(userId, orgId), {context: directory.value.data})
      setDirectoryAccess({orgId, userId, directory: open(directory, directoryAllowed), units: directory.status === 'fulfilled' ? directory.value.data?.permissions?.units === true : open(directory, unitsAllowed), access: open(access, accessAllowed)})
    }) })
    return () => controller.abort()
  }, [organization?.id, user?.id, directoryAllowed, unitsAllowed, accessAllowed])
  const navigationAccess = directoryAccess?.orgId === organization?.id && directoryAccess?.userId === user?.id ? directoryAccess : sessionAccess || {directory:false, units:false, access:false}
  const breakpoint = '(max-width: 768px)'
  const { pathname, key: locationKey } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia(breakpoint).matches)
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const sidebar = useRef(null), menuButton = useRef(null)
  const menuNavigation = useRef(false)
  const main = useRef(null)
  const rememberOpener = useListRouteFocus(main, JSON.stringify([user?.id, organization?.id]))
  const menuOpen = mobile && sidebarOpen
  const base  = '/' + pathname.split('/')[1]
  const sectionPath = '/' + pathname.split('/').slice(1, 3).join('/')
  const title = titles[pathname] || titles[sectionPath] || titles[base] || ''
  const platformDirectory = pathname === '/administracao/oportunidades/nova' || pathname === '/importar' || pathname === '/administracao/importar' || pathname === '/administracao/dashboard' || pathname === '/administracao/aprovacoes-eu' || pathname === '/administracao/aceitacoes-eu' || pathname === '/administracao/logs' || pathname === '/administracao/copias-seguranca' || pathname === '/administracao/email' || pathname.startsWith('/administracao/email/') ||pathname === '/administracao/entidades' || pathname.startsWith('/administracao/entidades/') || pathname === '/administracao/faturacao' || pathname.startsWith('/administracao/faturacao/')
  const needsOrganization = !organization && !platformDirectory && !['/catalogo', '/integracoes', '/conta'].includes(base)
  const closeMenu = () => { setSidebarOpen(false); if (!mobile) setDesktopCollapsed(true); menuButton.current?.focus() }

  function followMenuLink(event) {
    if (!event.target.closest('a[href]') || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    menuNavigation.current = true
    setSidebarOpen(false)
  }
  useEffect(() => {
    if (menuNavigation.current && !menuOpen) {
      menuNavigation.current = false
      main.current?.focus({ preventScroll: true })
    }
  }, [locationKey, menuOpen])

  useEffect(() => { setSidebarOpen(false) }, [pathname])
  useEffect(() => {
    const query = window.matchMedia(breakpoint)
    const change = () => {
      if (query.matches && sidebar.current?.contains(document.activeElement)) menuButton.current?.focus()
      setMobile(query.matches); setSidebarOpen(false)
    }
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [breakpoint])
  useEffect(() => {
    if (!menuOpen) return
    const panel = sidebar.current
    const controls = () => [...panel.querySelectorAll('a[href], button:not(:disabled)')]
    controls()[0]?.focus()
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false) }
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    panel.addEventListener('keydown', keyboard)
    return () => {
      panel.removeEventListener('keydown', keyboard)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Cleanup needs the latest menuButton.current.
      if (!menuNavigation.current && window.matchMedia(breakpoint).matches) menuButton.current?.focus()
    }
  }, [menuOpen, breakpoint])

  const section = pathname.split("/")[1]
  const metronicSection = ["catalogo", "candidaturas"].includes(section) ? section : null
  return (
    <div className={`app-shell c4g-shell mt-demo1${!mobile && desktopCollapsed ? ' sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
      <Sidebar navigationAccess={navigationAccess} open={menuOpen} mobile={mobile} hidden={!mobile && desktopCollapsed} panelRef={sidebar} onClose={closeMenu} onNavigate={followMenuLink} />

      {/* Backdrop — only rendered when sidebar is open (mobile only) */}
      {menuOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="main-area" inert={menuOpen ? '' : undefined}>
        <Header navigationAccess={navigationAccess} metronicSection={metronicSection} title={title} menuOpen={mobile ? menuOpen : !desktopCollapsed} menuButtonRef={menuButton} onMenuToggle={() => mobile ? setSidebarOpen(o => !o) : setDesktopCollapsed(o => !o)} />
        <main ref={main} onClickCapture={rememberOpener} className="page-content" id="main-content" tabIndex={-1}>
          {needsOrganization ? <section className="availability-panel">
            <h2>Área da organização</h2>
            <p>Este percurso exige uma organização ativa e acesso autorizado. Escolha uma organização no cabeçalho, se tiver acesso a alguma.</p>
            {user?.platformRoles?.includes('C4G_ADMIN') && <p>A administração da plataforma permite gerir fontes e consultar o catálogo comum. Não concede acesso ao trabalho privado das entidades.</p>}
            <div className="availability-actions"><Link className="btn btn-primary" to="/catalogo">Consultar catálogo C4G</Link>{user?.platformRoles?.includes('C4G_ADMIN') && <Link className="btn btn-outline" to="/integracoes">Fontes de oportunidades</Link>}</div>
          </section> : <Outlet />}
        </main>
        <footer className="app-footer">
          © {new Date().getFullYear()} C4G - Consulting and Training Network. Todos os direitos reservados.
        </footer>
      </div>
    </div>
  )
}
