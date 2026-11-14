import { useEffect, useState } from 'react'
import { customerBillingApi } from '../../api/api'
import { afterPageRequests } from '../../api/pageRequests'
import { SidebarHeader } from './MetronicCatalog'
import { NavLink, useLocation } from 'react-router-dom'
import '../../dashboard-palette.css'
import { useAuth } from '../../contexts/AuthContext'
import {
  LayoutDashboard, FileText, Zap, Bell, ListChecks, CalendarDays,
  Building2, Network, User, Users, Upload, Globe, LogOut, Handshake, ShieldCheck, ReceiptText, Plus, Minus, Mail, Heart,
} from 'lucide-react'

export default function Sidebar({ open, mobile, hidden = false, panelRef, onClose, onNavigate, navigationAccess = {directory:true, units:true, access:true} }) {
  const { user, organization, logout } = useAuth()
  const platformAdmin = user?.platformRoles?.includes('C4G_ADMIN')
  const [billingAccess, setBillingAccess] = useState(null)
  const [closedGroups, setClosedGroups] = useState({})
  const { pathname } = useLocation()
  useEffect(() => {
    setBillingAccess(null)
    if (!organization?.id || platformAdmin) return
    const controller = new AbortController()
    afterPageRequests(controller.signal, () => customerBillingApi(organization.id).access(controller.signal)
      .then(({data}) => { if (!controller.signal.aborted) setBillingAccess({organizationId:organization.id,userId:user?.id,allowed:data.canRead === true}) })
      .catch(() => {}))
    return () => controller.abort()
  }, [organization?.id, user?.id, platformAdmin])
  const canReadBilling = billingAccess?.allowed && billingAccess.organizationId === organization?.id && billingAccess.userId === user?.id
  const groups = [
    ...(platformAdmin ? [{ label: 'Plataforma C4G', items: [
      { to: '/administracao/dashboard', icon: LayoutDashboard, tone: 'blue', label: 'Dashboard C4G' },
    ] }, { label: 'Oportunidades e catálogo', items: [
      { to: '/catalogo', icon: Globe, tone: 'sky', label: 'Oportunidades' },
      { to: '/administracao/oportunidades/nova', icon: FileText, tone: 'rose', label: 'Criar oportunidade' },
      { to: '/integracoes', icon: Globe, tone: 'violet', label: 'Fontes de oportunidades' },
      { to: '/administracao/importar', icon: Upload, tone: 'amber', label: 'Importar Portugal 2030' },
    ] }, { label: 'Administração e segurança', items: [
      { to: '/administracao/entidades', icon: Users, tone: 'violet', label: 'Entidades e utilizadores' },
      { to: '/administracao/faturacao', icon: ReceiptText, tone: 'amber', label: 'Faturação' },
      { to: '/administracao/email', icon: Mail, tone: 'sky', label: 'Email' },
      { to: '/administracao/logs', icon: FileText, tone: 'blue', label: 'Logs' },
      { to: '/conta/seguranca', icon: ShieldCheck, tone: 'rose', label: 'Segurança da conta' },
    ] }] : []),
    ...(organization ? [{ label: 'Trabalho diário', items: [
      { to: '/dashboard', icon: LayoutDashboard, tone: 'blue', label: 'Dashboard' },
      { to: '/meu-trabalho', icon: ListChecks, tone: 'violet', label: 'O meu trabalho' },
      ...(!platformAdmin ? [{ to: '/catalogo', icon: Globe, tone: 'sky', label: 'Oportunidades' }, { to: '/interesses', icon: Heart, tone: 'rose', label: 'Interesses' }] : []),
      { to: '/candidaturas', icon: FileText, tone: 'rose', label: 'Candidaturas' },
      ...(organization.navigation?.calendar === true ? [{ to: '/calendario', icon: CalendarDays, tone: 'blue', label: 'Calendário da entidade' }] : []),
      ...(organization.navigation?.partners !== false ? [{ to: '/parceiros', icon: Handshake, tone: 'blue', label: 'Parceiros' }] : []),
      { to: '/matching', icon: Zap, tone: 'violet', label: 'Matching' },
      { to: '/notificacoes', icon: Bell, tone: 'amber', label: 'Alertas' },
    ] }, ...((navigationAccess.directory || navigationAccess.units || navigationAccess.access || canReadBilling) ? [{ label: 'Organização', items: [
      ...(navigationAccess.directory ? [{ to: '/perfil-organizacao', icon: Building2, tone: 'blue', label: 'Perfil da organização' }] : []),
      ...(navigationAccess.units ? [{ to: '/perfil-organizacao/unidades', icon: Network, tone: 'sky', label: 'Departamentos / Unidades' }] : []),
      ...(navigationAccess.directory ? [{ to: '/perfil-organizacao/pessoas', icon: Users, tone: 'violet', label: 'Pessoas' }] : []),
      ...(canReadBilling ? [{ to: '/faturacao', icon: ReceiptText, tone: 'amber', label: 'Faturação' }] : []),
      ...(navigationAccess.access ? [{ to: '/utilizadores', icon: ShieldCheck, tone: 'rose', label: 'Acessos' }] : []),
    ] }] : [])] : !platformAdmin ? [{ label: 'Trabalho diário', items: [
      { to: '/catalogo', icon: Globe, tone: 'sky', label: 'Oportunidades' },
    ] }] : []),
    ...(!platformAdmin || organization ? [{ label: 'A minha conta', items: [
      ...(organization ? [{ to: '/perfil', icon: User, tone: 'blue', label: 'Perfil pessoal' }] : []),
      ...(!platformAdmin ? [{ to: '/conta/seguranca', icon: ShieldCheck, tone: 'rose', label: 'Segurança da conta' }] : []),
    ] }] : []),
  ]

  useEffect(() => {
    const matching = groups.filter(group => group.items.some(item => pathname === item.to || pathname.startsWith(`${item.to}/`)))
    setClosedGroups(previous => {
      const next = { ...previous }
      matching.forEach(group => { delete next[group.label] })
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; groups is read at that moment.
  }, [pathname])

  return (
    <aside id="primary-navigation" ref={panelRef} onClickCapture={onNavigate} className={`sidebar${open ? ' sidebar-mobile-open' : ''}`}
      inert={(mobile && !open) || hidden ? '' : undefined} aria-hidden={(mobile && !open) || hidden ? true : undefined}
      role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}
      aria-label="Navegação principal">
      <SidebarHeader onClose={onClose} />
      <nav className="sidebar-nav">
        {groups.map(group => <section key={group.label} aria-label={group.label}>
          <button type="button" className="nav-divider sidebar-group-toggle" aria-expanded={!closedGroups[group.label]}
            onClick={() => setClosedGroups(previous => ({ ...previous, [group.label]: !previous[group.label] }))}>
            <span>{group.label}</span>{closedGroups[group.label] ? <Plus size={15} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}
          </button>
          {!closedGroups[group.label] && group.items.map(({ to, icon: Icon, tone, label }) => (
            <NavLink key={to} to={to} end={to === '/perfil-organizacao'} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <Icon size={18} aria-hidden="true" data-icon-tone={tone} />
              <span>{label}</span>
            </NavLink>
          ))}
        </section>)}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar">{user?.name?.[0]?.toUpperCase() || '?'}</div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.name}</span>
            <span className="sidebar-user-role">{platformAdmin ? 'Administração C4G' : organization ? organization.profileLabel || 'Membro da organização' : 'Sem entidade selecionada'}</span>
          </div>
        </div>
        <button type="button" className="btn btn-logout logout-btn" onClick={logout}>
          <LogOut size={16} aria-hidden="true" />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  )
}
