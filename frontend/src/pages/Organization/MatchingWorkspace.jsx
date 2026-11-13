import FilterBar from '../../components/FilterBar'
import {useEffect,useMemo,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {UsersRound, Files} from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import EmptyStatePanel from '../../components/EmptyStatePanel'
import InfoTooltip from '../../components/InfoTooltip'
import {useAuth} from '../../contexts/AuthContext'
import {organizationDirectoryApi} from '../../api/api'
import {readScope,startConfirmedRead} from '../../api/confirmedReads'
import {collectPages} from '../../api/organizationDashboard'
import {formatOpportunityTemporal,commonTemporalLabels} from '../Opportunities/opportunityReadModel'
import './matching-workspace.css'

export default function MatchingWorkspace(){
 const {organization,user}=useAuth()
 if(!organization?.id)return <p>Esta conta não tem uma entidade associada para consultar correspondências.</p>
 return <MatchingTable key={`${user?.id}:${organization.id}`} organizationId={organization.id} scope={readScope(user?.id,organization.id)} organizationName={organization.displayName || organization.name}/>
}
export function MatchingTable({organizationId,organizationName,api:providedApi,scope=null}){
 const api=useMemo(()=>providedApi||organizationDirectoryApi(organizationId),[providedApi,organizationId])
 const [params,setParams]=useSearchParams(),personId=params.get('pessoa')||'',opportunityId=params.get('oportunidade'),origin=params.get('origem')
 // A result this user and organization already received is shown at once and
 // read again; another user or organization never sees it.
 const resultName=`matching:${JSON.stringify([opportunityId||'',origin||'',personId])}`
 const [people,setPeople]=useState(()=>startConfirmedRead(scope,'matching-people').held||[]),[result,setResult]=useState(()=>startConfirmedRead(scope,resultName).held),[loading,setLoading]=useState(!result),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let current=true;const controller=new AbortController(),read=startConfirmedRead(scope,resultName);setLoading(!read.held);setError('');setResult(read.held)
  // StrictMode replays effects; cancel abandoned starts before entering the
  // shared authority queue. Never cache or reuse a previous context's result.
  Promise.resolve().then(()=>current?api.matching(opportunityId?{opportunityId,origin}:personId?{personId}:{},controller.signal):null).then(response=>{if(response)read.keep(response.data);if(current&&response)setResult(response.data)}).catch(error=>{if(current){read.drop();setResult(null);setError(error?.response?.status===409&&error?.response?.data?.error?.code==='LIMIT_EXCEEDED'?'limit':'retry')}} ).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false;controller.abort()}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; resultName, scope are read at that moment.
 },[api,personId,opportunityId,origin,retry])
 // Queue the primary result before the auxiliary selector. Opportunity mode
 // does not display this selector and already receives people from Matching.
 useEffect(()=>{let current=true;const controller=new AbortController(),read=startConfirmedRead(scope,'matching-people');setPeople(read.held||[])
  if(!opportunityId)Promise.resolve().then(()=>current?collectPages(q=>api.people(q,controller.signal),()=>current):null).then(items=>{if(items)read.keep(items);if(current&&items)setPeople(items)}).catch(()=>{if(current){read.drop();setPeople([])}})
  return()=>{current=false;controller.abort()}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope is read at that moment.
 },[api,opportunityId])
 const rows=result?.items||[]
 return <section className="organization-matching">
  <header className="matching-header"><div><p>{organizationName}</p><div className="heading-with-info"><h1>Matching</h1><InfoTooltip label="Informação sobre o matching">As correspondências resultam das áreas temáticas e não determinam elegibilidade. Pode criar uma candidatura sem correspondência.</InfoTooltip></div></div>
   <Link className="btn btn-secondary" to={opportunityId ? `${origin==='CENTRAL'?'/catalogo':'/oportunidades'}/${opportunityId}` : '/catalogo'}>{opportunityId?'Voltar à oportunidade':'Consultar catálogo'}</Link></header>
  <p className="matching-purpose">{opportunityId?'Consulte as pessoas da organização com áreas temáticas em comum com esta oportunidade.':'Escolha um perfil para consultar as oportunidades relacionadas com as suas áreas temáticas.'}</p>
  {!opportunityId&&people.length>0&&<FilterBar aria-label="Filtros de matching"><label>Pessoa<select value={personId} onChange={e=>setParams(e.target.value?{pessoa:e.target.value}:{})}><option value="">O meu perfil</option>{people.map(p=><option key={p.personId} value={p.personId}>{p.name}</option>)}</select></label></FilterBar>}
  {loading&&<LoadingIndicator>A consultar áreas e oportunidades…</LoadingIndicator>}
  {error&&<div role="alert" className="alert alert-error">{error==='limit'?<>O cálculo completo das correspondências excede a capacidade atual. Não foram apresentados resultados. Pode <Link to="/catalogo">consultar o catálogo diretamente</Link>; esta consulta não apresenta correspondências calculadas.</>:'Não foi possível consultar as correspondências. Os resultados não foram calculados; tente novamente.'} {error==='retry'&&<button className="btn btn-outline" onClick={()=>setRetry(n=>n+1)}>Tentar novamente</button>}</div>}
  {!loading&&result?.state==='PROFILE_NOT_LINKED'&&<EmptyStatePanel title="Perfil ainda não associado" description="O gestor pode associar a sua conta à ficha da pessoa nesta organização." actionLabel="Consultar perfil pessoal" actionTo="/perfil"/>}
  {!loading&&result?.state==='NO_AREAS'&&<EmptyStatePanel title="Perfil sem áreas temáticas" description="Selecione as competências da pessoa para encontrar áreas coincidentes." actionLabel="Completar áreas do perfil" actionTo={personId?`/perfil-organizacao/pessoas/${personId}`:'/perfil'}/>}
  {!loading&&result?.state==='READY'&&rows.length===0&&<EmptyStatePanel title="Sem correspondências" description={opportunityId?'Nenhuma pessoa acessível tem áreas coincidentes com esta oportunidade.':'Não foram encontradas oportunidades acessíveis com áreas coincidentes e prazo atual ou não indicado.'}/>}
  {rows.length>0&&<section className="matching-results" aria-labelledby="matching-results-title">
   <h2 id="matching-results-title" className="matching-results-title">
    {opportunityId?<UsersRound size={16} aria-hidden="true"/>:<Files size={16} aria-hidden="true"/>}
    <span>{rows.length} {opportunityId?(rows.length===1?'pessoa':'pessoas'):(rows.length===1?'oportunidade':'oportunidades')} com correspondência{result.person?' — '+result.person.name:''}</span>
   </h2>
   <ul className="matching-list" role="list">
    {rows.map(row=><MatchingResult key={row.personId||row.origin+row.opportunityId} row={row} personMode={Boolean(opportunityId)}/>)}
   </ul>
  </section>}
 </section>
}

