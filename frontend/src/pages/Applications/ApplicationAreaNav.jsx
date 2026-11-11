import { Link, useLocation, useSearchParams } from 'react-router-dom'
import './application-area-nav.css'

export function ApplicationAreaHeader({ organization, title, children }) {
  return <header className="application-area-header"><div>
    <p>{organization.displayName || organization.name || 'Organização'}</p>
    <h1>{title}</h1>
  </div>{children}</header>
}

export default function ApplicationAreaNav() {
  const location = useLocation(), [params] = useSearchParams()
  const interests = location.pathname.startsWith('/interesses') || params.get('ver') === 'interesses'
  return <nav className="application-area-nav" aria-label="Área de candidaturas">
    <Link to="/candidaturas?ver=interesses" aria-current={interests ? 'page' : undefined}>Interesses</Link>
    <Link to="/candidaturas" aria-current={!interests ? 'page' : undefined}>Candidaturas</Link>
  </nav>
}
