import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {centralOpportunitiesApi} from '../../api/api'
import {afterPageRequests} from '../../api/pageRequests'
import {opportunityDate} from '../Opportunities/OpportunityPresentation'

export default function CentralRevisionNotice({record}){
 const [current,setCurrent]=useState(null),[unavailable,setUnavailable]=useState(false)
 const id=record.opportunityId,revision=record.centralRevisionId,central=record.origin==='CENTRAL'
 useEffect(()=>{
  let active=true;setCurrent(null);setUnavailable(false)
  const controller=new AbortController()
  // Secondary to the record itself: asked once the page's own requests have settled.
  if(central&&revision)afterPageRequests(controller.signal,()=>centralOpportunitiesApi.get(id).then(response=>{if(active)setCurrent(response.data)}).catch(()=>{if(active)setUnavailable(true)}))
  return()=>{active=false;controller.abort()}
 },[id,revision,central])
 if(!central||!revision)return null
 if(unavailable)return <p role="status">Não foi possível verificar alterações na fonte. A candidatura mantém a revisão original.</p>
 if(!current||current.revisionId===revision&&!current.sourceReview)return null
 const changedDate=(current.snapshot.closingDate||null)!==(record.opportunityClosingDate||null)
 return <aside className="alert alert-warn" role="status">
  <strong>{current.sourceReview?'A fonte requer revisão.':'A oportunidade foi atualizada.'}</strong>
  {changedDate&&<p>O prazo publicado mudou de {opportunityDate(record.opportunityClosingDate)} para {opportunityDate(current.snapshot.closingDate)}.</p>}
  {['CLOSED','CANCELLED'].includes(current.temporal?.state)&&<p>{current.temporal.state==='CANCELLED'?'A oportunidade está cancelada.':'A oportunidade está encerrada.'}</p>}
  <p>A candidatura mantém a revisão original e o prazo interno. <Link to={`/catalogo/${id}`}>Rever informação atual da fonte</Link></p>
 </aside>
}
