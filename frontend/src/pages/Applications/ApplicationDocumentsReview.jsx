import {useEffect,useRef,useState} from 'react'
import {FileText} from 'lucide-react'
import {privateApplicationsApi as api} from '../../api/api'
import './application-documents.css'
import {applicationDocumentIntentKey} from './intentions'
import {navigateDocumentDownload} from '../../api/documentNavigation'

const documentState=item=>item.usable?'Verificado e disponível':['SCANNING','UPLOADED','PENDING_SCAN'].includes(item.state)?'Em verificação':['QUARANTINED','REJECTED'].includes(item.state)?'Bloqueado pela verificação':'Indisponível'
const decisionLabel={APPROVED:'Aprovado internamente',CHANGES_REQUESTED:'Alterações solicitadas'}
const kindLabel={DOCUMENT_LINKED:'Versão associada',DOCUMENT_REMOVED:'Documento retirado',REVIEW_REQUESTED:'Revisão solicitada',REVIEW_DECIDED:'Decisão registada'}
const dateLabel=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('pt-PT'):'Data não disponível'
const message=error=>error?.response?.data?.error?.code==='REVIEWER_NOT_ELIGIBLE'?'O revisor já não tem as permissões necessárias. Consulte novamente os revisores.':({400:'Verifique os dados.',401:'A sessão terminou. Volte a autenticar-se e selecione a organização.',403:'O acesso à organização foi removido ou não tem autorização documental.',404:'Recurso indisponível ou sem autorização documental.',409:'O conjunto mudou ou a operação já foi decidida. Recarregue.',503:'Serviço indisponível ou resultado incerto. Repita o mesmo envio para confirmar.'}[error?.response?.status]||'Resultado incerto. Repita o mesmo envio para confirmar.')
const readMessage=error=>!error?.response?.status||error.response.status>=500?'Não foi possível carregar os documentos. Repita a consulta.':message(error)
const accessDenied=error=>[401,403].includes(error?.response?.status)
const definitive=error=>error?.response?.status===400||(error?.response?.status===409&&['STALE_REVISION','STATE_CONFLICT','LIMIT_EXCEEDED','REVIEWER_NOT_ELIGIBLE'].includes(error?.response?.data?.error?.code))
const filePolicy={
 'application/pdf':{fileClass:'PDF',maxBytes:50*1024*1024},'image/png':{fileClass:'IMAGE',maxBytes:20*1024*1024},'image/jpeg':{fileClass:'IMAGE',maxBytes:20*1024*1024},
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{fileClass:'OOXML',maxBytes:100*1024*1024},
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{fileClass:'OOXML',maxBytes:100*1024*1024},
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':{fileClass:'OOXML',maxBytes:100*1024*1024}
}
async function sha256(file){const bytes=await file.arrayBuffer(),hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')}

function reviewStatus(review){
 return review.decision ? decisionLabel[review.decision] || 'Decisão registada' : 'A aguardar decisão'
}

function DocumentReviewActivity({item,requests,events,historyReady,historyNext,reviewsNext,busy,loadMore}){
 return <details className="file-activity">
  <summary>Pedidos e histórico</summary>
  <div className="file-activity-content">
   <h4>Pedidos de revisão</h4>
   {requests.length>0 ? <ul className="file-request-list" role="list">{requests.map(({review,version})=><li key={review.requestId}>
    <strong>{reviewStatus(review)}</strong>
    <p className="file-activity-meta">{dateLabel(review.requestedAt)} · {version.versionId===item.versionId?'Versão associada':'Outra versão'}{review.stale?' · Conjunto desatualizado':''}{review.documentsRestricted?' · Conjunto parcialmente visível':''}</p>
    {review.comment&&<p className="pre-wrap file-review-comment">{review.comment}</p>}
    <a href={`#revisao-${review.requestId}`}>Consultar pedido</a>
   </li>)}</ul> : <p>{reviewsNext?'Sem pedidos para este documento nos resultados carregados.':'Sem pedidos para este documento.'}</p>}
   {reviewsNext&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>loadMore('reviews')}>Carregar pedidos anteriores</button>}
   <h4>Histórico do documento</h4>
   {events.length>0 ? <ol className="file-event-list">{events.map(event=><li key={event.revision}>
    <strong>{kindLabel[event.kind]||'Alteração documental'}</strong>
    {event.decision&&<> · {decisionLabel[event.decision]||'Decisão registada'}</>}
    <small>{dateLabel(event.recordedAt)} · Revisão documental {event.revision}{event.versionId&&event.versionId!==item.versionId?' · Outra versão':''}</small>
   </li>)}</ol> : <p>{!historyReady?'Histórico ainda não disponível.':historyNext||reviewsNext?'Sem eventos associados nos resultados carregados.':'Sem eventos associados a este documento.'}</p>}
   {historyNext&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>loadMore('history')}>Carregar mais histórico</button>}
  </div>
 </details>
}

