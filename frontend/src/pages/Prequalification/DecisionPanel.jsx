import {useEffect,useRef,useState} from 'react'
import {prequalificationApi as api} from '../../api/api'
import {saveIntention,removeIntention} from './intentions'

export const decisionLabels={REQUEST_INFORMATION:'Solicitar informação',KEEP_UNDER_REVIEW:'Manter em análise',DISCARD_FROM_ANALYSIS:'Descartar com motivo'}
const defaults={REQUEST_INFORMATION:'INFORMATION_MISSING',KEEP_UNDER_REVIEW:'FURTHER_REVIEW',DISCARD_FROM_ANALYSIS:'OUT_OF_SCOPE_FOR_ORGANIZATION'}
export default function DecisionPanel({result,identity,pending,session,onPending,onComplete}){
 const [history,setHistory]=useState(null),[decision,setDecision]=useState('REQUEST_INFORMATION'),[reason,setReason]=useState('INFORMATION_MISSING'),[text,setText]=useState(''),[criteria,setCriteria]=useState([]),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const live=useRef(false),mutex=useRef(false),id=result.evaluationId
 const blocked=pending.some(p=>p.operation==='PQ1_ACTIVATE'||p.resourceId===id||p.resourceId===result.result.identity.opportunityId)
 async function load(){try{const value=(await api.decisions(id)).data;if(live.current){setHistory(value);setConfirmed(false)}}catch{if(live.current)setError('Não foi possível consultar o histórico autorizado.')}}
 useEffect(()=>{live.current=true;load();const invalidate=()=>setConfirmed(false);window.addEventListener('focus',invalidate);return()=>{live.current=false;window.removeEventListener('focus',invalidate)}},[id])
 async function more(){if(mutex.current)return;mutex.current=true;setBusy(true);try{const value=(await api.decisions(id,history.nextCursor)).data;if(live.current)setHistory({...value,items:[...history.items,...value.items]})}catch{if(live.current)setError('Histórico indisponível.')}finally{mutex.current=false;if(live.current)setBusy(false)}}
 async function submit(){if(mutex.current||!confirmed||blocked||!history?.canDecide)return;mutex.current=true;setBusy(true);setError('');let intent,sent=false
  try{if(!await session())return;intent={...identity,operation:'PQ1_DECIDE',resourceId:id,opportunityId:result.result.identity.opportunityId,idempotencyKey:crypto.randomUUID()};saveIntention(intent);onPending();sent=true
   const response=(await api.decide(id,{decision,reasonCode:reason,justification:text,criterionIds:criteria,expectedDecisionId:history.head?.decisionId||null,expectedGeneration:history.head?.generation||0,idempotencyKey:intent.idempotencyKey})).data
   if(!live.current)return
   if(response.status==='UNKNOWN'){setError('Resultado por confirmar. Consulte a intenção original; não repita a decisão.');return}
   removeIntention(intent.idempotencyKey);onPending();if(response.status==='FAILED_FINAL'){setError('Rollback comprovado. A decisão não foi registada; atualize e confirme novamente.');await load();return}await onComplete()
  }catch(e){if(live.current){if(intent&&(!sent||[400,401,403,404,409].includes(e.response?.status))){removeIntention(intent.idempotencyKey);onPending()}
    setError(e.response?.status===409?'A avaliação ou decisão mudou. Atualize a consulta e confirme novamente.':'Resultado não confirmado. Consulte a intenção original se estiver pendente.')}}finally{mutex.current=false;if(live.current){setBusy(false);setConfirmed(false)}}
 }
 return <section aria-label="Decisão humana"><h3>Decisão humana sobre esta avaliação</h3><p>A decisão não altera a análise automática nem cria candidatura. Solicitar informação regista apenas uma necessidade: nenhuma comunicação é enviada.</p>
  {error&&<p role="alert">{error}</p>}
  {history&&<><h4>Histórico de decisões</h4>{history.items.length===0?<p>Sem decisões nesta avaliação.</p>:<ol>{history.items.map(d=><li key={d.decisionId}>{decisionLabels[d.decision]} — {d.decisionId===history.head?.decisionId?'Vigente nesta avaliação':'Histórica'} — {d.createdAt}<p>{d.justification}</p>{d.decision==='REQUEST_INFORMATION'&&<p>Necessidade registada; nenhuma comunicação enviada.</p>}</li>)}</ol>}{history.nextCursor&&<button disabled={busy} onClick={more}>Mais decisões</button>}
   {!history.canDecide||result.freshness!=='CURRENT'?<p>É necessária uma avaliação atual e autorização para decidir.</p>:<fieldset disabled={busy||blocked}><legend>Registar decisão separada</legend>
    <label>Decisão <select aria-label="Decisão" value={decision} onChange={e=>{setDecision(e.target.value);setReason(defaults[e.target.value]);setCriteria([]);setConfirmed(false)}}>{Object.entries(decisionLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    {decision==='DISCARD_FROM_ANALYSIS'&&<label>Motivo da decisão <select value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false)}}><option value="OUT_OF_SCOPE_FOR_ORGANIZATION">Fora do âmbito da organização</option><option value="OTHER_JUSTIFIED">Outro motivo justificado</option></select></label>}
    {decision==='REQUEST_INFORMATION'&&<fieldset><legend>Critérios com informação em falta</legend>{result.result.lines.map(l=><label key={l.criterionId}><input type="checkbox" checked={criteria.includes(l.criterionId)} onChange={e=>{setCriteria(e.target.checked?[...criteria,l.criterionId]:criteria.filter(v=>v!==l.criterionId));setConfirmed(false)}}/>{l.interpretationText||l.criterionId}</label>)}</fieldset>}
    <label>Justificação ou informação necessária <textarea aria-label="Justificação ou informação necessária" value={text} maxLength={2000} onChange={e=>{setText(e.target.value);setConfirmed(false)}}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo esta decisão sobre a avaliação exata</label>
    <button onClick={submit} disabled={!confirmed||!text.trim()||(decision==='REQUEST_INFORMATION'&&!criteria.length)}>Registar decisão</button>
   </fieldset>}
  </>}
 </section>
}
