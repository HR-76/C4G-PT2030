import DecisionPanel from './DecisionPanel'
import {useEffect,useRef,useState} from 'react'
import {Link,useLocation,useNavigate} from 'react-router-dom'
import {useAuth} from '../../contexts/AuthContext'
import {prequalificationApi as api,clearCsrfToken} from '../../api/api'
import {pendingIntentions,saveIntention,removeIntention} from './intentions'
import InfoTooltip from '../../components/InfoTooltip'
import '../Editorial/editorial.css'
import './prequalification.css'
const labels={SATISFIED:'Demonstrado pela evidência',UNKNOWN:'Informação insuficiente',AFFINITY_OBSERVED:'Correspondência observada',AFFINITY_NOT_OBSERVED:'Correspondência não observada'}
const freshness={CURRENT:'Entradas atuais',REVIEW_REQUIRED:'Entradas alteradas — rever análise',UNAVAILABLE:'Indisponível para utilização atual'}
const reasons={VERIFIED_AT_EVALUATION:'Verificação válida no instante avaliado',COMPETENCY_KNOWLEDGE_UNKNOWN:'Conhecimento não declarado',COMPETENCY_NOT_DECLARED:'Competência não declarada; não demonstra incumprimento',NO_VERIFICATION:'Sem verificação',VERIFICATION_REVOKED:'Verificação revogada',VERIFICATION_EXPIRED:'Verificação expirada',KNOWLEDGE_UNKNOWN:'Informação desconhecida',EXACT_CONCEPT_MATCH:'Mesmo conceito e release',NO_EXACT_CONCEPT_MATCH:'Sem correspondência exata; não representa impedimento obrigatório'}

function CriterionResult({line}){
 const {criteriaEvidence,source}=line
 const sourceLabel=source&&[source.label,source.reference,source.versionLabel].filter(Boolean).join(' · ')
 return <li className="prequalification-criterion">
  <div className="prequalification-criterion-heading">
   <h4>{line.interpretationText||line.criterionId}</h4>
   <span className="prequalification-result-label" data-result={line.result}>{labels[line.result]||'Resultado não indicado'}</span>
  </div>
  <p className="prequalification-reason"><strong>Motivo:</strong> {reasons[line.reason]||'Não indicado'}</p>
  <details className="prequalification-disclosure">
   <summary>Ver evidência</summary>
   <dl className="prequalification-evidence">
    <div><dt>Excerto</dt><dd>{criteriaEvidence?.excerpt?<blockquote>{criteriaEvidence.excerpt}</blockquote>:'Não indicado'}</dd></div>
    <div><dt>Fonte</dt><dd>{sourceLabel||'Não indicada'}</dd></div>
    <div><dt>Justificação</dt><dd>{criteriaEvidence?.justification||'Não indicada'}</dd></div>
    <div><dt>Verificações</dt><dd>{line.verificationIds.join(', ')||'Nenhuma'}</dd></div>
    <div><dt>Declarações</dt><dd>{line.assertionVersionIds.join(', ')||'Nenhuma'}</dd></div>
    <div><dt>Itens</dt><dd>{line.itemVersionIds.join(', ')||'Nenhum'}</dd></div>
   </dl>
  </details>
 </li>
}

