// Metronic 9.5 Demo 1 sidebar header, breadcrumb and default Card slots.
// The catalog uses the C4G identity, router and scoped CSS for the kit utilities.
import { ChevronFirst, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import './metronicCatalog.css'

export function SidebarHeader({ onClose }) {
  return <div className="mt-sidebar-header">

    <button type="button" onClick={onClose} aria-label="Fechar menu"><ChevronFirst size={17} /><span className="sr-only">Fechar menu</span></button>
    <Link to="/" aria-label="Início C4G"><img src="/logo-c4g.png" alt="C4G" /></Link>
  </div>
}

export function SectionBreadcrumb({ section, detail, title }) {
  const applications = section === "candidaturas"
  const label = applications ? "Candidaturas" : section === "catalogo" ? "Oportunidades" : title
  return <nav data-slot="breadcrumb" aria-label="Percurso">
    <ol data-slot="breadcrumb-list">
      <li data-slot="breadcrumb-item">C4G</li>
      <li aria-hidden="true"><ChevronRight size={14} /></li>
      <li data-slot="breadcrumb-item">{detail ? <Link to={`/${section}`}>{label}</Link> : <span aria-current="page">{label}</span>}</li>
      {detail && <><li aria-hidden="true"><ChevronRight size={14} /></li><li aria-current="page">{applications ? "Candidatura" : "Oportunidade"}</li></>}
    </ol>
  </nav>
}

export function Card({ children }) { return <div data-slot="card">{children}</div> }
export function CardHeader({ children }) { return <div data-slot="card-header" className="catalog-result-tools">{children}</div> }
