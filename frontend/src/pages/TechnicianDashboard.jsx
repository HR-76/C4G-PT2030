import {useEffect, useRef, useState} from 'react'
import {Link} from 'react-router-dom'
import {Bell, BriefcaseBusiness, CalendarClock, FileText, ListChecks, Search} from 'lucide-react'
import {privateApplicationsApi} from '../api/api'
import {startConfirmedRead} from '../api/confirmedReads'
import LoadingIndicator from '../components/LoadingIndicator'
import TechnicianCharts from './TechnicianCharts'
import TechnicianDepartments from './TechnicianDepartments'
import './technician-dashboard.css'

const labels={overdue:'Em atraso',today:'Hoje',upcoming:'Próximas'}
const date=value=>value?.split('-').reverse().join('/') || 'Sem prazo'

// One request brings the three panels and the charts. Each shows at once what this user and
// organization last received and is read again on every entry; a part the
// server refused or could not read removes its own panel's data only. `scope`
// is absent only where nothing may be kept.
const recentAlerts=items=>[...items].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)).slice(0,5)
export default function TechnicianDashboard({organization,scope=null}) {
 const [data,setData]=useState(()=>startConfirmedRead(scope,'technician:tasks').held),[loading,setLoading]=useState(!data),[error,setError]=useState(false),[attempt,setAttempt]=useState(0)
 const [alerts,setAlerts]=useState(()=>startConfirmedRead(scope,'technician:alerts').held),[alertError,setAlertError]=useState(false),[reviewError,setReviewError]=useState(false)
 const [reviews,setReviews]=useState(()=>startConfirmedRead(scope,'technician:reviews').held),[reviewLoading,setReviewLoading]=useState(!reviews)
 const [applications,setApplications]=useState(()=>startConfirmedRead(scope,'technician:applications').held),[applicationsError,setApplicationsError]=useState(false)
 // Set once the reader pages through the reviews; until then the dashboard request supplies the first page.
 const [reviewPage,setReviewPage]=useState(null),paging=useRef(false)
 const reviewCursor=reviewPage?.cursor||null
 const showReviews=cursor=>{paging.current=true;setReviewPage(previous=>({cursor,turn:(previous?.turn||0)+1}))}
 const reload=()=>{paging.current=false;setReviewPage(null);setAttempt(value=>value+1)}
 useEffect(()=>{
  const controller=new AbortController(),current=()=>!controller.signal.aborted
  const tasksRead=startConfirmedRead(scope,'technician:tasks'),alertsRead=startConfirmedRead(scope,'technician:alerts'),reviewsRead=startConfirmedRead(scope,'technician:reviews'),applicationsRead=startConfirmedRead(scope,'technician:applications')
  setData(tasksRead.held);setError(false);setLoading(!tasksRead.held)
  setAlerts(alertsRead.held);setAlertError(false)
  setApplications(applicationsRead.held);setApplicationsError(false)
  if(!paging.current){setReviews(reviewsRead.held);setReviewError(false);setReviewLoading(!reviewsRead.held)}
  const settle=(read,value,show,failed)=>{
   if(value){read.keep(value);if(current())show(value)}
   else if(current()){read.drop();show(null);failed(true)}
  }
  privateApplicationsApi.technicianDashboard(organization.id,controller.signal).then(({data:result})=>{
   settle(tasksRead,Array.isArray(result?.tasks?.items)?result.tasks:null,setData,setError)
   // The server returns the most recent first and only the five shown.
   settle(alertsRead,Array.isArray(result?.alerts?.notifications)?recentAlerts(result.alerts.notifications):null,setAlerts,setAlertError)
   if(!paging.current)settle(reviewsRead,Array.isArray(result?.reviews?.items)?result.reviews:null,setReviews,setReviewError)
   // A server that does not send this part yet leaves its chart out; a refused part is reported in it.
   const counted=result?.applications
   if(Number.isSafeInteger(counted?.total))settle(applicationsRead,counted,setApplications,setApplicationsError)
   else{applicationsRead.drop();if(current()){setApplications(null);setApplicationsError(Boolean(counted))}}
  }).catch(()=>{
   if(!current())return
   settle(tasksRead,null,setData,setError);settle(alertsRead,null,setAlerts,setAlertError);applicationsRead.drop();setApplications(null)
   if(!paging.current)settle(reviewsRead,null,setReviews,setReviewError)
  }).finally(()=>{if(current()){setLoading(false);if(!paging.current)setReviewLoading(false)}})
  return ()=>controller.abort()
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope is read at that moment.
 },[organization.id,attempt])
 useEffect(()=>{
  if(!reviewPage)return
  // Only the first page is kept; further pages are bound to their cursor.
  const controller=new AbortController(),read=startConfirmedRead(scope,reviewPage.cursor?null:'technician:reviews')
  setReviewLoading(!read.held);setReviewError(false);setReviews(read.held)
  privateApplicationsApi.assignedReviews(reviewPage.cursor?{cursor:reviewPage.cursor}:{},organization.id,controller.signal).then(({data:result})=>{
   if(!Array.isArray(result?.items))throw new Error('Invalid reviews')
   read.keep(result);if(!controller.signal.aborted)setReviews(result)
  }).catch(()=>{if(!controller.signal.aborted){read.drop();setReviews(null);setReviewError(true)}})
   .finally(()=>{if(!controller.signal.aborted)setReviewLoading(false)})
  return ()=>controller.abort()
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope is read at that moment.
 },[organization.id,reviewPage])
 return <div className="technician-dashboard">
  <header className="technician-header"><div><p>{organization.displayName||organization.name||'Organização'}</p><h1>O meu dashboard</h1><span>Prioridades e atalhos para o seu trabalho.</span></div><Link className="btn btn-primary" to="/meu-trabalho">Ver o meu trabalho</Link></header>
  <TechnicianCharts applications={applicationsError?null:applications||undefined} tasks={error?null:data||undefined}/>
  <section className="technician-priorities" aria-labelledby="technician-priorities-title">
   <div className="technician-section-heading"><div><ListChecks size={19} aria-hidden="true" data-icon-tone="violet"/><h2 id="technician-priorities-title">As minhas prioridades</h2></div><Link to="/meu-trabalho">Ver todas as tarefas</Link></div>
   {loading?<LoadingIndicator>A carregar tarefas…</LoadingIndicator>:error?<div role="alert" className="technician-feedback"><p>Não foi possível carregar as tarefas.</p><button className="btn btn-outline" onClick={reload}>Tentar novamente</button></div>:data?.items?.length?<><ul className="technician-task-list">{data.items.slice(0,5).map(task=><li key={task.taskId}><Link to={`/candidaturas/${task.applicationId}#equipa-tarefas`}><span><strong>{task.title}</strong><small>{task.applicationTitle}</small></span><span className="technician-task-date" data-group={task.group}><CalendarClock size={15} aria-hidden="true"/>{labels[task.group]||'Por concluir'} · {date(task.deadline)}</span></Link></li>)}</ul><p className="technician-list-note">A mostrar {Math.min(data.items.length,5)} de {data.total} tarefas por concluir.</p></>:<div className="technician-feedback"><p>{data?.total>0?'Consulte O meu trabalho para ver as tarefas por concluir.':'Não tem tarefas por concluir nas candidaturas acessíveis.'}</p></div>}
  </section>
  <TechnicianDepartments organizationId={organization.id}/>
  <div className="technician-panels">
   <section className="technician-priorities" aria-labelledby="technician-reviews-title"><div className="technician-section-heading"><div><FileText size={19} aria-hidden="true" data-icon-tone="blue"/><h2 id="technician-reviews-title">Revisões atribuídas a mim</h2></div></div>
    {reviewLoading?<LoadingIndicator>A carregar revisões…</LoadingIndicator>:reviewError?<div role="alert" className="technician-feedback">
     <p>Não foi possível consultar as revisões.</p><button className="btn btn-outline" onClick={()=>reload()}>Repetir consulta de revisões</button>
    </div>:<>
     {reviews?.items.length?<ul className="technician-task-list">{reviews.items.map(item=><li key={item.requestId}>
      <Link to={`/candidaturas/${item.applicationId}#documentos-revisao`}><span><strong>{item.title}</strong><small>Pedido de {new Date(item.requestedAt).toLocaleDateString('pt-PT',{timeZone:'Europe/Lisbon'})}</small></span></Link>
     </li>)}</ul>:<p className="technician-list-note">{reviewCursor||reviews?.nextCursor?'Sem revisões acessíveis nesta página.':'Sem revisões pendentes atribuídas a si.'}</p>}
     {(reviewCursor||reviews?.nextCursor)&&<div className="technician-feedback">
      {reviewCursor&&<button className="btn btn-secondary" onClick={()=>showReviews(null)}>Primeira página</button>}
      {reviews?.nextCursor&&<button className="btn btn-secondary" onClick={()=>showReviews(reviews.nextCursor)}>Mais revisões</button>}
     </div>}
    </>}
   </section>
   <section className="technician-priorities" aria-labelledby="technician-alerts-title"><div className="technician-section-heading"><div><Bell size={19} aria-hidden="true" data-icon-tone="amber"/><h2 id="technician-alerts-title">Alertas recentes</h2></div><Link to="/notificacoes">Ver todos</Link></div>
    {alertError?<div role="alert" className="technician-feedback"><p>Não foi possível consultar os alertas.</p><button className="btn btn-outline" onClick={reload}>Tentar novamente</button></div>:!alerts?<LoadingIndicator>A carregar alertas…</LoadingIndicator>:alerts.length?<ul className="technician-task-list">{alerts.map(item=><li key={item.id}><Link to="/notificacoes"><span><strong>{item.title}</strong><small>{item.is_read?'Lido':'Não lido'}{item.created_at&&Number.isFinite(Date.parse(item.created_at))?' · '+new Date(item.created_at).toLocaleDateString('pt-PT',{timeZone:'Europe/Lisbon'}):''}</small></span></Link></li>)}</ul>:<p className="technician-list-note">Não existem alertas disponíveis.</p>}
   </section>
  </div>
  <section className="technician-shortcuts" aria-labelledby="technician-shortcuts-title"><h2 id="technician-shortcuts-title">Continuar o trabalho</h2><div className="technician-shortcut-grid">
   <Link to="/candidaturas"><BriefcaseBusiness size={20} aria-hidden="true" data-icon-tone="rose"/><strong>Candidaturas</strong><span>Consulte as candidaturas a que tem acesso.</span></Link>
   <Link to="/candidaturas"><FileText size={20} aria-hidden="true" data-icon-tone="blue"/><strong>Documentos e revisões</strong><span>Abra uma candidatura para consultar os documentos disponíveis.</span></Link>
   <Link to="/notificacoes"><Bell size={20} aria-hidden="true" data-icon-tone="amber"/><strong>Alertas</strong><span>Consulte os avisos e as suas ligações.</span></Link>
   <Link to="/catalogo"><Search size={20} aria-hidden="true" data-icon-tone="sky"/><strong>Oportunidades</strong><span>Explore o catálogo de financiamento.</span></Link>
  </div></section>
 </div>
}
