import { SectionBreadcrumb } from './MetronicCatalog'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, Menu, Search, UserRound, ShieldCheck, LogOut, X } from 'lucide-react'
import './header-tools.css'
import { organizationNotificationsApi } from '../../api/api'
import { afterPageRequests } from '../../api/pageRequests'
import { useAuth } from '../../contexts/AuthContext'
import OrganizationSelector from '../OrganizationSelector'

export default function Header({ metronicSection, title, onMenuToggle, menuOpen, menuButtonRef, navigationAccess }) {
  const pathname = useLocation().pathname
  const pq1 = pathname.startsWith('/publicacao-perfil') || pathname.startsWith('/pre-qualificacao')
  const editorial = pq1 || pathname.startsWith('/perfil-organizacao')
  const compact = ['/meu-trabalho', '/calendario'].includes(pathname)
  const { user, organization, logout } = useAuth()
  const header = useRef(null)
  const hasContext = Boolean(organization) || user?.platformRoles?.includes('C4G_ADMIN')

  useLayoutEffect(() => {
    const element = header.current
    const container = element.parentElement
    const update = () => {
      const height = element.getBoundingClientRect().height
      if (height) container.style.setProperty('--shell-header-height', `${height}px`)
    }
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      container.style.removeProperty('--shell-header-height')
    }
  }, [])

  return (
    <header ref={header} className={`top-header${editorial ? ' editorial-header' : ''}${compact ? ' compact-page-header' : ''}`}>
      <div className="header-left">
        <button ref={menuButtonRef} className="hamburger-btn" onClick={onMenuToggle} aria-label={menuOpen ? 'Recolher menu' : 'Abrir menu'}
          aria-expanded={!!menuOpen} aria-controls="primary-navigation">
          <Menu size={20} />
        </button>
        <SectionBreadcrumb title={title} section={metronicSection} detail={Boolean(metronicSection && pathname.split("/")[2])} />
      </div>
      {!hasContext && <OrganizationSelector />}
      <div className="header-actions">
        {hasContext && <OrganizationSelector />}
        <PageSearch user={user} organization={organization} navigationAccess={navigationAccess} />
        {organization && <AlertBell key={`${user?.id}:${organization?.id}:${organization?.membershipVersion || ''}`} organizationId={organization?.id} />}
        <ProfileMenu user={user} organization={organization} logout={logout} />
      </div>
    </header>
  )
}

