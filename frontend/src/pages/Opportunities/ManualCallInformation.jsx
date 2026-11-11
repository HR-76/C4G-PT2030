const FIELDS=[['geographySummary','Geografia/Local'],['eligibleGroups','Grupos elegíveis'],['eligibilitySummary','Requisitos aplicáveis à call']]

export default function ManualCallInformation({fields={},source}){
  // Imported eligibilitySummary has source-specific meaning; do not relabel it.
  const manual=source==='C4G_MANUAL'||(!source&&(Object.hasOwn(fields,'geographySummary')||Object.hasOwn(fields,'eligibleGroups')))
  if(!manual)return null
  return <section className="detail-section manual-call-information" aria-label="Destinatários e requisitos">
    <h2 className="opportunity-section-title">Destinatários e requisitos</h2>
    <dl className="dl-list">
      {FIELDS.map(([key,label])=><div className="dl-row" key={key}><dt>{label}</dt><dd style={{whiteSpace:'pre-wrap'}}>{typeof fields[key]==='string'&&fields[key].trim()?fields[key]:'Não indicado'}</dd></div>)}
    </dl>
  </section>
}
import './ManualCallInformation.css'