function MatchingResult({row,personMode}){
 const title=personMode?row.name:row.title
 const href=personMode?`/perfil-organizacao/pessoas/${row.personId}`:row.href
 const areas=row.matchedAreas
 return <li className="matching-result">
  <div className="matching-result-header">
   <div>
    <h3><Link to={href}>{title}</Link></h3>
    {!personMode&&(row.origin!=='CENTRAL'||row.programmeName)&&<p className="matching-meta">
     {[row.origin==='CENTRAL'?null:'Privada',row.programmeName].filter(Boolean).join(' · ')}
    </p>}
   </div>
   {!personMode&&<OpportunityTiming row={row}/>}
  </div>
  {areas.length>0&&<>
   <ul className="matching-areas" role="list" aria-label="Áreas em comum">
    {areas.map(area=><li key={area.id}>{area.name}</li>)}
   </ul>
   <details className="matching-explanation">
    <summary>Porque aparece?</summary>
    <dl className="matching-evidence">
     {areas.map(area=><div key={area.id}>
      <dt>{area.name}</dt>
      <dd>{area.keywords.length>0
       ? `Termos encontrados na oportunidade: ${area.keywords.map(keyword=>`«${keyword}»`).join(', ')}.`
       : 'Sem termos indicados.'}</dd>
     </div>)}
    </dl>
   </details>
  </>}
 </li>
}

function OpportunityTiming({row}){
 const currentSource=row.sourceVersion===2
 const state=currentSource?commonTemporalLabels[row.temporalState]||'Por confirmar':'Ativa no catálogo'
 const deadline=currentSource
  ? row.deadline&&formatOpportunityTemporal(row.deadline)
  : row.closingDate&&new Date(row.closingDate+'T12:00:00').toLocaleDateString('pt-PT')
 return <div className="matching-timing">
  <span className="badge" data-state={currentSource?row.temporalState:undefined}>{state}</span>
  <p className="matching-meta">
   {currentSource&&row.deadlineKind==='PLANNED'?'Prazo previsto: ':'Prazo: '}
   <span>{deadline||'Não indicado'}</span>
  </p>
 </div>
}
