import { CalendarDays, CircleCheck, CircleMinus, Clock, CircleHelp, PauseCircle, CircleX } from 'lucide-react'
import './catalogRead.css'
const statusIcons = {open:CircleCheck, closed:CircleMinus, planned:CalendarDays, forthcoming:Clock, conditional:Clock, suspended:PauseCircle, cancelled:CircleX, unknown:CircleHelp}
const statusLabels = {open:'Aberto',closed:'Encerrado',planned:'Previsto',forthcoming:'A abrir',conditional:'Condicionado',suspended:'Suspenso',cancelled:'Cancelado',unknown:'Por confirmar'}
export function CatalogStatus({status}) {
  const code=Object.hasOwn(statusLabels,status?.code)?status.code:'unknown'
  const Icon = statusIcons[code]
  return <span className={`cr-status cr-status-${code}`}><Icon size={16} aria-hidden="true" />{status?.label || statusLabels[code]}</span>
}

// String formatting preserves large amounts and source precision. Missing currency
// uses the user's EUR presentation rule; the canonical money is never modified.
export function formatCatalogAmount(amount,currency) {
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(amount)))return 'Montante por confirmar'
  const [whole,decimal='']=String(amount).split('.')
  const number=whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u202f')+','+decimal.padEnd(2,'0')
  if(currency && typeof currency==='object'){
    if(currency.state==='PRESENT')currency=currency.value
    else if(['CONFLICT','UNSUPPORTED','NOT_APPLICABLE'].includes(currency.state))return `${number} · ${{CONFLICT:'moeda divergente — requer revisão',UNSUPPORTED:'moeda não interpretada com segurança',NOT_APPLICABLE:'moeda não aplicável'}[currency.state]}`
    else currency=null
  }
  return `${number} ${!currency || currency==='EUR'?'€':currency}`
}
export function CatalogMoney({money}) {
  return <><span className="cr-money">{formatCatalogAmount(money.amount,money.currency)}</span></>
}
export function PresentationText({field,fallback='Não indicado'}) {
  return <>{field?.value || fallback}</>
}
const fields=[['topic','Topic'],['eligibleCandidates','Candidatos elegíveis'],['duration','Duração'],['location','Localização']]
export function CallInformation({information}) {
  return <section className="cr-call-information" aria-label="Informação da oportunidade">
    <h2>Informação da oportunidade</h2>
    <dl>{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd><PresentationText field={information?.[key]} fallback="Não indicado nos dados disponíveis"/>{information?.[key]?.source==='archived' && <small>Informação da fonte arquivada</small>}</dd></div>)}</dl>
  </section>
}

export function OpportunityStatus({state, label}) {
 const code={OPEN:'open',CLOSED:'closed',PLANNED:'planned',UPCOMING:'forthcoming',CANCELLED:'cancelled',SUSPENDED:'suspended',CONDITIONAL:'conditional'}[state]||'unknown'
 return <CatalogStatus status={{code,label}} />
}

