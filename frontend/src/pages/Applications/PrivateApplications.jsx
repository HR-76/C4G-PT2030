import ApplicationTimeline from './ApplicationTimeline'
import FormModal from '../../components/FormModal'
import ApplicationSections from './ApplicationSections'
import { useConfirmDialog } from '../../components/ConfirmDialog'
import ApplicationPreparationSummary from './ApplicationPreparationSummary'
import ApplicationNextStep from './ApplicationNextStep'
import useNextStepCompletion from './useNextStepCompletion'
import ApplicationPartners from './ApplicationPartners'
import ApplicationObjectives from './ApplicationObjectives'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { privateApplicationsApi as api, privateOpportunitiesApi, centralOpportunitiesApi, opportunityInterestsApi, pq1Api } from '../../api/api'
import { applicationIntentKey, loadApplicationIntention, saveApplicationIntention } from './intentions'
import { readScope, startConfirmedRead } from '../../api/confirmedReads'
import { applicationReturnTarget, applicationDetailTarget } from './navigation'
import UnitSelector, { unitLabel } from '../Interests/UnitSelector'
import ApplicationWork from './ApplicationWork'
import ApplicationDocumentsReview from './ApplicationDocumentsReview'
import { ApplicationFields, ApplicationInformation, ApplicationOpportunityContext } from './ApplicationPresentation'
import { opportunityDisplay } from '../Opportunities/opportunityReadModel'
import { LABEL, CHIP, budgetLabel, dateLabel } from './lifecycle'
import './applications.css'
import './application-detail.css'
import './application-create.css'
import ApplicationsRoute from './ApplicationsRoute'
import CentralRevisionNotice from './CentralRevisionNotice'

const message = error => error?.code==='APPLICATION_STORAGE_UNAVAILABLE'?error.message:error?.response?.data?.error?.code==='SCHEMA_UPGRADE_REQUIRED'?'A organização ainda precisa da atualização de candidaturas para guardar estes campos.':({ 400:'Verifique os campos.', 403:'Sem permissão para esta candidatura.', 404:'Candidatura ou oportunidade indisponível.', 409:'Os dados mudaram. Recarregue antes de editar.' }[error?.response?.status] || 'Resultado incerto. Repita o mesmo pedido sem alterar os campos.')
const definitiveRefusal = error => error?.response?.status===400
  || (error?.response?.status===409&&['SCHEMA_UPGRADE_REQUIRED','STALE_REVISION','STATE_CONFLICT','RESPONSIBLE_UNAVAILABLE','UNIT_UNAVAILABLE','STALE_OPPORTUNITY_REVISION'].includes(error?.response?.data?.error?.code))

const FINAL_TRANSITION_MESSAGE = {
 APPROVED:'Depois desta alteração, o estado só poderá passar a Arquivada.',
 REJECTED:'Depois desta alteração, o estado só poderá passar a Arquivada.',
 CANCELLED:'Depois desta alteração, não será possível mudar novamente o estado da candidatura.',
 ARCHIVED:'Depois desta alteração, não será possível mudar novamente o estado da candidatura. O histórico será preservado.',
}

