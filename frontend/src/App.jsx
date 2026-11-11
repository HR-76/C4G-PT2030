import LogoutResult from './pages/LogoutResult'
import { logoutPageState } from './api/logoutResult'
import ApplicationLinkGate from './pages/Applications/ApplicationLinkGate'
import LoadingIndicator from './components/LoadingIndicator'
import routePage from './components/RoutePage'
import { Routes, Route, Navigate, useParams, useLocation, useOutlet, Link } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout/Layout'
import DirectLogin from './components/DirectLogin'
import ConnectionNotice from './components/ConnectionNotice'
import { getHomePath } from './utils/navigation'

const MyWork = routePage(() => import('./pages/Applications/MyWork'))
const OrganizationCalendar = routePage(() => import('./pages/Applications/OrganizationCalendar'))
const Dashboard = routePage(() => import('./pages/Dashboard'))
const OpportunitiesList = routePage(() => import('./pages/Opportunities/OpportunitiesList'))
const OpportunityDetail = routePage(() => import('./pages/Opportunities/OpportunityDetail'))
const PrivateApplications = routePage(() => import('./pages/Applications/PrivateApplications'))
const Matching = routePage(() => import('./pages/Matching'))
const Partners = routePage(() => import('./pages/Partners'))
const Profile = routePage(() => import('./pages/Profile'))
const AccountSecurity = routePage(() => import('./pages/AccountSecurity'))
const EditorialProfile = routePage(() => import('./pages/Editorial/EditorialProfile'))
const OrganizationAccess = routePage(() => import('./pages/Organization/OrganizationAccess'))
const PersonalProfile = routePage(() => import('./pages/Organization/PersonalProfile'))
const OrganizationProfile = routePage(() => import('./pages/Organization/OrganizationProfile'))
const EntityAdmission = routePage(() => import('./pages/Organization/EntityAdmission'))
const Prequalification = routePage(() => import('./pages/Prequalification/Prequalification'))
const Pq1Profile = routePage(() => import('./pages/Pq1/Pq1Profile'))
const Notifications = routePage(() => import('./pages/Notifications'))
const Import = routePage(() => import('./pages/Import'))
const FundingTenders = routePage(() => import('./pages/FundingTenders'))
const PlatformDashboard = routePage(() => import('./pages/Platform/PlatformDashboard'))
const EuLegacyPrearchiveReview = routePage(() => import('./pages/Platform/EuLegacyPrearchiveReview'))
const EuLegacyAcceptanceReview = routePage(() => import('./pages/Platform/EuLegacyAcceptanceReview.jsx'))
const PlatformLogs = routePage(() => import('./pages/Platform/PlatformLogs'))
const PlatformDirectory = routePage(() => import('./pages/Platform/PlatformDirectory'))
const CustomerBilling = routePage(() => import('./pages/Billing/CustomerBilling.jsx'))
const PlatformBilling = routePage(() => import('./pages/Platform/PlatformBilling.jsx'))
const PlatformBillingDetail = routePage(() => import('./pages/Platform/PlatformBillingDetail.jsx'))
const CentralOpportunityCreate = routePage(() => import('./pages/Opportunities/CentralOpportunityCreate'))
const CentralOpportunities = routePage(() => import('./pages/Opportunities/CentralOpportunities'))
const ConnectedCatalogRead = routePage(() => import('./pages/Opportunities/ConnectedCatalogRead'))
const Interests = routePage(() => import('./pages/Interests/Interests'))

function PeopleDirectory() {
  const detail = useOutlet()
  const { state } = useLocation()
  // Keep the originating list, including additional loaded pages, while viewing a person.
  return <>{(!detail || state?.fromPeopleList) && <div hidden={Boolean(detail)}><OrganizationProfile /></div>}{detail}</>
}

function ProtectedRoute({ children, platformOnly = false }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingIndicator className="page-loading" />
  if (!user) return <Navigate to="/login" state={{ returnTo: location.pathname + location.search + location.hash }} replace />
  const home = getHomePath(user)
  if (platformOnly && !user.platformRoles?.includes('C4G_ADMIN')) return <Navigate to={home} replace />
  return children
}

function OpportunityRedirect() {
  const { id } = useParams()
  return <Navigate to={`/oportunidades/${id}`} replace />
}

