export default function InterventionAreas({ classification, detail = false }) {
  const areas = classification?.areas || []
  if (!areas.length) return <span className="text-muted">Por classificar</span>
  return <div className="intervention-areas"><div className="intervention-area-badges">{areas.map(area => <span key={area.code} className="chip intervention-area-badge" data-area={area.code}>{area.label}</span>)}</div>{detail && <details><summary>Fundamento da classificação</summary><p>{areas.some(area=>area.evidence?.some(e=>e.ruleId==='editorial:selection'))?'Área selecionada pela Administração C4G.':'Classificação C4G com base na informação disponível da fonte.'}</p>{areas.map(area => <div key={area.code}><strong>{area.label}</strong><ul>{area.evidence?.map((e, i) => <li key={i}>{e.excerpt}</li>)}</ul></div>)}</details>}</div>
}
