import {createContext, useContext, useEffect, useState} from 'react'
import {Link} from 'react-router-dom'
import {privateApplicationsApi as api} from '../../api/api'
import {applicationStatusLabels} from '../../utils/applicationStatuses'
import {CHIP} from '../Applications/lifecycle'
import {parseApplicationSummaries} from './applicationSummaries'
import './CatalogApplicationStatuses.css'

const ApplicationStatusesContext = createContext({state:'unavailable',summaries:{}})

export default function CatalogApplicationStatuses({organizationId,scope='',items=[],children}) {
  const ids = [...new Set(items.map(item=>item.id).filter(id=>typeof id==='string' && id))]
  // Remount before rendering another organization, user, or page. An aborted
  // response is also ignored if its transport completes after unmount.
  return <ScopedStatuses key={JSON.stringify([organizationId,scope,ids])} organizationId={organizationId} ids={ids}>{children}</ScopedStatuses>
}

function ScopedStatuses({organizationId,ids,children}) {
  const enabled = Boolean(organizationId && ids.length)
  const [summaries,setSummaries] = useState({})
  const [state,setState] = useState(enabled ? 'loading' : 'unavailable')
  const [retry,setRetry] = useState(0)
  const selection = ids.join(',')
  useEffect(()=>{
    if(!enabled)return
    let active = true
    const controller = new AbortController()
    setState('loading');setSummaries({})
    async function read() {
      try {
        const expected=selection.split(','), result={}
        // The existing endpoint accepts at most 25 opportunity identifiers.
        for(let offset=0;offset<expected.length;offset+=25){
          const batch=expected.slice(offset,offset+25)
          const {data}=await api.opportunitySummaries(batch,controller.signal)
          if(!active)return
          Object.assign(result,parseApplicationSummaries(data,batch))
        }
        if(active){setSummaries(result);setState('ready')}
      } catch {
        if(active){setSummaries({});setState('error')}
      }
    }
    read()
    return ()=>{active=false;controller.abort()}
  },[enabled,organizationId,selection,retry])
  return <ApplicationStatusesContext.Provider value={{state,summaries}}>
    {state==='error' && <p role="alert" className="cr-application-error">Não foi possível consultar candidaturas ou não tem permissão. <button type="button" onClick={()=>setRetry(value=>value+1)}>Repetir consulta de candidaturas</button></p>}
    {children}
  </ApplicationStatusesContext.Provider>
}

export function ApplicationStatusCell({id}) {
  const {state,summaries}=useContext(ApplicationStatusesContext)
  const summary=summaries[id]
  if(state!=='ready'||!summary)return <span className="text-muted">{state==='loading'?'A consultar…':'Indisponível'}</span>
  if(summary.count===0)return <span className="text-muted">Sem candidaturas visíveis</span>
  const badges=Object.keys(applicationStatusLabels).filter(status=>summary.statuses[status]).map(status=><span key={status} className={`chip ${CHIP[status]||'chip-grey'}`}>{summary.count>1?`${summary.statuses[status]} `:''}{applicationStatusLabels[status]}</span>)
  return <div className="cr-application-statuses">
    {summary.count===1
      ? <Link to={`/candidaturas/${summary.applicationId}`} aria-label={`${applicationStatusLabels[Object.keys(summary.statuses)[0]]} — abrir candidatura`}>{badges}</Link>
      : <><Link to={`/candidaturas?${new URLSearchParams({oportunidade:id})}`}>{summary.count} candidaturas</Link><div className="cr-application-status-badges">{badges}</div></>}
  </div>
}
