import React, { Profiler, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CatalogExposureGate from '../../../frontend/src/pages/Opportunities/CatalogExposureGate'
import ApplicationWork from '../../../frontend/src/pages/Applications/ApplicationWork'

const count=500
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const responsibles=Array.from({length:count},(_,i)=>({membershipId:id(i+10),name:`Pessoa ${i}`}))
const participants=responsibles.map(p=>({membershipId:p.membershipId,active:true}))
const tasks=responsibles.map((p,i)=>({taskId:id(i+1000),title:`Tarefa ${i}`,status:i%3?'OPEN':'COMPLETED',responsibleMembershipId:p.membershipId,deadline:'2027-12-31'}))
window.syntheticWork={revision:1,canEdit:false,participants,tasks}
window.measure={gateCommits:[],workCommits:[],polls:0}
const interval=window.setInterval
window.setInterval=(fn,ms,...args)=>interval(fn,ms===15000?150:ms,...args)
const availability=async()=>{window.measure.polls++;return {version:'gcni-catalog-exposure/1.0',available:true,revision:1,validUntil:new Date(Date.now()+30000).toISOString()}}
function Demo(){
 const [counter,setCounter]=useState(0)
 return <>
  <Profiler id="gate" onRender={(_id,phase,duration)=>window.measure.gateCommits.push({phase,duration})}><CatalogExposureGate scope="synthetic-user:synthetic-org" api={availability}><p>Conteúdo autorizado sintético</p></CatalogExposureGate></Profiler>
  <button id="bump" onClick={()=>setCounter(n=>n+1)}>Atualizar {counter}</button>
  <Profiler id="work" onRender={(_id,phase,duration)=>window.measure.workCommits.push({phase,duration})}><ApplicationWork applicationId={id(1)} organizationId={id(2)} userId={id(3)} responsibles={responsibles} responsiblesNext={null} loadMoreResponsibles={()=>{}} canEdit={false}/></Profiler>
 </>
}
createRoot(document.getElementById('root')).render(<Demo/>)
