import { Link } from 'react-router-dom'
import { Check, Heart, Plus } from 'lucide-react'
import { useCatalogInterests } from '../Interests/CatalogInterests'

export default function CatalogInterestButton({ item, compact = false }) {
  const context = useCatalogInterests()
  if (compact && context && context.state !== 'ready') {
    const loading = context.state === 'loading'
    const label = loading ? 'A consultar interesse…' : 'Interesse indisponível'
    return <span className="catalog-interest-pending" title={label}>
      <Heart size={19} aria-hidden="true"/><small>{label}</small>
    </span>
  }
  if (!context || context.state !== 'ready') return null
  const summary = context.summaries[item.opportunityId]
  if (!summary) return null
  const listTarget='/candidaturas?'+new URLSearchParams({ver:'interesses',q:item.title||'',destaque:summary.interestId||'',...(summary.status==='ARCHIVED'?{status:'ARCHIVED'}:{})})
  if (compact && summary.interestId && summary.status === 'ACTIVE') {
    return <Link className="catalog-interest-heart is-active" title="Consultar na lista de interesses" aria-label={`Consultar na lista de interesses: ${item.title}`}
      to={listTarget}>
      <Heart size={19} fill="currentColor" aria-hidden="true"/>
    </Link>
  }
  if (summary.interestId) return (
    <div className="catalog-interest-action">
      {summary.status === 'ACTIVE' && <span className="catalog-interest-status catalog-interest-status-success"><Check size={14} aria-hidden="true"/>Interesse registado</span>}
      {summary.status === 'ARCHIVED' && <span className="catalog-interest-status catalog-interest-status-neutral">Interesse arquivado</span>}
      {compact && !['ACTIVE', 'ARCHIVED'].includes(summary.status) && <span className="catalog-interest-status">Interesse por verificar</span>}
      <Link className="btn btn-outline btn-sm" to={listTarget}>Consultar na lista de interesses</Link>
    </div>
  )
  if (item.lifecycleState === 'ARCHIVED' || !context.capabilities?.canRegister) return null
  if (compact) return <button className="catalog-interest-heart" title="Registar interesse" type="button" disabled={context.busy}
    onClick={() => context.open(item)} aria-label={`Registar interesse em ${item.title}`}>
    <Heart size={19} aria-hidden="true"/>
  </button>
  return <div className="catalog-interest-action"><button className="btn btn-outline btn-sm c4g-register-action" type="button" disabled={context.busy} onClick={() => context.open(item)} aria-label={`Registar interesse em ${item.title}`}><Plus size={14} aria-hidden="true"/>Registar interesse</button></div>
}