function pagesFor(user, organization, navigationAccess = {directory:true,units:true,access:true}) {
  const admin = user?.platformRoles?.includes('C4G_ADMIN')
  const pages = [{to:'/catalogo', label:'Catálogo C4G'}, {to:'/conta/seguranca', label:'Segurança da conta'}]
  if (admin) pages.push({to:'/integracoes', label:'Fontes de oportunidades'})
  if (organization?.profileCode === 'ORG_ADMIN') pages.push({to:'/calendario', label:'Calendário da entidade'})
  if (organization) pages.push(...[{to:'/dashboard',label:'Dashboard'}, {to:'/meu-trabalho',label:'O meu trabalho'}, {to:'/candidaturas',label:'Candidaturas'}, {to:'/parceiros',label:'Parceiros'}, {to:'/matching',label:'Matching'}, {to:'/notificacoes',label:'Alertas'}, ...(navigationAccess.directory ? [{to:'/perfil-organizacao',label:'Perfil da organização'}, {to:'/perfil-organizacao/pessoas',label:'Pessoas'}] : []), ...(navigationAccess.units ? [{to:'/perfil-organizacao/unidades',label:'Departamentos / Unidades'}] : []), ...(navigationAccess.access ? [{to:'/utilizadores',label:'Acessos'}] : []), {to:'/perfil',label:'Perfil pessoal'}])
  if (admin) pages.push(...[{to:'/administracao/dashboard',label:'Dashboard C4G'}, {to:'/administracao/entidades',label:'Entidades e utilizadores'}, {to:'/administracao/faturacao',label:'Faturação da plataforma'}, {to:'/administracao/logs',label:'Logs'}, {to:'/administracao/importar',label:'Importar Portugal 2030'}, {to:'/administracao/oportunidades/nova',label:'Criar oportunidade'}])
  return pages
}
function PageSearch({user,organization,navigationAccess}) {
  const dialog = useRef(null), trigger = useRef(null), input = useRef(null)
  const [query,setQuery] = useState('')
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const matches = pagesFor(user,organization,navigationAccess).filter(page=>normalize(page.label).includes(normalize(query.trim())))
  const close = () => dialog.current?.close()
  return <><button ref={trigger} type="button" className="header-tool" aria-label="Pesquisar páginas" onClick={()=>{setQuery('');dialog.current?.showModal();input.current?.focus()}}><Search size={20}/></button>
    <dialog ref={dialog} className="header-search-dialog" aria-labelledby="header-search-title" onClose={()=>trigger.current?.focus()}
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close()}}}>
      <div className="header-search-top"><Search size={20} aria-hidden="true"/><label id="header-search-title" className="sr-only" htmlFor="header-page-search">Pesquisar páginas</label><input ref={input} id="header-page-search" type="search" placeholder="Pesquisar páginas" value={query} onChange={event=>setQuery(event.target.value)}/><button type="button" className="header-tool" onClick={close} aria-label="Fechar pesquisa"><X size={19}/></button></div>
      <div className="header-search-results"><p>Páginas</p>{matches.length?<ul>{matches.map(page=><li key={page.to}><Link to={page.to} onClick={close}>{page.label}</Link></li>)}</ul>:<p role="status">Nenhuma página encontrada.</p>}</div>
    </dialog></>
}
function ProfileMenu({user,organization,logout}) {
  const details=useRef(null)
  const admin=user?.platformRoles?.includes('C4G_ADMIN')
  return <details ref={details} className="header-profile" onKeyDown={event=>{if(event.key==='Escape'){details.current.open=false;details.current.querySelector('summary')?.focus()}}}>
    <summary aria-label="Menu de perfil"><span className="header-avatar">{user?.name?.[0]?.toUpperCase() || '?'}</span></summary>
    <div className="header-profile-menu"><div className="header-profile-identity"><strong>{user?.name || 'Utilizador'}</strong><span>{admin?'Administração C4G':organization?.profileLabel || (organization?'Membro da organização':'Sem entidade selecionada')}</span></div>
      {organization && <Link to="/perfil" onClick={()=>{details.current.open=false}}><UserRound size={17}/>Perfil pessoal</Link>}
      <Link to="/conta/seguranca" onClick={()=>{details.current.open=false}}><ShieldCheck size={17}/>Segurança da conta</Link>
      <button type="button" onClick={logout}><LogOut size={17}/>Sair</button>
    </div></details>
}

export function AlertBell({ organizationId }) {
  const [unread, setUnread] = useState(null)
  useEffect(() => {
    let active = true, sequence = 0, readController = null
    const api = organizationNotificationsApi
    const load = async (refresh = false) => {
      const current = ++sequence
      readController?.abort()
      const controller = new AbortController()
      readController = controller
      try {
        let r
        if (refresh) {
          try { r = await api.refreshList({ unread: true, limit: 1 }, organizationId) }
          catch (e) { if (e.response?.status && e.response.status < 500) throw e }
        }
        if (!active || current !== sequence) return
        r ||= await api.list({ unread: true, limit: 1 }, organizationId, controller.signal)
        if (active && current === sequence) setUnread(Number.isSafeInteger(r.data?.unread_count) ? r.data.unread_count : null)
      } catch { if (active && current === sequence) setUnread(null) }
    }
    const reload = () => load()
    const first = new AbortController()
    afterPageRequests(first.signal, () => load(true))
    window.addEventListener('notifications:changed', reload)
    window.addEventListener('focus', reload)
    return () => { active = false; sequence++; first.abort(); readController?.abort(); window.removeEventListener('notifications:changed', reload); window.removeEventListener('focus', reload) }
  }, [organizationId])
  return <Link to="/notificacoes" className="notif-btn" aria-label={unread === null ? 'Alertas' : `Alertas · ${unread} não lidos`}>
    <Bell size={20} data-icon-tone="amber" />{unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
  </Link>
}