export default function ApplicationDocumentsReview({applicationId,userId,organizationId,onPreparationChange,loadDetails=true}){
 const [snapshot,setSnapshot]=useState(null),[candidates,setCandidates]=useState([]),[candidateNext,setCandidateNext]=useState(null),[history,setHistory]=useState([]),[historyNext,setHistoryNext]=useState(null)
 const [historyReady,setHistoryReady]=useState(false)
 const contextKey=`${organizationId}:${applicationId}:${userId}`
 const [snapshotContext,setSnapshotContext]=useState(null)
 const [selected,setSelected]=useState(''),[reviewDrafts,setReviewDrafts]=useState({})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[pendingUpload,setPendingUpload]=useState(null),[refresh,setRefresh]=useState(0),[uploadFile,setUploadFile]=useState(null),[accessBlocked,setAccessBlocked]=useState(false)
 const [processingVersion,setProcessingVersion]=useState(null),[candidatePoll,setCandidatePoll]=useState(0)
 const [reading,setReading]=useState(true)
 const [reviewers,setReviewers]=useState(null),[reviewerId,setReviewerId]=useState(''),[reviewerError,setReviewerError]=useState('')
 const reviewerRequest=useRef(null)
 useEffect(()=>{
  setReviewers(null);setReviewerId('');setReviewerError('')
  return ()=>reviewerRequest.current?.abort()
 },[contextKey,snapshot?.revision])
 async function loadReviewers(cursor){
  reviewerRequest.current?.abort()
  const controller=new AbortController()
  reviewerRequest.current=controller
  setReviewerError('')
  setReviewers(previous=>({...previous,loading:true}))
  try{
   const {data}=await api.reviewReviewers(applicationId,cursor?{cursor}:{},organizationId,controller.signal)
   if(!controller.signal.aborted)setReviewers(previous=>({items:cursor?[...previous.items,...data.items]:data.items,nextCursor:data.nextCursor,loading:false}))
  }catch{
   if(!controller.signal.aborted){setReviewers(previous=>({...previous,loading:false}));setReviewerError('Não foi possível consultar os revisores.')}
  }
 }
 useEffect(()=>{const state=error||accessBlocked?'unavailable':pending||pendingUpload?'pending':busy?'updating':!snapshot?'loading':reading?'updating':'ready';onPreparationChange?.({state,data:state==='ready'?snapshot:null})},[snapshot,error,accessBlocked,pending,pendingUpload,busy,reading,onPreparationChange])
 useEffect(()=>()=>onPreparationChange?.(null),[onPreparationChange])
 const candidateGeneration=useRef(0)
 const downloadDisposers=useRef([])
 useEffect(()=>()=>{downloadDisposers.current.forEach(dispose=>dispose());downloadDisposers.current=[]},[applicationId,organizationId,userId])
 const intentKey=applicationDocumentIntentKey(userId,organizationId,applicationId)
 const uploadIntentKey=`${intentKey}:upload`
 useEffect(()=>{let value=null;try{value=JSON.parse(sessionStorage.getItem(intentKey)||'null')}catch{/* Invalid stale storage. */}
  let uploadValue=null;try{uploadValue=JSON.parse(sessionStorage.getItem(uploadIntentKey)||'null')}catch{/* Invalid stale storage. */}
  setPending(value?.userId===userId&&value?.organizationId===organizationId&&value?.applicationId===applicationId?value:null)
  setPendingUpload(uploadValue?.userId===userId&&uploadValue?.organizationId===organizationId&&uploadValue?.applicationId===applicationId?uploadValue:null)
  candidateGeneration.current+=1;setProcessingVersion(null);setCandidatePoll(0)
  setSnapshot(null);setCandidates([]);setCandidateNext(null);setHistory([]);setHistoryNext(null);setHistoryReady(false);setError('');setNotice('');setSelected('');setReviewDrafts({});setAccessBlocked(false)
 },[applicationId,userId,organizationId,intentKey,uploadIntentKey])
 useEffect(()=>{let active=true;setReading(true);setError('');setAccessBlocked(false)
  const controller=new AbortController()
  api.documents(applicationId,undefined,controller.signal).then(s=>{if(active){setSnapshot(s.data);setSnapshotContext(contextKey)}}).catch(e=>{if(active){if(accessDenied(e))setAccessBlocked(true);setError(readMessage(e))}}).finally(()=>{if(active)setReading(false)})
  return()=>{active=false;controller.abort()}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; contextKey is read at that moment.
 },[applicationId,organizationId,userId,refresh])
 useEffect(()=>{
  if(!loadDetails)return
  let active=true
  const controller=new AbortController()
  setHistoryReady(false)
  api.documentHistory(applicationId,undefined,controller.signal).then(h=>{if(active){setHistory(h.data.items||[]);setHistoryNext(h.data.nextCursor);setHistoryReady(true)}}).catch(e=>{if(active){if(accessDenied(e))setAccessBlocked(true);setError(readMessage(e))}})
  return()=>{active=false;controller.abort()}
 },[applicationId,organizationId,refresh,loadDetails])
 useEffect(()=>{
  if(!loadDetails||snapshotContext!==contextKey||snapshot?.capabilities?.canEdit!==true){setCandidates([]);setCandidateNext(null);return}
  let active=true;const controller=new AbortController();const generation=++candidateGeneration.current
  api.documentCandidates(applicationId,undefined,controller.signal).then(c=>{if(active&&generation===candidateGeneration.current){setCandidates(c.data.items||[]);setCandidateNext(c.data.nextCursor)}}).catch(e=>{if(active&&generation===candidateGeneration.current){if(accessDenied(e))setAccessBlocked(true);setError(readMessage(e))}})
  return()=>{active=false;controller.abort()}
 },[applicationId,organizationId,userId,refresh,loadDetails,snapshotContext,contextKey,snapshot?.capabilities?.canEdit])
 useEffect(()=>{if(!processingVersion)return
  const deadline=setTimeout(()=>{candidateGeneration.current+=1;setProcessingVersion(null);setCandidatePoll(0);setNotice('O documento continua em processamento. Recarregue documentos e revisão para consultar o estado.')},30000)
  return()=>clearTimeout(deadline)
 },[applicationId,organizationId,processingVersion])
 useEffect(()=>{if(!processingVersion)return
  const candidate=candidates.find(item=>item.versionId===processingVersion)
  if(candidate?.usable){setProcessingVersion(null);setCandidatePoll(0);setNotice('Documento verificado e disponível para associação.');return}
  if(candidate&&['QUARANTINED','REJECTED','CANCELLED','EXPIRED','MISSING','DELETED'].includes(candidate.state)){setProcessingVersion(null);setCandidatePoll(0);setError('O documento foi recusado pela verificação e permanece indisponível.');return}
  if(candidatePoll>=30){setProcessingVersion(null);setCandidatePoll(0);setNotice('O documento continua em processamento. Recarregue documentos e revisão para consultar o estado.');return}
  let active=true;const timer=setTimeout(async()=>{const generation=++candidateGeneration.current
   try{const response=await api.documentCandidates(applicationId);if(active&&generation===candidateGeneration.current){setCandidates(response.data.items||[]);setCandidateNext(response.data.nextCursor)}}
   catch(e){if(active&&generation===candidateGeneration.current){setAccessBlocked(accessDenied(e));setError(message(e));setProcessingVersion(null)}}
   finally{if(active)setCandidatePoll(value=>value+1)}
  },1000);return()=>{active=false;clearTimeout(timer)}
 },[applicationId,organizationId,processingVersion,candidatePoll,candidates])
 useEffect(()=>{setSelected(value=>value&&candidates.some(item=>item.versionId===value&&item.usable)?value:'')},[candidates])
 const canEdit=!reading&&!accessBlocked&&snapshot?.capabilities?.canEdit===true
 const canDecide=!reading&&!accessBlocked&&snapshot?.capabilities?.canDecide===true
 const canUpload=canEdit&&snapshot?.capabilities?.canUpload===true
 const permits=method=>method==='reviewDecide'?canDecide:['documentLink','documentRemove','reviewRequest'].includes(method)&&canEdit
 const send=async(method,payload,retry=false)=>{if(busy||!permits(retry?pending?.method:method))return;setBusy(true);setError('');setNotice('')
  let intent=pending
  if(!retry){if(intent){setError('Existe um envio por confirmar. Repita-o antes de alterar os dados.');setBusy(false);return}
   intent={userId,organizationId,applicationId,method,payload,idempotencyKey:crypto.randomUUID()};sessionStorage.setItem(intentKey,JSON.stringify(intent));setPending(intent)}
  try{const body={...intent.payload,idempotencyKey:intent.idempotencyKey}
   if(intent.method==='reviewRequest')await api.reviewRequest(intent.applicationId,body,intent.organizationId)
   else await api[intent.method](intent.applicationId,body)
   sessionStorage.removeItem(intentKey);setPending(null);setNotice('Alteração confirmada.');if(intent.method==='reviewDecide')setReviewDrafts(previous=>{const next={...previous};delete next[intent.payload.requestId];return next})
   try{const s=await api.documents(applicationId);setSnapshot(s.data);const h=await api.documentHistory(applicationId);setHistory(h.data.items||[]);setHistoryNext(h.data.nextCursor);setHistoryReady(true)}
   catch{setSnapshot(null);setError('Alteração confirmada, mas a releitura falhou. Recarregue documentos e revisão.')}
  }catch(e){if(definitive(e)){sessionStorage.removeItem(intentKey);setPending(null);setSnapshot(null);setRefresh(v=>v+1)}setAccessBlocked(accessDenied(e));setError(intent.method==='reviewDecide'&&e?.response?.status===404?'Decisão indisponível: confirme o acesso à candidatura e ao conjunto documental.':message(e))}
  finally{setBusy(false)}
 }
 const mutate=(method,fields={})=>send(method,{...fields,expectedRevision:snapshot.revision})
 const loadMore=async(type)=>{if(busy)return;setBusy(true);setError('')
  try{if(type==='candidates'){const generation=++candidateGeneration.current,r=(await api.documentCandidates(applicationId,{cursor:candidateNext})).data;if(generation===candidateGeneration.current){setCandidates(old=>[...old,...r.items.filter(item=>!old.some(p=>p.versionId===item.versionId))]);setCandidateNext(r.nextCursor)}}
   else if(type==='history'){const r=(await api.documentHistory(applicationId,{cursor:historyNext})).data;setHistory(old=>[...old,...r.items]);setHistoryNext(r.nextCursor)}
   else{const r=(await api.documents(applicationId,{cursor:snapshot.reviewsNextCursor})).data;setSnapshot(old=>({...old,reviews:[...old.reviews,...r.reviews],reviewsNextCursor:r.reviewsNextCursor,capabilities:r.capabilities}))}}
   catch(e){setAccessBlocked(accessDenied(e));setError(message(e))}finally{setBusy(false)}
 }
 const download=item=>{if(busy)return;setError('');const refused=e=>{setAccessBlocked(accessDenied(e));setError(e?.response?.status===503?'Não foi possível iniciar o download. O estado dos envios pendentes foi preservado.':message(e))}
  try{downloadDisposers.current.push(navigateDocumentDownload(api.documentDownload(applicationId,item.versionId),refused))}catch(e){refused(e)}}
 const upload=async()=>{if(busy||!uploadFile||!canUpload)return;setBusy(true);setError('');setNotice('');try{
  const policy=filePolicy[uploadFile.type];if(!policy||uploadFile.size<1||uploadFile.size>policy.maxBytes)throw {response:{status:400}}
  const payload={expectedSize:uploadFile.size,declaredMime:uploadFile.type,filename:uploadFile.name,fileClass:policy.fileClass,checksum:await sha256(uploadFile),versionNumber:1}
  let operation=pendingUpload
  if(operation){const same=operation.userId===userId&&operation.organizationId===organizationId&&operation.applicationId===applicationId&&JSON.stringify(operation.payload)===JSON.stringify(payload);if(!same)throw {response:{status:409,data:{error:{code:'STATE_CONFLICT'}}}}}
  else{operation={userId,organizationId,applicationId,payload,idempotencyKey:crypto.randomUUID()};sessionStorage.setItem(uploadIntentKey,JSON.stringify(operation));setPendingUpload(operation)}
  const intent=(await api.documentUploadIntent(applicationId,{...payload,idempotencyKey:operation.idempotencyKey})).data
  if(intent.capability)await api.documentUpload(applicationId,intent.versionId,intent.capability,uploadFile)
  else if(!['UPLOADED','SCANNING','AVAILABLE'].includes(intent.state))throw {response:{status:503}}
  sessionStorage.removeItem(uploadIntentKey);setPendingUpload(null);setUploadFile(null);setProcessingVersion(intent.versionId);setCandidatePoll(0);setNotice('Upload confirmado. O documento permanece indisponível até o scan terminar.');setRefresh(value=>value+1)
 }catch(e){setAccessBlocked(accessDenied(e));setError(message(e))}finally{setBusy(false)}}
 const chosen=candidates.find(item=>item.versionId===selected)
 const unavailable=snapshot?.documents.filter(item=>!item.usable).length||0
 const preparationHint=!snapshot?.documents.length?'Associe pelo menos uma versão verificada antes de solicitar revisão.':unavailable?'Resolva as versões indisponíveis antes de solicitar revisão.':'As versões associadas estão disponíveis para revisão interna.'
 const orderedReviews=[...(snapshot?.reviews||[])].sort((a,b)=>Number(a.stale)-Number(b.stale)||Date.parse(b.requestedAt)-Date.parse(a.requestedAt))
 const reviewVersion=item=>{
  const known=[...(snapshot?.documents||[]),...candidates].find(candidate=>candidate.documentId===item.documentId&&candidate.versionId===item.versionId)
  return known?`${known.filename||item.documentId} · versão ${known.versionNumber||item.versionId}`:`${item.documentId} · versão ${item.versionId}`
 }
 const updateDraft=(id,field,value)=>setReviewDrafts(previous=>({...previous,[id]:{decision:'APPROVED',comment:'',...previous[id],[field]:value}}))
 return <section id="documentos-revisao" tabIndex={-1} className="application-documents detail-section" aria-label="Documentos e revisão interna"><h2>Documentos e revisão interna</h2>
  {error&&<p role="alert">{error}</p>}{accessBlocked&&snapshot&&<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Recarregar permissões documentais</button>}{notice&&<p role="status">{notice}</p>}
  {pending&&<p role="status">Envio por confirmar. {!permits(pending.method)?'A intenção foi preservada; confirme a sessão, a organização e as permissões antes de continuar.':<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>send(null,null,true)}>Repetir o mesmo envio</button>}</p>}
  {pendingUpload&&<p role="status">{canUpload?'Upload por confirmar. Selecione novamente o mesmo ficheiro e repita a operação com a chave preservada.':'Upload por confirmar preservado. Confirme as permissões antes de continuar.'}</p>}
  {!snapshot?<><p>Carregar documentos e revisão…</p><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Recarregar documentos e revisão</button></>:<>
   <dl className="document-summary"><div><dt>Versões associadas</dt><dd>{snapshot.documents.length}</dd></div><div><dt>Disponíveis para revisão</dt><dd>{snapshot.documents.length-unavailable}</dd></div><div><dt>Indisponíveis</dt><dd>{unavailable}</dd></div></dl>
   <p>{canEdit?preparationHint:canDecide?'Pode consultar os documentos e decidir os pedidos de revisão disponíveis.':'Consulta documental. Sem permissão atual para editar ou decidir revisões.'}</p>
   <section className="linked-files" aria-label="Versões associadas"><h3>Versões associadas</h3>
    {snapshot.documents.length ? <ul className="linked-files-list" role="list">{snapshot.documents.map(item=>{
       const requests=orderedReviews.flatMap(review=>{
        const version=review.documents.find(document=>document.documentId===item.documentId)
        return version?[{review,version}]:[]
       })
       const review=requests.find(({version})=>version.versionId===item.versionId)?.review
       const requestIds=new Set(requests.map(({review})=>review.requestId))
       const events=history.filter(event=>!event.restricted&&(
        event.documentId===item.documentId||(!event.documentId&&requestIds.has(event.requestId))
       ))
       const canDownload=item.canDownload===true && item.usable && !reading && !accessBlocked
       return <li key={item.documentId} id={`documento-${item.documentId}`} className="linked-file" tabIndex={-1}>
        <div className="linked-file-row">
        <div className="linked-file-name"><FileText size={20} aria-hidden="true" data-icon-tone="blue"/><div><strong>{item.filename||item.documentId}</strong><small>Versão {item.versionNumber||'—'} · <span>{documentState(item)}</span></small></div></div>
        <div className="linked-file-review"><small>Revisão interna</small>
         {review ? <><span className="file-review-state" data-decision={review.stale?undefined:review.decision}>{review.stale?'Revisão desatualizada':reviewStatus(review)}</span>
          <small>{review.documentsRestricted?'Conjunto parcialmente visível · ':''}{dateLabel(review.requestedAt)}</small></>
          : <span className="file-review-state">{snapshot.reviewsNextCursor?'Sem pedido nas revisões carregadas':'Sem pedido para esta versão'}</span>}
        </div>
        <div className="file-actions">{canDownload&&<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>download(item)}>Descarregar versão</button>}
         {canEdit&&<button type="button" className="btn btn-outline btn-sm" disabled={busy||!!pending} onClick={()=>mutate('documentRemove',{documentId:item.documentId})}>Retirar associação</button>}
         {!canDownload&&!canEdit&&<small>{reading?'A verificar permissões…':'Apenas consulta'}</small>}</div>
        </div>
        {!accessBlocked&&<DocumentReviewActivity item={item} requests={requests} events={events} historyReady={historyReady}
         historyNext={historyNext} reviewsNext={snapshot.reviewsNextCursor} busy={busy} loadMore={loadMore}/>}
       </li>
     })}</ul> : <p className="files-empty"><FileText size={21} aria-hidden="true"/>Sem documentos associados.</p>}
   </section>
    {canUpload&&<fieldset><legend>Carregar Budget ou documento</legend><p>PDF até 50 MiB, PNG/JPEG até 20 MiB ou DOCX/XLSX/PPTX até 100 MiB. CSV não é aceite.</p>
     <p>Os ficheiros Office com macros, objetos incorporados ou ligações externas, incluindo hiperligações, são bloqueados pela verificação de segurança.</p>
     <input aria-label="Ficheiro documental" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx" disabled={busy} onChange={event=>setUploadFile(event.target.files?.[0]||null)}/>
     <button type="button" className="btn btn-outline btn-sm" disabled={busy||!uploadFile} onClick={upload}>{pendingUpload?'Repetir upload seguro':'Iniciar upload seguro'}</button></fieldset>}
    {canEdit&&<><h3>Associar uma versão verificada</h3><p>O carregamento não associa automaticamente o documento à candidatura.</p><label>Versão disponível <select key={`${applicationId}:${organizationId}`} value={selected} onChange={e=>setSelected(e.target.value)} disabled={busy||!!pending}>
    <option value="">Escolha uma versão</option>{candidates.map(item=><option key={item.versionId} value={item.versionId} disabled={!item.usable}>{item.filename} · v{item.versionNumber} · {documentState(item)}</option>)}
   </select></label><button type="button" className="btn btn-outline btn-sm" disabled={busy||!!pending||!chosen?.usable} onClick={()=>mutate('documentLink',{documentId:chosen.documentId,versionId:chosen.versionId})}>Associar versão</button>
    {candidateNext&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>loadMore('candidates')}>Mais versões</button>}
     {!candidates.length&&<p>Não há versões limpas acessíveis para associação.</p>}</>}
   <h3>Revisão interna</h3><p>A decisão refere-se às versões deste pedido; não equivale à submissão oficial da candidatura.</p>
   {canEdit&&<div className="document-review-assignment">
    <button type="button" className="btn btn-outline btn-sm" disabled={busy||!!pending||reviewers?.loading||!snapshot.documents.length||snapshot.documents.some(item=>!item.usable)} onClick={()=>loadReviewers(null)}>Consultar revisores elegíveis</button>
    {reviewerError&&<p role="alert">{reviewerError}</p>}
    {reviewers?.loading&&<p role="status">A consultar revisores…</p>}
    {reviewers?.items?.length>0&&<label>Revisor <select value={reviewerId} onChange={event=>setReviewerId(event.target.value)} disabled={busy||!!pending||reviewers.loading}>
     <option value="">Escolha um revisor</option>{reviewers.items.map(person=><option key={person.membershipId} value={person.membershipId}>{person.name}</option>)}
    </select></label>}
    {reviewers?.items?.length===0&&!reviewers.loading&&!reviewers.nextCursor&&<p>Sem revisores elegíveis.</p>}
    {reviewers?.nextCursor&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy||reviewers.loading} onClick={()=>loadReviewers(reviewers.nextCursor)}>Mais revisores</button>}
    <button type="button" className="btn btn-outline btn-sm" disabled={busy||!!pending||!reviewers?.items?.some(person=>person.membershipId===reviewerId)||reviewers.loading||!snapshot.documents.length||snapshot.documents.some(item=>!item.usable)} onClick={()=>mutate('reviewRequest',{reviewerMembershipId:reviewerId})}>Solicitar revisão do conjunto atual</button>
   </div>}
   <ol className="document-reviews">{snapshot.reviews.map(review=>{const draft=reviewDrafts[review.requestId]||{decision:'APPROVED',comment:''};return <li key={review.requestId} id={`revisao-${review.requestId}`} tabIndex={-1}><h4>Pedido de revisão · {dateLabel(review.requestedAt)}</h4><details><summary>Identificação do pedido</summary><p>Pedido {review.requestId} · solicitado por {review.requestedBy}</p>{review.decidedBy&&<p>Decidido por {review.decidedBy}</p>}</details>
    {review.stale&&<strong> · Conjunto desatualizado; solicite nova revisão</strong>}
    <ul>{review.documents.map(item=><li key={item.documentId}>{reviewVersion(item)}</li>)}</ul>
    {review.documentsRestricted&&<p>Algumas versões não estão acessíveis com as permissões atuais.</p>}
    {review.decision?<div className="document-decision"><strong>{decisionLabel[review.decision]}</strong>{review.comment&&<p className="pre-wrap">{review.comment}</p>}<p className="text-muted">{dateLabel(review.decidedAt)}</p></div>:
     canDecide&&(!review.assigned||review.assignedToMe)&&!review.documentsRestricted&&!review.stale&&review.requestedBy!==userId&&<form onSubmit={e=>{e.preventDefault();mutate('reviewDecide',{requestId:review.requestId,decision:draft.decision,comment:draft.comment.trim()})}}>
      <label>Decisão <select value={draft.decision} onChange={e=>updateDraft(review.requestId,'decision',e.target.value)} disabled={busy||!!pending}><option value="APPROVED">Aprovar conjunto</option><option value="CHANGES_REQUESTED">Solicitar alterações</option></select></label>
      <label>Comentário <textarea required maxLength="2000" value={draft.comment} onChange={e=>updateDraft(review.requestId,'comment',e.target.value)} disabled={busy||!!pending}/></label>
      <button className="btn btn-primary" type="submit" disabled={busy||!!pending||!draft.comment.trim()}>Registar decisão</button></form>}
    {!review.decision&&review.requestedBy===userId&&<p>O requerente não pode decidir o próprio pedido.</p>}
   </li>})}</ol>{snapshot.reviewsNextCursor&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>loadMore('reviews')}>Pedidos anteriores</button>}
   <details className="document-history"><summary>Histórico documental</summary><p>Revisão documental: {snapshot.revision}.</p><ol>{history.map(item=><li key={item.revision}>Revisão {item.revision}: {kindLabel[item.kind]}{item.documentId&&` · documento ${item.documentId}`}{item.versionId&&` · versão ${item.versionId}`}{item.requestId&&` · pedido ${item.requestId}`}{item.decision&&` · ${decisionLabel[item.decision]}`}{item.comment&&` · ${item.comment}`}{item.restricted&&' · documento sem acesso atual'} · autor {item.actorSubjectId} · {dateLabel(item.recordedAt)}</li>)}</ol>
   {historyNext&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>loadMore('history')}>Mais histórico documental</button>}
   {!history.length&&<p>Sem alterações documentais registadas.</p>}</details>
  </>}
 </section>
}
