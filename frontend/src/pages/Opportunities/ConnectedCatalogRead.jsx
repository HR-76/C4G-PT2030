import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import CatalogExposureGate from './CatalogExposureGate'
import CatalogReadWorkspace from './CatalogReadWorkspace'

export const catalogReadPath = '/catalogo/consulta'
export function CatalogReadEntry({ scope }) {
  return <CatalogExposureGate scope={scope} quiet>
    <Link className="btn btn-outline" to={catalogReadPath}>Explorar catálogo unificado</Link>
  </CatalogExposureGate>
}
export default function ConnectedCatalogRead() {
  const { user, organization } = useAuth()
  const scope = `${user?.id || ''}:${organization?.id || ''}`
  return <div className="page">
    <Link to="/catalogo">← Gestão de oportunidades, interesses e candidaturas</Link>
    <CatalogExposureGate scope={scope}>
      <CatalogReadWorkspace scope={scope} basePath={catalogReadPath} isolated={false} interestOrganization={organization} />
    </CatalogExposureGate>
  </div>
}
