import { useEffect, useRef, useState } from 'react'
import { Columns3 } from 'lucide-react'

export const catalogColumns = [
  ['estado','Estado do aviso'], ['tipo','Tipificação'], ['abertura','Abertura'],
  ['fecho','Fecho'], ['areas','Áreas de intervenção'], ['dotacao','Dotação da call'],
  ['programa','Programa financiador'], ['interesse','Interesse'],
]

export function selectedCatalogColumns(params, hasOrganization) {
  if (!params.has('colunas')) return null
  const keys = params.get('colunas').split(',')
  return catalogColumns.map(([key])=>key).filter(key=>keys.includes(key) && (hasOrganization || key!=='interesse'))
}

export default function CatalogColumnVisibility({ selected, hasOrganization, onChange }) {
  const panel = useRef(null)
  const [mobile,setMobile] = useState(()=>window.matchMedia?.('(max-width:768px)').matches || false)
  useEffect(()=>{
    const media = window.matchMedia?.('(max-width:768px)')
    if (!media) return
    const update = () => setMobile(media.matches)
    media.addEventListener('change',update)
    return () => media.removeEventListener('change',update)
  },[])
  const available = catalogColumns.filter(([key])=>hasOrganization || key!=='interesse')
  const visible = selected ?? available.map(([key])=>key).filter(key=>!['tipo','programa',...(mobile?['abertura','areas']:[])].includes(key))
  function preset(keys) {
    onChange(keys)
    panel.current.open=false
    panel.current.querySelector('summary').focus()
  }
  return <details className="catalog-columns" ref={panel} onKeyDown={event=>{
    if(event.key==='Escape' && panel.current.open){event.preventDefault();panel.current.open=false;panel.current.querySelector('summary').focus()}
  }}>
    <summary className="btn btn-outline btn-sm"><Columns3 size={15} aria-hidden="true"/>Colunas</summary>
    <fieldset><legend>Colunas visíveis</legend>
      <label><input type="checkbox" checked disabled/>Oportunidade (fixa)</label>
      {available.map(([key,label])=><label key={key}><input type="checkbox" checked={visible.includes(key)} onChange={e=>onChange(e.target.checked?[...visible,key]:visible.filter(value=>value!==key))}/>{label}</label>)}
      <div className="column-presets">
        <button type="button" onClick={()=>preset(['fecho','dotacao','programa'])}>Comparar programa, fecho e dotação</button>
        <button type="button" onClick={()=>preset(available.map(([key])=>key))}>Todas as colunas</button>
        <button type="button" onClick={()=>preset(null)}>Vista resumida</button>
      </div>
    </fieldset>
  </details>
}
