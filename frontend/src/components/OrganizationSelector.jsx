import { useAuth } from '../contexts/AuthContext'

export default function OrganizationSelector() {
  const { organization, user } = useAuth()
  if (!organization) return user?.platformRoles?.includes('C4G_ADMIN')
    ? <span className="platform-context">Administração da plataforma C4G</span>
    : <p className="organization-context-note">Sem organização associada. Contacte o administrador da sua organização para obter acesso.</p>
  const name = organization.displayName || organization.display_name || organization.name || organization.slug
  return <span className="organization-context" aria-label={`Entidade: ${name}`}>
    <span>Entidade</span><strong>{name}</strong>
  </span>
}
