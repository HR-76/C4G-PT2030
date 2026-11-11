import {useEffect, useState} from 'react'
import {Link} from 'react-router-dom'
import {Bell, BriefcaseBusiness, CalendarClock, FileText, ListChecks, Search} from 'lucide-react'
import {organizationNotificationsApi,privateApplicationsApi} from '../api/api'
import LoadingIndicator from '../components/LoadingIndicator'
import './technician-dashboard.css'

const labels={overdue:'Em atraso',today:'Hoje',upcoming:'Próximas'}
const date=value=>value?.split('-').reverse().join('/') || 'Sem prazo'

export default function TechnicianDashboard({organization}) {
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0)
 const [alerts,setAlerts]=useState(null),[reviews,setReviews]=useState(null),[alertError,setAlertError]=useState(false),[reviewError,setReviewError]=useState(false)
 const [reviewCursor,setReviewCursor]=useState(null),[reviewLoading,setReviewLoading]=useState(true),[reviewRetry,setReviewRetry]=useState(0)
 useEffect(()=>{
  const controller=new AbortController()
  setData(null);setError(false);setLoading(true)
  privateApplicationsApi.myWork({q:'',applicationQ:'',status:'OPEN',period:'all'},organization.id,controller.signal)
   .then(({data:result})=>{if(!Array.isArray(result?.items))throw new Error('Invalid tasks');if(!controller.signal.aborted)setData(result)})
   .catch(()=>{if(!controller.signal.aborted)setError(true)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[organization.id,attempt])
 useEffect(()=>{
  const controller=new AbortController()
  setAlerts(null);setAlertError(false)
  organizationNotificationsApi.list({},organization.id,controller.signal).then(({data:result})=>{
   const items=result?.notifications||result
   if(!Array.isArray(items))throw new Error('Invalid notifications')
   if(!controller.signal.aborted)setAlerts([...items].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)).slice(0,5))
  }).catch(()=>{if(!controller.signal.aborted)setAlertError(true)})
  return ()=>controller.abort()
 },[organization.id,attempt])
 useEffect(()=>{
  const controller=new AbortController()
  setReviewLoading(true);setReviewError(false);setReviews(null)
  privateApplicationsApi.assignedReviews(reviewCursor?{cursor:reviewCursor}:{},organization.id,controller.signal).then(({data:result})=>{
   if(!Array.isArray(result?.items))throw new Error('Invalid reviews')
   if(!controller.signal.aborted)setReviews(result)
  }).catch(()=>{if(!controller.signal.aborted)setReviewError(true)})
   .finally(()=>{if(!controller.signal.aborted)setReviewLoading(false)})
  return ()=>controller.abort()
 },[organization.id,reviewCursor,reviewRetry])
 return <div className="technician-dashboard">
  <header className="technician-header"><div><p>{organization.displayName||organization.name||'Organização'}</p><h1>O meu dashboard</h1><span>Prioridades e atalhos para o seu trabalho.</span></div><Link className="btn btn-primary" to="/meu-trabalho">Ver o meu trabalho</Link></header>
  <section className="technician-priorities" aria-labelledby="technician-priorities-title">
   <div className="technician-section-heading"><div><ListChecks size={19} aria-hidden="true" data-icon-tone="violet"/><h2 id="technician-priorities-title">As minhas prioridades</h2></div><Link to="/meu-trabalho">Ver todas as tarefas</Link></div>
   {loading?<LoadingIndicator>A carregar tarefas…</LoadingIndicator>:error?<div role="alert" className="technician-feedback"><p>Não foi possível carregar as tarefas.</p><button className="btn btn-outline" onClick={()=>setAttempt(value=>value+1)}>Tentar novamente</button></div>:data?.items?.length?<><ul className="technician-task-list">{data.items.slice(0,5).map(task=><li key={task.taskId}><Link to={`/candidaturas/${task.applicationId}#equipa-tarefas`}><span><strong>{task.title}</strong><small>{task.applicationTitle}</small></span><span className="technician-task-date" data-group={task.group}><CalendarClock size={15} aria-hidden="true"/>{labels[task.group]||'Por concluir'} · {date(task.deadline)}</span></Link></li>)}</ul><p className="technician-list-note">A mostrar {Math.min(data.items.length,5)} de {data.total} tarefas por concluir.</p></>:<div className="technician-feedback"><p>{data?.total>0?'Consulte O meu trabalho para ver as tarefas por concluir.':'Não tem tarefas por concluir nas candidaturas acessíveis.'}</p></div>}
  </section>
  <div className="technician-panels">
   <section className="technician-priorities" aria-labelledby="technician-reviews-title"><div className="technician-section-heading"><div><FileText size={19} aria-hidden="true" data-icon-tone="blue"/><h2 id="technician-reviews-title">Revisões atribuídas a mim</h2></div></div>
    {reviewLoading?<LoadingIndicator>A carregar revisões…</LoadingIndicator>:reviewError?<div role="alert" className="technician-feedback">
     <p>Não foi possível consultar as revisões.</p><button className="btn btn-outline" onClick={()=>{setReviewCursor(null);setReviewRetry(value=>value+1)}}>Repetir consulta de revisões</button>
    </div>:<>
     {reviews?.items.length?<ul className="technician-task-list">{reviews.items.map(item=><li key={item.requestId}>
      <Link to={`/candidaturas/${item.applicationId}#documentos-revisao`}><span><strong>{item.title}</strong><small>Pedido de {new Date(item.requestedAt).toLocaleDateString('pt-PT',{timeZone:'Europe/Lisbon'})}</small></span></Link>
     </li>)}</ul>:<p className="technician-list-note">{reviewCursor||reviews?.nextCursor?'Sem revisões acessíveis nesta página.':'Sem revisões pendentes atribuídas a si.'}</p>}
     {(reviewCursor||reviews?.nextCursor)&&<div className="technician-feedback">
      {reviewCursor&&<button className="btn btn-secondary" onClick={()=>setReviewCursor(null)}>Primeira página</button>}
      {reviews?.nextCursor&&<button className="btn btn-secondary" onClick={()=>setReviewCursor(reviews.nextCursor)}>Mais revisões</button>}
     </div>}
    </>}
   </section>
   <section className="technician-priorities" aria-labelledby="technician-alerts-title"><div className="technician-section-heading"><div><Bell size={19} aria-hidden="true" data-icon-tone="amber"/><h2 id="technician-alerts-title">Alertas recentes</h2></div><Link to="/notificacoes">Ver todos</Link></div>
    {alertError?<div role="alert" className="technician-feedback"><p>Não foi possível consultar os alertas.</p><button className="btn btn-outline" onClick={()=>setAttempt(value=>value+1)}>Tentar novamente</button></div>:!alerts?<LoadingIndicator>A carregar alertas…</LoadingIndicator>:alerts.length?<ul className="technician-task-list">{alerts.map(item=><li key={item.id}><Link to="/notificacoes"><span><strong>{item.title}</strong><small>{item.is_read?'Lido':'Não lido'}{item.created_at&&Number.isFinite(Date.parse(item.created_at))?' · '+new Date(item.created_at).toLocaleDateString('pt-PT',{timeZone:'Europe/Lisbon'}):''}</small></span></Link></li>)}</ul>:<p className="technician-list-note">Não existem alertas disponíveis.</p>}
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
