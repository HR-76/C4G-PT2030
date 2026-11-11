import InfoTooltip from '../components/InfoTooltip'

// Shared presentation for source sections.
export default function IntegrationSourceSection({source, children, status, information=source.description}) {
  const Icon = source.icon
  return <section className="detail-section" aria-label={source.label}>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
      <div style={{width:32,height:32,borderRadius:8,background:`${source.color}18`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
        <Icon size={16} style={{color:source.color}} aria-hidden="true"/>
      </div>
      <div className="heading-with-info" style={{flex:'1 1 180px'}}><h3>{source.label}</h3>{information&&<InfoTooltip label={`Informação sobre ${source.label}`}>{information}</InfoTooltip>}</div>
      {status && <span className="text-muted" style={{fontSize:12}}>{status}</span>}
    </div>
    {children}
  </section>
}