function errorText(e){if(e.response?.data?.error?.code==='LIMIT_EXCEEDED')return 'O material excede o limite técnico desta operação. Os registos anteriores foram preservados.';return ({400:'Pedido inválido.',401:'Sessão expirada.',403:'Não foi possível autorizar a ação.',404:'Registo indisponível.',409:'As entradas ou a confirmação mudaram. Volte a consultar e confirme novamente.'})[e.response?.status]||'Serviço indisponível ou resultado por confirmar.'}
export default function Prequalification(){const auth=useAuth(),location=useLocation();if(!auth.organization)return <p>Esta conta não tem uma entidade associada.</p>;return <Workspace key={auth.user.id+auth.organization.id+location.search} auth={auth} search={location.search}/>}
export function Workspace({auth,search=''}){
 const params=new URLSearchParams(search),opportunityId=params.get('opportunityId'),evaluationId=params.get('evaluationId'),navigate=useNavigate()
 const [context,setContext]=useState(null),[selected,setSelected]=useState(''),[preview,setPreview]=useState(null),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false)
 const [active,setActive]=useState(null),[snapshot,setSnapshot]=useState(null),[head,setHead]=useState(null),[result,setResult]=useState(null),[history,setHistory]=useState({items:[]})
 const [pending,setPending]=useState([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const alive=useRef(false),mutex=useRef(false),generation=useRef(0)
 const current=n=>alive.current&&generation.current===n
 const identity={userId:auth.user.id,organizationId:auth.organization.id}
 async function session(){const value=await api.session(()=>auth.refreshSession({timeout:10000}));if(value.user?.id!==identity.userId||value.organization?.id!==identity.organizationId)throw Error('Context changed');return alive.current}
 function reloadPending(){const values=pendingIntentions(identity.userId,identity.organizationId);setPending(values);return values}
 async function load(){const n=++generation.current;setLoading(true);setConfirmed(false);setPreview(null);setResult(null);setSnapshot(null);setHead(null);setError('')
  try{if(!await session()||!current(n))return;reloadPending();const c=(await api.context()).data;if(!current(n))return;setContext(c)
   const a=(await api.active()).data.active;if(!current(n))return;setActive(a)
   if(a){const s=(await api.snapshot(a.snapshotId)).data;if(!current(n))return;setSnapshot(s)}
   if(opportunityId){const h=(await api.criteria(opportunityId)).data;if(!current(n))return;setHead(h)}
   if(evaluationId){const r=(await api.result(evaluationId)).data;if(!current(n))return;setResult(r)}
   const h=(await api.history()).data;if(current(n))setHistory(h)
  }catch(e){if(current(n)){setError(errorText(e));setContext(null);setActive(null);setHead(null);setResult(null)}}finally{if(current(n))setLoading(false)}
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load is read at that moment.
 useEffect(()=>{alive.current=true;load();const focus=()=>{setConfirmed(false);setPreview(null);if(!mutex.current)load()};window.addEventListener('focus',focus);return()=>{alive.current=false;generation.current += 1;window.removeEventListener('focus',focus)}},[])
 const activationPending=pending.some(p=>p.operation==='PQ1_ACTIVATE'),evaluationPending=pending.some(p=>(p.operation==='PQ1_EVALUATE'&&p.resourceId===opportunityId)||(p.operation==='PQ1_DECIDE'&&p.opportunityId===opportunityId))
 async function preflight(){if(mutex.current||!selected)return;mutex.current=true;setBusy(true);setConfirmed(false);setPreview(null);setError('');try{if(!await session())return;const value=(await api.preview(selected)).data;if(alive.current)setPreview(value)}catch(e){if(alive.current)setError(errorText(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}}
 async function finish(receipt){if(receipt.decisionId){await load();return}if(receipt.evaluationId)navigate('/pre-qualificacao?evaluationId='+receipt.evaluationId);else await load()}
 async function write(method){if(mutex.current||!confirmed||activationPending||(method==='evaluate'&&evaluationPending))return;mutex.current=true;setBusy(true);setError('');let intent,sent=false
  try{if(!await session())return;const idempotencyKey=crypto.randomUUID(),resourceId=method==='activate'?identity.organizationId:opportunityId
   intent={...identity,resourceId,idempotencyKey,operation:method==='activate'?'PQ1_ACTIVATE':'PQ1_EVALUATE'};saveIntention(intent);reloadPending();sent=true
   const response=method==='activate'?await api.activate({versionId:selected,previewToken:preview.concurrencyToken,expectedActivationId:preview.expectedActivationId,expectedGeneration:preview.expectedGeneration,reason,idempotencyKey}):await api.evaluate(opportunityId,{opportunityRevisionId:head.opportunityRevisionId,criteriaRevisionId:head.head.revisionId,activationId:active.activationId,generation:active.generation,idempotencyKey})
   if(!alive.current)return
   if(response.data.status==='UNKNOWN'){setNotice('Resultado por confirmar. Consulte a intenção; não repita a gravação.');return}
   if(response.data.status==='FAILED_FINAL'){removeIntention(idempotencyKey);reloadPending();setNotice('Rollback comprovado. Volte a consultar.');await load();return}
   removeIntention(idempotencyKey);reloadPending();setNotice('Operação confirmada.');await finish(response.data)
  }catch(e){if(alive.current){if(intent&&(!sent||[400,401,403,404,409].includes(e.response?.status))){removeIntention(intent.idempotencyKey);reloadPending()}setError(errorText(e));if(sent&&(!e.response?.status||e.response?.status>=500))setNotice('Resultado por confirmar. A falha de comunicação não demonstra rollback.')}}finally{mutex.current=false;if(alive.current){setBusy(false);setConfirmed(false);setPreview(null)}}
 }
 async function recover(intent){if(mutex.current)return;mutex.current=true;setBusy(true);setError('');try{if(!await session())return;const {userId,organizationId,opportunityId:unusedOpportunity,...body}=intent,r=(await api.lookup(body)).data;if(!alive.current)return
  if(['CONFIRMED','FAILED_FINAL'].includes(r.status)){removeIntention(intent.idempotencyKey);reloadPending();setNotice(r.status==='CONFIRMED'?'Operação confirmada.':'Rollback comprovado. Volte a consultar.');if(r.receipt)await finish(r.receipt);else await load()}
  else setNotice('Resultado por confirmar. Contacte o suporte com a intenção '+intent.idempotencyKey+' e referência '+r.correlationId+'. Não existe garantia de resolução automática.')
 }catch(e){if(alive.current)setError(errorText(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}}
 async function more(kind){if(mutex.current)return;mutex.current=true;setBusy(true);try{if(!await session())return;const old=kind==='context'?context:history,value=(await (kind==='context'?api.context(old.nextCursor):api.history(old.nextCursor))).data;if(alive.current)(kind==='context'?setContext:setHistory)({...value,items:[...old.items,...value.items]})}catch(e){if(alive.current)setError(errorText(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}}
 async function mfa(){setConfirmed(false);setPreview(null);try{if(await session()){clearCsrfToken();api.stepUp(context.mfa.category,'/pre-qualificacao'+search)}}catch(e){if(alive.current)setError(errorText(e))}}
 const disabled=loading||busy,canEvaluate=context?.canEvaluate===true&&head?.head?.state==='CONFIRMED'&&head.head.freshness==='CURRENT'&&active
 return <section className="editorial prequalification"><div className="heading-with-info"><h2>Análise parcial de oportunidades</h2><InfoTooltip label="Informação sobre a análise parcial">Esta análise cobre apenas parte dos critérios e não confirma a elegibilidade.</InfoTooltip></div>
  <nav><Link to="/publicacao-perfil">Publicações do perfil</Link> · <Link to="/oportunidades">Escolher oportunidade</Link> · <button disabled={disabled} onClick={load}>Atualizar consulta</button></nav>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{loading&&<p role="status">A consultar…</p>}
  {pending.map(p=><aside key={p.idempotencyKey} aria-label="Intenção pendente"><p>Resultado por confirmar: {p.operation==='PQ1_ACTIVATE'?'ativação':p.operation==='PQ1_DECIDE'?'decisão':'avaliação'}. Intenção {p.idempotencyKey}</p><button disabled={disabled} onClick={()=>recover(p)}>Consultar resultado da intenção</button><p>Não repita a gravação. Se persistir, contacte o suporte com esta referência. Não existe resolução automática garantida. Outras operações independentes permanecem disponíveis.</p></aside>)}
  {!loading&&context&&<><h3>Ativar publicação para análise parcial</h3><label>Publicação <select aria-label="Publicação" value={selected} disabled={disabled||activationPending} onChange={e=>{setSelected(e.target.value);setPreview(null);setConfirmed(false)}}><option value="">Selecione uma publicação</option>{context.items.map(p=><option key={p.versionId} value={p.versionId}>{p.publishedAt} · {p.versionId}</option>)}</select></label>
   {context.nextCursor&&<button disabled={disabled} onClick={()=>more('context')}>Mais publicações</button>}
   <label>Motivo <textarea aria-label="Motivo" value={reason} maxLength={2000} disabled={disabled||activationPending} onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/></label>
   <button disabled={disabled||activationPending||!selected} onClick={preflight}>Pré-validar publicação</button>
   {preview&&<section aria-label="Pré-validação"><h4>Pré-validação concluída</h4><p>Publicação {preview.versionId}; revisão de origem {preview.origin.sourceRevision||preview.origin.revision}. Substitui a geração {preview.expectedGeneration}.</p><p>Temas, prioridades e competências; verificações históricas preservadas. A validade para avaliação é revalidada no consumo.</p><p>Confirmação válida até {preview.expiresAt}.</p>
    {!preview.capability.allowed&&<p>{preview.capability.reason==='APPROVAL_STALE'?'A aprovação deixou de ser válida. É necessária uma nova aprovação editorial.':preview.capability.reason==='SOD_VIOLATION'?'Não pode ativar uma publicação em cuja autoria participou.':'A ativação exige autorização explícita e MFA recente.'}</p>}
    <button disabled={disabled} onClick={mfa}>Confirmar autentica??o</button>
    <label><input type="checkbox" checked={confirmed} disabled={disabled||!preview.capability.allowed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo esta publicação, geração e motivo</label>
    <button disabled={disabled||activationPending||!confirmed||!reason.trim()||!preview.capability.allowed} onClick={()=>write('activate')}>Ativar para análise parcial</button></section>}
   <h3>Perfil ativo</h3>{active?<p>Ativo — geração {active.generation}; publicação {active.origin.versionId}. Snapshot {active.snapshotId}.</p>:<p>Sem publicação ativa para esta análise.</p>}
   {active&&<p><Link to={'/publicacao-perfil/versoes/'+active.origin.versionId}>Consultar publicação exata e evidências</Link></p>}{snapshot&&<p>Snapshot imutável consultado. {snapshot.observation.verifications.length} verificações; estados atuais: {snapshot.observation.verifications.map(v=>v.status).join(', ')||'sem verificações'}.</p>}
   {opportunityId&&<section aria-label="Avaliar oportunidade"><h3>Avaliar oportunidade</h3><Link to={'/oportunidades/'+opportunityId}>Consultar oportunidade e critérios</Link><p>Critérios: {head?.head?.revisionId||'indisponíveis'}. {canEvaluate?'Revisão confirmada e atual.':'São necessários critérios confirmados atuais e um perfil ativo.'}</p>
    <label><input type="checkbox" checked={confirmed&&!preview} disabled={disabled||!canEvaluate||activationPending||evaluationPending} onChange={e=>{setPreview(null);setConfirmed(e.target.checked)}}/>Confirmo estas entradas para a análise parcial</label>
    <button disabled={disabled||!canEvaluate||!confirmed||!!preview||activationPending||evaluationPending} onClick={()=>write('evaluate')}>Avaliar critérios</button></section>}
   <h3>Histórico de ativações</h3><ul>{history.items.map(h=><li key={h.activationId}>Geração {h.generation} — {h.activationId===active?.activationId?'Ativa':'Histórica'} — {h.reason}</li>)}</ul>{history.nextCursor&&<button disabled={disabled} onClick={()=>more('history')}>Mais ativações</button>}
  </>}
  {result&&<section aria-label="Resultado da análise"><h3>Análise parcial — informação global indeterminada</h3><p>{freshness[result.freshness]}</p><p>Avaliada em {result.result.evaluatedAt}. Ausência de constraints não significa ausência de impedimentos. O resultado histórico permanece inalterado.</p>
   <Link to={'/pre-qualificacao?opportunityId='+result.result.identity.opportunityId}>Preparar nova análise com entradas atuais</Link>
   {result.result.lines.length>0&&<ul className="prequalification-criteria" aria-label="Resultados por critério" role="list">
    {result.result.lines.map(line=><CriterionResult key={line.criterionId} line={line}/>)}
   </ul>}
   <DecisionPanel result={result} identity={identity} pending={pending} session={session} onPending={reloadPending} onComplete={load}/>
  </section>}
 </section>
}
