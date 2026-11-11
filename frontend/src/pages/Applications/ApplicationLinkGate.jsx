import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { authApi } from '../../api/api'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export default function ApplicationLinkGate({children}) {
 const {id}=useParams(),[params]=useSearchParams(),{user,organization,loading,selectOrganization}=useAuth()
 const values=params.getAll('organizacao'),target=values[0]?.toLowerCase()
 if(!values.length)return children
 if(values.length!==1||!uuid.test(target)||!uuid.test(id||''))return <Unavailable/>
 if(loading)return <p role="status">A confirmar a sessão…</p>
 if(!user)return <Unavailable/>
 if(organization?.id?.toLowerCase()===target)return children
 return <ConfirmOrganization key={`${user.id}:${id}:${target}`} target={target} selectOrganization={selectOrganization}/>
}
function Unavailable(){return <section className="card"><h1>Link indisponível</h1><p>Não foi possível abrir esta candidatura neste contexto.</p><Link to="/candidaturas">Voltar às candidaturas</Link></section>}
function ConfirmOrganization({target,selectOrganization}) {
 const [entry,setEntry]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0)
 const active=useRef(true),sending=useRef(false)
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 useEffect(()=>{
  const controller=new AbortController();let current=true
  setLoading(true);setEntry(null);setError('')
  authApi.organizations(controller.signal).then(({data})=>{
   if(current)setEntry(data.organizations?.find(item=>item.id?.toLowerCase()===target)||null)
  }).catch(()=>{if(current)setError('Não foi possível confirmar as organizações disponíveis.')}).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false;controller.abort()}
 },[target,retry])
 async function confirm(){
  if(sending.current)return
  sending.current=true;setBusy(true);setError('')
  try{await selectOrganization(target)}catch{if(active.current)setError('Não foi possível mudar de organização. Confirme o acesso e tente novamente.')}
  finally{sending.current=false;if(active.current)setBusy(false)}
 }
 if(loading)return <p role="status">A confirmar o acesso à organização…</p>
 if(!entry&&!error)return <Unavailable/>
 return <section className="card"><h1>Abrir candidatura noutra organização</h1>
  {entry&&<p>Este link pertence a <strong>{entry.displayName}</strong>. Confirme para continuar nessa organização.</p>}
  {error&&<p role="alert">{error}</p>}
  {entry?<button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>{busy?'A mudar de organização…':'Confirmar organização'}</button>:<button type="button" className="btn btn-outline" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button>}
  {' '}<Link to="/candidaturas">Cancelar</Link>
 </section>
}