function AppRoutes() {
  const { user, organization, loading, admissions } = useAuth()
  const location = useLocation()
  const applicationSessionKey = `${user?.id || ''}:${organization?.id || ''}`
  const home = getHomePath(user)
  if (loading) return <LoadingIndicator className="page-loading" />
  if (user && admissions?.limited) {
    if (location.pathname === '/conta/seguranca') return <main><Link className="btn btn-secondary" to="/adesao">Voltar à ficha da entidade</Link><AccountSecurity /></main>
    const target = admissions.items?.[0]?.id
    if (!location.pathname.startsWith('/adesao')) return <Navigate to={target ? `/adesao/${target}` : '/adesao'} replace />
    return <EntityAdmission key={user.id} />
  }

  return (
    <Routes>
      <Route path="/adesao/:id" element={<ProtectedRoute><EntityAdmission key={user?.id} /></ProtectedRoute>} />
      <Route path="/adesao" element={<ProtectedRoute><EntityAdmission key={user?.id} /></ProtectedRoute>} />
      <Route path="/recuperar-password" element={<main className="page"><h1>Recuperar password</h1><p>A recuperação por email ainda não está disponível neste ambiente.</p><p>Se não conseguir entrar, contacte a administração C4G. Não partilhe a sua palavra-passe.</p><Link to="/login">Voltar ao login</Link></main>} />
      <Route path="/login" element={user ? <Navigate to={home} replace /> : <DirectLogin returnTo={location.state?.returnTo} />} />
      <Route path="/" element={user ? <Navigate to={home} replace /> : <DirectLogin />} />
      <Route path="/oportunidade/:id" element={<OpportunityRedirect />} />
      <Route path="/opportunity/:id" element={<OpportunityRedirect />} />
      <Route path="/opportunities/:id" element={<OpportunityRedirect />} />
      <Route path="/opportunities" element={<Navigate to="/oportunidades" replace />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/meu-trabalho" element={<MyWork key={applicationSessionKey} />} />
        <Route path="/calendario" element={organization?.profileCode === 'ORG_ADMIN'
          ? <OrganizationCalendar key={applicationSessionKey} /> : <Navigate to={home} replace />} />
        <Route path="/dashboard" element={<Dashboard key={applicationSessionKey} />} />
        <Route path="/oportunidades" element={<OpportunitiesList />} />
        <Route path="/oportunidades/:id" element={<OpportunityDetail />} />
        <Route path="/catalogo" element={<CentralOpportunities />} />
        <Route path="/catalogo/consulta" element={<ConnectedCatalogRead />} />
        <Route path="/catalogo/consulta/:id" element={<ConnectedCatalogRead />} />
        <Route path="/catalogo/:id" element={<CentralOpportunities />} />
        <Route path="/interesses" element={<Interests key={applicationSessionKey} />} />
        <Route path="/interesses/:id" element={<Interests key={applicationSessionKey} />} />
        <Route path="/candidaturas" element={<PrivateApplications key={applicationSessionKey} />} />
        <Route path="/candidaturas/:id" element={<ApplicationLinkGate><PrivateApplications key={applicationSessionKey} /></ApplicationLinkGate>} />
        <Route path="/parceiros" element={<Partners />} />
        <Route path="/matching" element={<Matching />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="/conta/seguranca" element={<AccountSecurity showProfile={Boolean(organization)} />} />
        <Route path="/perfil-organizacao" element={<OrganizationProfile />} />
        <Route path="/perfil-organizacao/unidades" element={<OrganizationProfile />} />
        <Route path="/perfil-organizacao/pessoas" element={<PeopleDirectory />}>
          <Route path=":personId" element={<PersonalProfile />} />
        </Route>
        <Route path="/perfil-organizacao/*" element={<EditorialProfile />} />
        <Route path="/pre-qualificacao" element={<Prequalification />} />
        <Route path="/publicacao-perfil/*" element={<Pq1Profile />} />
        <Route path="/notificacoes" element={<Notifications />} />
        <Route path="/faturacao" element={<CustomerBilling key={applicationSessionKey} />} />
        <Route path="/faturacao/historico" element={<CustomerBilling key={applicationSessionKey} history />} />
        <Route path="/faturacao/:id" element={<CustomerBilling key={applicationSessionKey} />} />
        <Route path="/utilizadores" element={<OrganizationAccess />} />
        <Route path="/importar" element={<ProtectedRoute platformOnly><Navigate to="/administracao/importar" replace /></ProtectedRoute>} />
        <Route path="/integracoes" element={<ProtectedRoute platformOnly><FundingTenders key={user?.id} /></ProtectedRoute>} />
        <Route path="/administracao/oportunidades/nova" element={<ProtectedRoute platformOnly><CentralOpportunityCreate /></ProtectedRoute>} />
        <Route path="/administracao/dashboard" element={<ProtectedRoute platformOnly><PlatformDashboard /></ProtectedRoute>} />
        <Route path="/administracao/aprovacoes-eu" element={<ProtectedRoute platformOnly><EuLegacyPrearchiveReview /></ProtectedRoute>} />
        <Route path="/administracao/aceitacoes-eu" element={<ProtectedRoute platformOnly><EuLegacyAcceptanceReview /></ProtectedRoute>} />
        <Route path="/administracao/logs" element={<ProtectedRoute platformOnly><PlatformLogs /></ProtectedRoute>} />
        <Route path="/administracao/entidades" element={<ProtectedRoute platformOnly><PlatformDirectory /></ProtectedRoute>} />
        <Route path="/administracao/entidades/utilizadores" element={<ProtectedRoute platformOnly><PlatformDirectory /></ProtectedRoute>} />
        <Route path="/administracao/entidades/:entityId" element={<ProtectedRoute platformOnly><PlatformDirectory /></ProtectedRoute>} />
        <Route path="/administracao/faturacao" element={<ProtectedRoute platformOnly><PlatformBilling /></ProtectedRoute>} />
        <Route path="/administracao/faturacao/:cycleId" element={<ProtectedRoute platformOnly><PlatformBillingDetail /></ProtectedRoute>} />
        <Route path="/administracao/importar" element={<ProtectedRoute platformOnly><Import /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}

export default function App() {
  const location = useLocation()
  const logoutStatus = logoutPageState(location.pathname, location.search)
  if (logoutStatus) return <LogoutResult status={logoutStatus} />
  return <AuthProvider><ConnectionNotice /><AppRoutes /></AuthProvider>
}