export default function PrivateApplications() {
 return <ApplicationsRoute Record={ApplicationRecord}/>
}
export function ApplicationRecord() {
  const { id } = useParams(), navigate = useNavigate(), [params] = useSearchParams()
  const { user, organization } = useAuth(), org = organization?.id, userId = user?.id
  const {confirm,dialog}=useConfirmDialog()
  const [items,setItems]=useState([]),[cursor,setCursor]=useState(null),[next,setNext]=useState(null)
  const [preparationWork,setPreparationWork]=useState(null),[preparationDocuments,setPreparationDocuments]=useState(null)
  // The record this user and organization last received is shown at once and read again.
  const scope=userId&&org?readScope(userId,org):null,recordName=id?`application:${id}`:null
  const [record,setRecord]=useState(()=>startConfirmedRead(scope,recordName).held),[history,setHistory]=useState([]),[historyNext,setHistoryNext]=useState(null)
  const [historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState(''),[historyRefresh,setHistoryRefresh]=useState(0)
  const currentRecord=useRef(record);currentRecord.current=record
  const nextStep=useNextStepCompletion(userId,org,id,record?.status,record?.statusChangedAt)
  const [responsibles,setResponsibles]=useState([]),[responsiblesNext,setResponsiblesNext]=useState(null),[loadingResponsibles,setLoadingResponsibles]=useState(false),[opportunity,setOpportunity]=useState(null)
  const [responsiblesLoadFailed,setResponsiblesLoadFailed]=useState(false)
  const responsibleOrg=useRef(org)
  responsibleOrg.current=org
  const [form,setForm]=useState({ title:'',responsibleMembershipId:'',deadline:'',evaluationId:'',notes:'',totalBudget:'',organizationBudget:'' })
  const [interest,setInterest]=useState(null),[units,setUnits]=useState([]),[unitsReady,setUnitsReady]=useState(false),[unitsError,setUnitsError]=useState('')
  const [unitsRefresh,setUnitsRefresh]=useState(0),[sourceRefresh,setSourceRefresh]=useState(0)
  const [unitIds,setUnitIds]=useState([]),[unitsChanged,setUnitsChanged]=useState(false),[includeResponsibleInTeam,setIncludeResponsibleInTeam]=useState(false)
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [pendingIntent,setPendingIntent]=useState(null)
  const [editOpen,setEditOpen]=useState(false)
  // The status change opens in a modal; it steps aside while a final transition is being confirmed.
  const [statusOpen,setStatusOpen]=useState(false),[confirming,setConfirming]=useState(false)
  const [refresh,setRefresh]=useState(0)
  const recordGeneration=useRef(0),confirmedRevision=useRef(0)
  const alive=useRef(false),inFlight=useRef(false),unitsTouched=useRef(false)
  const opportunityId=params.get('oportunidade') || params.get('opportunityId')
  const centralOrigin=params.get('origem')==='CENTRAL',centralRevisionId=params.get('revisao')
  const sourceInterestId=params.get('interesse'),sourceInterestRevision=Number(params.get('interesseRevisao'))
  const creating=!id && params.get('nova')==='1'
  // Data only some parts of the page use is asked for when that part is opened:
  // responsibles (editing, team, history), units (editing) and history (its tab).
  const [seen,setSeen]=useState(()=>new Set()),visitSection=useCallback(section=>setSeen(previous=>previous.has(section)?previous:new Set([...previous,section])),[])
  const [wanted,setWanted]=useState({responsibles:creating,units:creating,history:false})
  useEffect(()=>{setWanted(previous=>{
    const next={responsibles:previous.responsibles||editOpen||seen.has('team')||seen.has('history'),units:previous.units||editOpen,history:previous.history||seen.has('history')}
    return next.responsibles===previous.responsibles&&next.units===previous.units&&next.history===previous.history?previous:next
  })},[editOpen,seen])
  // Team and documents only need the identifier, so they are asked for together with the record.
  const early=useRef(null),takeEarlyRead=useCallback(kind=>{const request=early.current?.[kind]||null;if(request)early.current[kind]=null;return request},[])
  // With a confirmed record already on screen the panels are mounted and ask by themselves at once.
  useEffect(()=>{if(!org||!id||currentRecord.current)return
    const controller=new AbortController(),quiet=request=>{request.catch(()=>{});return request}
    early.current={work:quiet(api.work(id,undefined,controller.signal)),documents:quiet(api.documents(id,undefined,controller.signal))}
    return()=>{controller.abort();early.current=null}
  },[org,userId,id])
  const navigationState = useLocation().state, alertQuery = navigationState?.alertQuery
  // A central opportunity read moments ago by «Iniciar candidatura» in the table.
  const handed = navigationState?.centralOpportunity, handedInterest = navigationState?.sourceInterest
  const fromAlerts = Boolean(id) && typeof alertQuery === 'string'
  const returnTo=fromAlerts ? '/notificacoes' + (alertQuery ? '?' + alertQuery : '') : applicationReturnTarget(params.get('retorno'),id?'/candidaturas':sourceInterestId?`/interesses/${sourceInterestId}`:opportunityId?`${centralOrigin?'/catalogo':'/oportunidades'}/${opportunityId}`:centralOrigin?'/catalogo':'/oportunidades')
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{setError('');setNotice('');setCursor(null);setHistory([]);setHistoryNext(null);setOpportunity(null);setRecord(null)},[userId,org,id,opportunityId])
  useEffect(()=>{const pending=loadApplicationIntention(userId,org);setPendingIntent(pending)
    if(pending?.method==='create'&&creating&&pending.payload.opportunityId===opportunityId){const p=pending.payload;setForm({title:p.title||'',responsibleMembershipId:p.responsibleMembershipId||'',deadline:p.deadline||'',evaluationId:p.evaluationId||'',notes:p.notes??'',totalBudget:p.totalBudget??'',organizationBudget:p.organizationBudget??''});setUnitIds(p.unitIds||[]);setIncludeResponsibleInTeam(p.includeResponsibleInTeam===true)}
  },[userId,org,id,opportunityId,creating])
  useEffect(()=>{if(!org||!wanted.responsibles||(id&&(!record||record.canEdit===false)))return;let active=true
    setResponsibles([]);setResponsiblesNext(null);setLoadingResponsibles(true);setResponsiblesLoadFailed(false)
    api.responsibles().then(r=>{if(active){setResponsibles(r.data.items||[]);setResponsiblesNext(r.data.nextCursor||null)}})
      .catch(()=>{if(active)setResponsiblesLoadFailed(true)}).finally(()=>{if(active)setLoadingResponsibles(false)})
    return()=>{active=false}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; record is read at that moment.
  },[org,id,Boolean(record),record?.canEdit,wanted.responsibles])
  const loadMoreResponsibles=async()=>{if(!responsiblesNext||loadingResponsibles)return
    const requestedOrg=org,cursor=responsiblesNext;setLoadingResponsibles(true)
    try{const r=await api.responsibles({cursor});if(!alive.current||responsibleOrg.current!==requestedOrg)return
      setResponsibles(previous=>{const known=new Set(previous.map(item=>item.membershipId));return [...previous,...(r.data.items||[]).filter(item=>!known.has(item.membershipId))]})
      setResponsiblesNext(r.data.nextCursor||null)
    }catch(e){if(alive.current&&responsibleOrg.current===requestedOrg)setError(message(e))}
    finally{if(alive.current&&responsibleOrg.current===requestedOrg)setLoadingResponsibles(false)}
  }
  useEffect(()=>{if(!org||!creating||!opportunityId)return;let active=true
    const known=centralOrigin&&sourceRefresh===0&&handed?.record?.opportunityId===opportunityId&&handed.record.revisionId===centralRevisionId&&Date.now()-handed.readAt<60000?handed.record:null
    ;(known?Promise.resolve({data:known}):pq1Api.session(()=>centralOrigin?centralOpportunitiesApi.get(opportunityId):privateOpportunitiesApi.get(opportunityId))).then(r=>{if(!active)return;if(centralOrigin&&r.data.revisionId!==centralRevisionId){setOpportunity(null);setError('A oportunidade foi atualizada. Volte ao catálogo e abra novamente a criação de candidatura.');return}const value={...r.data,...r.data.snapshot,title:opportunityDisplay(r.data).title};setOpportunity(value);if(!loadApplicationIntention(userId,org))setForm(f=>({...f,title:f.title||value.title?.slice(0,200)||''}))}).catch(e=>{if(active)setError(e?.response?.status===404?'Oportunidade indisponível.':'Não foi possível carregar a oportunidade. Tente novamente.')})
    return()=>{active=false}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; the handed record is read at that moment.
  },[org,userId,creating,opportunityId,centralOrigin,centralRevisionId,sourceRefresh])
  useEffect(()=>{if(!org||!creating||!sourceInterestId)return;let active=true;const controller=new AbortController();setInterest(null)
    const known=sourceRefresh===0&&handedInterest?.record?.interestId===sourceInterestId&&handedInterest.record.revision===sourceInterestRevision&&Date.now()-handedInterest.readAt<60000?handedInterest.record:null
    ;(known?Promise.resolve({data:known}):opportunityInterestsApi.get(sourceInterestId,org,controller.signal)).then(r=>{if(!active)return;const value=r.data
      if(!centralOrigin||value.opportunityId!==opportunityId||value.revision!==sourceInterestRevision||value.status!=='ACTIVE'||!value.capabilities?.canCreateApplication){setError('O interesse mudou ou já não permite abrir candidatura. Volte ao interesse para rever os dados.');return}
      setInterest(value);if(!loadApplicationIntention(userId,org)&&!unitsTouched.current)setUnitIds(value.unitIds||[])
    }).catch(()=>{if(active)setError('Não foi possível carregar o interesse. Tente novamente.')});return()=>{active=false;controller.abort()}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; the handed interest is read at that moment.
  },[org,userId,creating,sourceInterestId,sourceInterestRevision,centralOrigin,opportunityId,sourceRefresh])
  useEffect(()=>{if(!org||!wanted.units||(!creating&&(!id||!record||record.canEdit===false||['CANCELLED','ARCHIVED'].includes(record.status))))return;let active=true;const controller=new AbortController();setUnitsReady(false);setUnitsError('')
    opportunityInterestsApi.units({purpose:'ASSIGN'},org,controller.signal).then(r=>{if(active){if(!Array.isArray(r.data.items))throw Error('Incomplete units');setUnits(r.data.items);setUnitsReady(true)}}).catch(()=>{if(active)setUnitsError('Não foi possível carregar as unidades. Os dados da candidatura foram preservados.')})
    return()=>{active=false;controller.abort()}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; record is read at that moment.
  },[org,id,creating,Boolean(record),record?.canEdit,record?.status,unitsRefresh,wanted.units])
  useEffect(()=>{if(!org||id||creating)return;let active=true
    api.list({cursor,opportunityId:opportunityId||undefined}).then(r=>{if(active){setItems(r.data.items||[]);setNext(r.data.nextCursor)}}).catch(e=>{if(active)setError(message(e))})
    return()=>{active=false}
  },[org,id,creating,cursor,opportunityId,refresh])
  useEffect(()=>{if(!org||!id)return;let active=true;const generation=++recordGeneration.current
    const controller = new AbortController(), read = startConfirmedRead(scope,recordName)
    // The form follows the record unless the answer is the revision already on screen: an edit in progress is not replaced.
    const show=(data,keepForm)=>{confirmedRevision.current=data.revision;setRecord(data);if(keepForm)return;setForm({title:data.title,responsibleMembershipId:data.responsibleMembershipId,deadline:data.deadline||'',evaluationId:data.evaluationId||'',notes:data.notes??'',totalBudget:data.totalBudget??'',organizationBudget:data.organizationBudget??''});setUnitIds(data.unitIds||[]);setUnitsChanged(false)}
    const held=read.held&&read.held.revision>=confirmedRevision.current?read.held:null
    if(held)show(held,false)
    api.get(id,controller.signal).then(a=>{read.keep(a.data);if(active&&generation===recordGeneration.current&&a.data.revision>=confirmedRevision.current)show(a.data,held?.revision===a.data.revision)})
      .catch(e=>{if(active&&generation===recordGeneration.current){read.drop();if(held)setRecord(null)}if(active&&generation===recordGeneration.current)setError(!e?.response?.status||e.response.status>=500?'Não foi possível carregar a candidatura. Repita a consulta.':message(e))});return()=>{active=false;controller.abort()}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope and the read name follow them.
  },[org,userId,id,refresh])
  useEffect(()=>{if(!org||!id||!record||!wanted.history)return;let active=true;setHistory([]);setHistoryNext(null);setHistoryError('');setHistoryLoading(true)
    api.history(id).then(h=>{if(active){setHistory(h.data.items||[]);setHistoryNext(h.data.nextCursor)}})
      .catch(()=>{if(active)setHistoryError('Não foi possível carregar o histórico.')}).finally(()=>{if(active)setHistoryLoading(false)})
    return()=>{active=false}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; record is read at that moment.
  },[org,userId,id,Boolean(record),refresh,historyRefresh,wanted.history])
  if(!org||!userId)return <main className="page"><p role="status">Esta conta não tem uma entidade associada para acompanhar candidaturas.</p></main>
  const activePending=pendingIntent?.userId===userId&&pendingIntent?.organizationId===org?pendingIntent:null
  const transitions=Array.isArray(record?.allowedTransitions)?record.allowedTransitions:[]
  const optionalFields=record?.lifecycleExtended===false?{}:{notes:form.notes||null,totalBudget:form.totalBudget===''?null:form.totalBudget,organizationBudget:form.organizationBudget===''?null:form.organizationBudget}
  const confirmRecord=(data,method)=>{
    // Mutation receipts carry the authoritative revision; a delayed GET cannot undo it.
    ++recordGeneration.current
    // A pending intention may belong to another record in the same organization.
    if(data.applicationId!==id){setRefresh(v=>v+1);return}
    nextStep.complete(method)
    confirmedRevision.current=Math.max(confirmedRevision.current,data.revision)
    setRecord(previous=>!previous||data.revision<previous.revision?previous:{...previous,...data,...(method==='transition'?{allowedTransitions:[]}: {})})
    setRefresh(v=>v+1)
  }
  const locked=busy||Boolean(activePending)
  const listedUnits=[...units,...(record?.units||interest?.units||[]).filter(unit=>!units.some(current=>current.unitId===unit.unitId))]
  const unavailableCreationUnits=creating&&unitsReady&&unitIds.some(unitId=>!units.some(unit=>unit.unitId===unitId&&unit.lifecycle==='ACTIVE'))
  const unitControl=(sourceInterestId||Array.isArray(record?.unitIds)||unitsReady||(creating&&unitsError))&&<div className="field field-full">
    {unitsError&&<p role="status">{unitsError} <button type="button" className={creating?'btn btn-outline':undefined} disabled={busy} onClick={()=>setUnitsRefresh(v=>v+1)}>Repetir consulta de unidades</button></p>}
    <UnitSelector label="Departamentos / Unidades" emptyLabel={interest?.transversal && !unitsChanged ? 'Interesse transversal à C4G' : undefined} units={listedUnits} selectedIds={unitIds} onChange={value=>{unitsTouched.current=true;setUnitIds(value);setUnitsChanged(true)}} disabled={locked||!unitsReady}/>
    {unavailableCreationUnits&&<p role="alert">Retire as unidades arquivadas ou indisponíveis antes de criar a candidatura.</p>}
  </div>
  const sendIntention=async pending=>{
    const {method,id:targetId,payload,idempotencyKey}=pending,body={...payload,idempotencyKey}
    const result=method==='create'?await api.create(body,org):method==='edit'?await api.edit(targetId,body,org):await api.transition(targetId,body,org)
    if(!alive.current)return
    sessionStorage.removeItem(applicationIntentKey(userId,org));setPendingIntent(null);setReason('');setNotice('Alteração guardada.')
    if(method==='create')navigate(applicationDetailTarget(result.data.applicationId,returnTo))
    else { confirmRecord(result.data,method); if(method==='edit')setEditOpen(false);else setStatusOpen(false) }
  }
  const handleSendFailure=e=>{
    if(!alive.current)return
    if(definitiveRefusal(e)){try{sessionStorage.removeItem(applicationIntentKey(userId,org));setPendingIntent(null);if(id)setRefresh(v=>v+1)}catch{setError('Resultado por confirmar. Não foi possível atualizar a recuperação neste navegador.');return}}
    setError(message(e))
  }
  const submit=async(event,method,status)=>{event.preventDefault();if(inFlight.current||locked||method==='transition'&&(!transitions.includes(status)||!reason.trim()))return;inFlight.current=true;setBusy(true);setError('');setNotice('')
    ++recordGeneration.current
    const payload=method==='create'?{opportunityId,...(centralOrigin?{origin:'CENTRAL',centralRevisionId}:{}),evaluationId:centralOrigin?null:form.evaluationId||null,title:form.title.trim(),responsibleMembershipId:form.responsibleMembershipId,deadline:form.deadline,...optionalFields,
      ...(sourceInterestId?{sourceInterestId,sourceInterestRevision,unitIds:[...unitIds],includeResponsibleInTeam}:unitsChanged?{unitIds:[...unitIds]}:{})}
      :method==='edit'?{title:form.title.trim(),responsibleMembershipId:form.responsibleMembershipId,deadline:form.deadline,expectedRevision:record.revision,...optionalFields,...(unitsChanged?{unitIds:[...unitIds]}:{})}
      :{status,reason:reason.trim(),expectedRevision:record.revision}
    try{
      if(method==='transition'&&FINAL_TRANSITION_MESSAGE[status]){
        setConfirming(true)
        const accepted=await confirm({tone:'warning',eyebrow:'Alteração de estado',title:`Confirmar alteração para ${LABEL[status]}?`,
          message:`${record.title}: ${LABEL[record.status]} → ${LABEL[status]}. ${FINAL_TRANSITION_MESSAGE[status]} Motivo: ${payload.reason}`,
          confirmLabel:'Confirmar alteração',cancelLabel:'Voltar'})
        if(alive.current)setConfirming(false)
        if(!accepted||!alive.current)return
        if(currentRecord.current?.revision!==payload.expectedRevision||!Array.isArray(currentRecord.current?.allowedTransitions)||!currentRecord.current.allowedTransitions.includes(status)){
          setError('Os dados ou permissões mudaram. Consulte o estado atual antes de confirmar novamente.');return
        }
      }
      let pending=loadApplicationIntention(userId,org)
      if(pending&&(pending.method!==method||pending.id!==(id||null)||JSON.stringify(pending.payload)!==JSON.stringify(payload))){setPendingIntent(pending);setError('Existe um envio por confirmar. Repita-o antes de alterar os dados.');return}
      pending ||= {userId,organizationId:org,method,id:id||null,payload,idempotencyKey:crypto.randomUUID()}
      saveApplicationIntention(pending);setPendingIntent(pending);await sendIntention(pending)
    }catch(e){handleSendFailure(e)}finally{inFlight.current=false;if(alive.current)setBusy(false)}
  }
  const retryPending=async()=>{if(!activePending||inFlight.current)return;inFlight.current=true;setBusy(true);setError('')
    ++recordGeneration.current
    try{await sendIntention(activePending)}catch(e){handleSendFailure(e)}finally{inFlight.current=false;if(alive.current)setBusy(false)}
  }
  const responsibleSelect=<select required value={form.responsibleMembershipId} onChange={e=>setForm(f=>({...f,responsibleMembershipId:e.target.value}))} disabled={locked}>
    <option value="">Escolha o responsável</option>{form.responsibleMembershipId&&!responsibles.some(r=>r.membershipId===form.responsibleMembershipId)&&<option value={form.responsibleMembershipId}>Responsável atual ({form.responsibleMembershipId})</option>}{responsibles.map(r=><option key={r.membershipId} value={r.membershipId}>{r.name}</option>)}
  </select>
  const fields=<ApplicationFields form={{title:form.title,internal_deadline:form.deadline,notes:form.notes,total_budget:form.totalBudget,university_budget:form.organizationBudget}}
    set={(key,value)=>setForm(f=>({...f,[({internal_deadline:'deadline',total_budget:'totalBudget',university_budget:'organizationBudget'})[key]||key]:value}))}
    disabled={locked} extendedDisabled={record?.lifecycleExtended===false} deadlineRequired titleLabel="Título" deadlineLabel="Prazo interno" organizationLabel="organização" unitControl={unitControl} grouped={creating}
    teamControl={creating&&interest?.capabilities?.canIncludeResponsibleInTeam&&<label className="application-team-choice field-full"><input type="checkbox" checked={includeResponsibleInTeam} disabled={locked} onChange={e=>setIncludeResponsibleInTeam(e.target.checked)}/> Incluir o responsável na equipa</label>}
    responsibleControl={<div className="field"><label>Responsável da organização {responsibleSelect}</label>{responsiblesNext&&<button type="button" className={creating?'btn btn-outline btn-sm':undefined} onClick={loadMoreResponsibles} disabled={loadingResponsibles}>Mais responsáveis</button>}</div>}/>
  function renderApplication() {
        function renderCreation() {
      return (<>
      {interest&&interest.centralRevisionId!==centralRevisionId&&<p role="status">A oportunidade foi atualizada desde o registo de interesse. Reveja os dados atuais antes de criar a candidatura.</p>}
      <div className="application-create-layout"><div className="application-create-context">
      <section className="application-create-source" aria-label="Oportunidade de origem"><h2>Oportunidade</h2>{opportunity?<ApplicationOpportunityContext opportunity={opportunity} showLabel={false}/>:<p>A carregar oportunidade…</p>}</section>
      {interest&&<section className="interest-application-context" aria-label="Análise do interesse de origem">
        <h2>Análise do interesse</h2>
        {interest.notes?<><div className="application-interest-notes pre-wrap" tabIndex={0} role="region" aria-label="Notas do interesse">{interest.notes}</div><button type="button" className="btn btn-outline" disabled={locked||Boolean(form.notes)} onClick={()=>{if(!locked&&!form.notes)setForm(previous=>previous.notes?previous:{...previous,notes:interest.notes})}}>Usar análise nas notas da candidatura</button></>:<p>Sem notas guardadas no interesse.</p>}
        <Link to={`/interesses/${sourceInterestId}`}>Consultar interesse de origem</Link>
      </section>}</div>
      {opportunityId&&<form className="edit-form application-create-form" onSubmit={e=>submit(e,'create')}>{fields}
        {!centralOrigin&&<details className="application-create-evaluation"><summary>Associar avaliação de adequação (opcional)</summary><label>Referência da avaliação <input value={form.evaluationId} onChange={e=>setForm(f=>({...f,evaluationId:e.target.value}))} placeholder="ID da avaliação" disabled={locked}/></label><p>A avaliação não comprova elegibilidade.</p></details>}
        <div className="form-actions application-create-actions"><Link className="btn btn-secondary" to={returnTo}>Cancelar</Link><button className="btn btn-primary" type="submit" disabled={locked||!opportunity||unavailableCreationUnits||Boolean(sourceInterestId&&(!interest||!unitsReady))}>Criar candidatura</button></div></form>}</div></>)
    }
    function renderList() {
      return (<><p>Crie uma candidatura a partir do detalhe de uma oportunidade acessível.</p>
      <div className="table-wrap"><table className="data-table application-list-table"><thead><tr><th>Título</th><th>Estado</th><th>Data do estado</th><th>Prazo interno</th><th>Orçamento total</th><th>Orçamento da organização</th><th>Oportunidade</th></tr></thead><tbody>{items.map(a=><tr key={a.applicationId}><td><Link to={`/candidaturas/${a.applicationId}`}>{a.title}</Link></td><td><span className={`chip ${CHIP[a.status]||'chip-grey'}`}>{LABEL[a.status]||a.status}</span></td><td>{dateLabel(a.statusChangedAt)}</td><td>{dateLabel(a.deadline)}</td><td>{budgetLabel(a.totalBudget)}</td><td>{budgetLabel(a.organizationBudget)}</td><td><Link to={`${a.origin==='CENTRAL'?'/catalogo':'/oportunidades'}/${a.opportunityId}`}>Abrir</Link></td></tr>)}</tbody></table></div>
      {!items.length&&<p>Sem candidaturas nesta página.</p>}<button type="button" onClick={()=>setCursor(null)} disabled={!cursor}>Primeira página</button> <button type="button" onClick={()=>setCursor(next)} disabled={!next}>Página seguinte</button></>)
    }
    function renderDetails() {
      const responsibleName=record.responsibleName||responsibles.find(item=>item.membershipId===record.responsibleMembershipId)?.name
        || (record.responsibleMembershipId?'Responsável associado':'Não identificado')
      // Next-step guidance actions: reveal the tab (focus scrolls it into view).
      const openTab=section=>{const tab=document.getElementById(`application-tab-${section}`);tab?.click();tab?.focus()}
      const openStatusChange=()=>setStatusOpen(true)
      return (<>
      <header className="application-record-header">
        <div><p className="application-client-context">{organization?.displayName || organization?.name || organization?.label || 'Organização selecionada'}</p>
          <h1 className="detail-title">{record.title}</h1>
          <Link to={`${record.origin==='CENTRAL'?'/catalogo':'/oportunidades'}/${record.opportunityId}`}>Oportunidade: {record.opportunityTitle}</Link>
        </div>
        <dl className="application-record-status">
          <div><dt>Estado</dt><dd><span className={`chip ${CHIP[record.status]||'chip-grey'}`}>{LABEL[record.status]}</span></dd></div>
          <div><dt>Responsável</dt><dd>{responsibleName}</dd></div>
          <div><dt>Prazo interno</dt><dd>{record.deadline?dateLabel(record.deadline):'Não definido'}</dd></div>
        </dl>
      </header>
      <div className="application-priority">{!nextStep.completed&&<ApplicationNextStep status={record.status} showNavigation={false} actions={{
        edit:record.canEdit!==false?()=>setEditOpen(true):null,
        startPreparation:transitions.includes('PREPARATION')?openStatusChange:null,
        registerSubmission:transitions.includes('SUBMITTED')?openStatusChange:null,
        team:()=>openTab('team'),partners:()=>openTab('partners'),documents:()=>openTab('documents'),history:()=>openTab('history'),
      }}/>}
      {record.canEdit!==false&&!['CANCELLED','ARCHIVED'].includes(record.status)&&<><button type="button" className="btn btn-primary" onClick={()=>setEditOpen(true)}>Editar dados e orçamento</button>{editOpen&&<FormModal title="Editar dados e orçamento" locked={busy} onClose={()=>setEditOpen(false)}><div className="application-edit-modal">{error&&<p role="alert">{error}</p>}{activePending&&<p role="status">Existe um envio por confirmar. <button type="button" disabled={busy} onClick={retryPending}>Repetir o mesmo envio</button></p>}<form className="edit-form" onSubmit={e=>submit(e,'edit')}>{fields}<div className="form-actions"><button className="btn btn-primary" type="submit" disabled={locked}>Guardar alterações</button></div></form></div></FormModal>}</>}
      {transitions.length>0&&<><button type="button" className="btn btn-outline" onClick={openStatusChange}>Alterar estado</button>{statusOpen&&<FormModal title="Alterar estado" locked={busy} active={!confirming} onClose={()=>setStatusOpen(false)}><div className="application-edit-modal application-status-modal">{error&&<p role="alert">{error}</p>}{activePending&&<p role="status">Existe um envio por confirmar. <button type="button" disabled={busy} onClick={retryPending}>Repetir o mesmo envio</button></p>}
        <p>Estado atual: <span className={`chip ${CHIP[record.status]||'chip-grey'}`}>{LABEL[record.status]}</span></p>
        <p>Submissão e resultado são registos internos; esta ação não envia a candidatura ao financiador.</p><label>Motivo <input required maxLength="500" disabled={locked} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <div className="pipeline-buttons">{transitions.map(s=><button className="btn btn-outline" type="button" key={s} disabled={locked||!reason.trim()} onClick={e=>submit(e,'transition',s)}>{LABEL[s]}</button>)}</div></div></FormModal>}</>}
      </div>
      <CentralRevisionNotice key={`${userId}:${org}:${id}`} record={record}/>
      <ApplicationSections onVisit={visitSection} sections={[
        {id:'overview',label:'Resumo',content:<>
      <ApplicationPreparationSummary work={preparationWork} documents={preparationDocuments} responsibles={responsibles}/>
      <div className="application-overview-toolbar">
        <h2>Dados da candidatura</h2>
        <a className="btn btn-outline btn-sm" href="#historico-candidatura">Ver histórico</a>
      </div>
      <div id="dados-orcamento" tabIndex={-1} className="application-section-target">
      <ApplicationInformation compact organizationLabel="organização" formatBudget={budgetLabel} app={{closing_date:record.opportunityClosingDate,total_budget:record.totalBudget,university_budget:record.organizationBudget,created_at:record.createdAt,notes:record.notes}}/>
      </div>
      {record.sourceInterestId&&<p><Link to={`/interesses/${record.sourceInterestId}`}>Interesse de origem</Link></p>}
      {Array.isArray(record.unitIds)&&<p>Departamentos / Unidades: {record.unitIds.length?record.unitIds.map(unitId=>unitLabel((record.units||[]).find(unit=>unit.unitId===unitId)||{unitId,label:unitId},record.units||[])).join('; '):'Sem unidade atribuída'}</p>}
      {record.lastSubmittedAt&&<p>Último registo de submissão: {new Date(record.lastSubmittedAt).toLocaleString('pt-PT')}</p>}
      {record.evaluationId&&<p>Avaliação F14 associada: {record.evaluationId} (referência, sem prova de elegibilidade)</p>}
      {record.canEdit===false&&<p>Acesso de consulta à candidatura. A edição requer autorização do gestor.</p>}
      {organization?.navigation?.directory!==false&&<ApplicationObjectives key={`${userId}:${org}:${id}`} applicationId={id} organizationId={org}/>}
        </>},
        {id:'documents',label:'Documentos',render:visited=><ApplicationDocumentsReview onActionCompleted={()=>nextStep.complete('documents')} takeEarlyRead={takeEarlyRead} loadDetails={visited} onPreparationChange={setPreparationDocuments} applicationId={id} userId={userId} organizationId={org}/>},
        {id:'team',label:'Equipa e tarefas',render:visited=><ApplicationWork onActionCompleted={()=>nextStep.complete('team')} takeEarlyRead={takeEarlyRead} loadDetails={visited} onPreparationChange={setPreparationWork} applicationId={id} userId={userId} organizationId={org} responsibles={responsibles} responsiblesNext={responsiblesNext} loadingResponsibles={loadingResponsibles} responsiblesLoadFailed={responsiblesLoadFailed} loadMoreResponsibles={loadMoreResponsibles} applicationResponsibleId={record.responsibleMembershipId} applicationDeadline={record.deadline} canEdit={record.canEdit!==false}/>},
        {id:'partners',label:'Parceiros',render:visited=>visited&&<ApplicationPartners onActionCompleted={()=>nextStep.complete('partners')} applicationId={id} userId={userId} organizationId={org}/>},
        {id:'history',label:'Histórico',content:<>      <section id="historico-candidatura" tabIndex={-1} className="detail-section"><h2>Histórico</h2><p>Revisão atual: {record.revision} · Data do estado: {dateLabel(record.statusChangedAt)}</p>{historyLoading?<p role="status">A carregar histórico…</p>:historyError?<p role="alert">{historyError} <button type="button" onClick={()=>setHistoryRefresh(n=>n+1)}>Repetir consulta</button></p>:<ApplicationTimeline history={history} record={record} responsibles={responsibles}/>}
        {historyNext&&<button type="button" onClick={async()=>{try{const r=await api.history(id,{cursor:historyNext});if(!alive.current)return;setHistory(h=>[...h,...r.data.items]);setHistoryNext(r.data.nextCursor)}catch(e){if(alive.current)setError(message(e))}}}>Mais histórico</button>}</section></>}
      ]}/>
    </>)
    }
    return <main className={`page detail-page ${id?'application-detail-workspace':creating?'application-create-workspace':''}`}>{dialog}<Link to={returnTo}>{fromAlerts ? "Voltar aos alertas" : "Voltar"}</Link>{!id&&(creating?<header className="application-create-header"><div><p>{organization?.displayName || organization?.name || 'Organização selecionada'}</p><h1>Nova candidatura</h1></div><div className="application-create-initial-state"><span>Estado inicial</span><strong>Identificada</strong></div></header>:<h1>Candidaturas</h1>)}
    {error&&!statusOpen&&<p role="alert">{error}</p>}{id&&!record&&error&&<button type="button" className="btn btn-outline" onClick={()=>{setError('');setRefresh(v=>v+1)}}>Repetir consulta da candidatura</button>}{notice&&<p role="status">{notice}</p>}
    {creating&&error&&(!opportunity||(sourceInterestId&&!interest))&&<button type="button" className="btn btn-outline" disabled={busy} onClick={()=>{setError('');setSourceRefresh(v=>v+1)}}>Repetir consulta da origem</button>}
    {activePending&&!statusOpen&&<p role="status">Existe um envio por confirmar. <button type="button" className={creating?'btn btn-outline':undefined} disabled={busy} onClick={retryPending}>Repetir o mesmo envio</button></p>}
    {creating&&renderCreation()}
    {!id&&!creating&&renderList()}
    {id&&record&&renderDetails()}
  </main>
  }
  return renderApplication()
}
