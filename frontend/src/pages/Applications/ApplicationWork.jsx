import useTaskSelection from './useTaskSelection'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, UserPlus } from 'lucide-react'
import { privateApplicationsApi as api } from '../../api/api'
import './application-work.css'
import { dateLabel } from './lifecycle'
import { applicationWorkIntentKey, loadWorkIntention } from './intentions'
import FormModal from '../../components/FormModal'
import { useConfirmDialog } from '../../components/ConfirmDialog'
import ApplicationTaskCalendar from './ApplicationTaskCalendar'
import ApplicationTeamChat from './ApplicationTeamChat'

const STATUS = { OPEN:'Aberta', COMPLETED:'Concluída', CANCELLED:'Cancelada' }
const KIND = { PARTICIPANT_ADDED:'Participante adicionado', PARTICIPANT_REMOVED:'Participante removido', TASK_CREATED:'Tarefa criada', TASK_EDITED:'Tarefa alterada', TASK_COMPLETED:'Tarefa concluída', TASK_CANCELLED:'Tarefa cancelada', TASK_DELETED:'Tarefa eliminada' }
const emptyTask = { title:'', description:'', responsibleMembershipId:'', deadline:'' }
const initials = name => {
  const words = name.trim().split(/\s+/)
  return [words[0], words.length > 1 ? words.at(-1) : ''].map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase('pt-PT')
}
const message = error => ({401:'A sessão terminou. Recupere a sessão e volte a consultar a equipa.',400:'Verifique os campos.',403:'Sem permissão.',404:'Candidatura ou tarefa indisponível.',409:'Os dados mudaram. Recarregue antes de editar.'}[error?.response?.status] || 'Resultado incerto. Repita o mesmo envio para confirmar o resultado.')
const definitive = error => error?.response?.status===400 || (error?.response?.status===409 && ['STALE_REVISION','STATE_CONFLICT','RESPONSIBLE_UNAVAILABLE'].includes(error?.response?.data?.error?.code))

export default function ApplicationWork({ applicationId, userId, organizationId, responsibles, responsiblesNext, loadingResponsibles, responsiblesLoadFailed = false, loadMoreResponsibles, applicationResponsibleId, applicationDeadline, onPreparationChange, canEdit = true, loadDetails = true }) {
  const [work,setWork]=useState(null),[history,setHistory]=useState([]),[historyNext,setHistoryNext]=useState(null)
  const [participant,setParticipant]=useState(''),[taskForm,setTaskForm]=useState(emptyTask),[editing,setEditing]=useState(null)
  const [editor,setEditor]=useState(null)
  const { confirm, dialog } = useConfirmDialog()
  const [showCalendar, setShowCalendar] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [taskFilter, setTaskFilter] = useState('all')
  useEffect(() => {
    setTaskFilter('all')
    setShowCalendar(false)
  }, [applicationId, userId, organizationId])
  const participantTrigger = useRef(null)
  const chatTrigger = useRef(null)
  const taskEditorTrigger = useRef(null)
  const calendarTrigger = useRef(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(null)
  const [refresh,setRefresh]=useState(0),[reading,setReading]=useState(true)
  const [historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState(false),[historyRefresh,setHistoryRefresh]=useState(0)
  const responsibleNames=useMemo(()=>{const names=new Map();for(const person of [...(work?.members||[]),...responsibles])if(!names.has(person.membershipId))names.set(person.membershipId,person.name);return names},[responsibles,work?.members])
  const openTaskCounts=useMemo(()=>{const counts=new Map();for(const task of work?.tasks||[])if(task.status==='OPEN')counts.set(task.responsibleMembershipId,(counts.get(task.responsibleMembershipId)||0)+1);return counts},[work?.tasks])
  useEffect(()=>{const state=error?'unavailable':pending?'pending':busy?'updating':!work?'loading':'ready';onPreparationChange?.({state,data:state==='ready'?work:null})},[work,error,pending,busy,onPreparationChange])
  useEffect(()=>()=>onPreparationChange?.(null),[onPreparationChange])
  const generation=useRef(0)
  const [storageBlocked,setStorageBlocked]=useState(false)
  const writable=canEdit&&work?.canEdit===true&&!reading&&!storageBlocked
  const canDeleteTasks=writable&&work.canDeleteTasks===true
  useEffect(()=>{if(!writable)setEditor(null)},[writable])
  const reject=e=>{if([401,403,404].includes(e?.response?.status)){setWork(null);setHistory([]);setHistoryNext(null)}setError(message(e))}
  const selection = useTaskSelection({ applicationId, userId, organizationId, filter: taskFilter, work,
    onAuthority: data => setWork(previous => previous ? { ...previous, canEdit: data.canEdit, canChat: data.canChat, canDeleteTasks: data.canDeleteTasks } : previous), onDenied: reject })
  const intentKey=applicationWorkIntentKey(userId,organizationId,applicationId)
  useEffect(()=>{
    setWork(null);setHistory([]);setHistoryNext(null);setError('');setNotice('');setEditing(null);setTaskForm(emptyTask);setParticipant('');setEditor(null);setChatOpen(false);setStorageBlocked(false)
    try{setPending(loadWorkIntention(userId,organizationId,applicationId))}catch{setPending(null);setStorageBlocked(true);setError('Não foi possível recuperar o envio guardado. Os dados foram preservados; volte a consultar a equipa.')}
  },[applicationId,userId,organizationId,intentKey,refresh])
  useEffect(()=>{let active=true;generation.current += 1;setReading(true);setWork(null)
    const controller=new AbortController()
    api.work(applicationId,undefined,controller.signal).then(w=>{if(active)setWork(w.data)})
      .catch(e=>{if(active){reject(e);if(!e?.response?.status||e.response.status>=500)setError('Não foi possível carregar a equipa e tarefas. Repita a consulta.')}}).finally(()=>{if(active)setReading(false)})
    return()=>{active=false;controller.abort();generation.current += 1}
  },[applicationId,userId,organizationId,refresh])
  const workReady=Boolean(work)&&!reading
  useEffect(()=>{
    if(!loadDetails||!workReady)return
    let active=true
    const controller=new AbortController()
    setHistoryLoading(true);setHistoryError(false)
    api.workHistory(applicationId,undefined,controller.signal).then(({data})=>{
      if(active){setHistory(data.items||[]);setHistoryNext(data.nextCursor)}
    }).catch(e=>{
      if(!active)return
      if([401,403,404].includes(e?.response?.status))reject(e)
      else setHistoryError(true)
    }).finally(()=>{if(active)setHistoryLoading(false)})
    return()=>{active=false;controller.abort()}
  },[applicationId,userId,organizationId,loadDetails,workReady,historyRefresh])
  const send=async(method,payload,retry=false)=>{
    if(busy||!writable||retry&&(!pending||pending.applicationId!==applicationId||pending.userId!==userId||pending.organizationId!==organizationId))return;const epoch=generation.current;setBusy(true);setError('');setNotice('')
    let intent=pending
    if(!retry){if(intent){setError('Existe um envio por confirmar. Repita-o antes de alterar os dados.');setBusy(false);return}
      intent={userId,organizationId,applicationId,method,payload,idempotencyKey:crypto.randomUUID()};try{sessionStorage.setItem(intentKey,JSON.stringify(intent));setPending(intent)}catch{setStorageBlocked(true);setError('Não foi possível guardar o envio neste navegador. Volte a consultar a equipa.');setBusy(false);return}
    }
    try{
      const result=await api[intent.method](intent.applicationId,{...intent.payload,idempotencyKey:intent.idempotencyKey})
      if(epoch!==generation.current)return;sessionStorage.removeItem(intentKey);setPending(null);setNotice(intent.method==='taskDelete'?'Tarefa eliminada.':'Alteração confirmada.');setEditing(null);setTaskForm(emptyTask);setParticipant('');setEditor(null)
      try{const w=await api.work(applicationId)
        if(epoch!==generation.current)return;setWork(w.data);setHistoryRefresh(n=>n+1)
      }catch{if(epoch!==generation.current)return;setWork(null);setError('Alteração confirmada, mas a consulta falhou. Recarregue a equipa e tarefas.')}
      return result.data
    }catch(e){
      if(epoch!==generation.current)return
      const deletionDenied=intent.method==='taskDelete'&&[403,404].includes(e?.response?.status)
      if(definitive(e)||deletionDenied){
        sessionStorage.removeItem(intentKey)
        setPending(null)
        if(!deletionDenied){setWork(null);setRefresh(v=>v+1)}
      }
      reject(e)
    }
    finally{if(epoch===generation.current)setBusy(false)}
  }
  const mutate=(method,fields)=>send(method,{...fields,expectedRevision:work.revision})
  const activeParticipants=work?.participants.filter(p=>p.active)||[]
  const displayedParticipants=[...activeParticipants].sort((a,b)=>Number(b.membershipId===applicationResponsibleId)-Number(a.membershipId===applicationResponsibleId))
  const teamIds=new Set(activeParticipants.map(p=>p.membershipId))
  const optionRows=rows=>rows.map(r=><option key={r.membershipId} value={r.membershipId}>{r.name}</option>)
  const availableParticipants=responsibles.filter(r=>!teamIds.has(r.membershipId))
  const canAddParticipant = !busy && !pending && availableParticipants.some(item => item.membershipId === participant)
  const teamMembers=responsibles.filter(r=>teamIds.has(r.membershipId)),otherMembers=responsibles.filter(r=>!teamIds.has(r.membershipId))
  const options=<><option value="">Escolha um membro ativo</option>{teamMembers.length>0&&<optgroup label="Equipa da candidatura">{optionRows(teamMembers)}</optgroup>}{otherMembers.length>0&&<optgroup label="Outros membros disponíveis">{optionRows(otherMembers)}</optgroup>}</>
  const openTasks=work?.tasks.filter(t=>t.status==='OPEN')||[]
  const visibleTasks = taskFilter === 'all' ? (work?.tasks || []) : (selection.data?.tasks || [])
  const taskNextCursor = taskFilter === 'all' ? work?.taskNextCursor : selection.data?.taskNextCursor
  const afterInternal=deadline=>Boolean(applicationDeadline&&deadline&&deadline>applicationDeadline)

  const memberName=id=>!id ? 'Sem responsável' : selection.data?.members?.find(member => member.membershipId === id)?.name || responsibleNames.get(id) || `Colaborador não disponível (${id})`
  function editTask(task, trigger) {
    taskEditorTrigger.current = trigger
    setEditing(task.taskId)
    setTaskForm({ title: task.title, description: task.description || '', responsibleMembershipId: task.responsibleMembershipId, deadline: task.deadline })
    setEditor('task')
  }
  async function deleteTask(task) {
    const epoch = generation.current
    const confirmed = await confirm({
      title: 'Eliminar tarefa?',
      message: `«${task.title}» será retirada da lista e do calendário. A eliminação ficará registada no histórico.`,
      confirmLabel: 'Eliminar tarefa',
      tone: 'danger',
    })
    if (confirmed && epoch === generation.current) await mutate('taskDelete', { taskId: task.taskId })
  }
  const loadMore=async kind=>{if(busy||!work)return;const epoch=generation.current;setBusy(true);setError('')
    try{const result=(await api.work(applicationId,kind==='tasks'?{taskCursor:work.taskNextCursor}:{participantCursor:work.participantNextCursor})).data
      if(epoch!==generation.current)return
      setWork(previous=>{
        const updated={...previous,members:[...(previous.members||[]),...(result.members||[])],canEdit:result.canEdit,canChat:result.canChat,canDeleteTasks:result.canDeleteTasks}
        return kind==='tasks'
          ? {...updated,tasks:[...previous.tasks,...result.tasks.filter(item=>!previous.tasks.some(old=>old.taskId===item.taskId))],taskNextCursor:result.taskNextCursor}
          : {...updated,participants:[...previous.participants,...result.participants.filter(item=>!previous.participants.some(old=>old.membershipId===item.membershipId))],participantNextCursor:result.participantNextCursor}
      })
    }catch(e){if(epoch===generation.current)reject(e)}finally{if(epoch===generation.current)setBusy(false)}
  }
  const loadHistory=async()=>{if(busy)return;const epoch=generation.current;setBusy(true)
    try{const r=await api.workHistory(applicationId,{cursor:historyNext});if(epoch!==generation.current)return;setHistory(h=>[...h,...r.data.items]);setHistoryNext(r.data.nextCursor)}catch(e){if(epoch===generation.current)reject(e)}finally{if(epoch===generation.current)setBusy(false)}
  }
  const feedback=<>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {pending&&<p role="status">Envio por confirmar. {writable?<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>send(null,null,true)}>Repetir o mesmo envio</button>:'A intenção está preservada. Confirme a sessão e as permissões antes de continuar.'}</p>}</>
  return <section id="equipa-tarefas" tabIndex={-1} className="application-work detail-section" aria-label="Equipa e tarefas">
    {dialog}
    <div className="section-hd application-section-actions">
      <h2>Equipa e tarefas</h2>
      {writable && <button ref={participantTrigger} type="button" className="btn btn-primary" aria-haspopup="dialog"
        disabled={busy || Boolean(pending)} onClick={() => setEditor('participant')}>
        <UserPlus size={16} aria-hidden="true" /> Adicionar membro
      </button>}
    </div>
    {!editor&&feedback}
    {workReady && (!canEdit || work.canEdit !== true) && !pending && <p className="text-muted">Acesso de consulta à equipa e às tarefas.</p>}
    {work&&(!writable||storageBlocked)&&<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Recarregar equipa e tarefas</button>}
    {!work?<>{reading ? <p role="status">A carregar equipa e tarefas…</p> : <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Recarregar equipa e tarefas</button>}</>:<>
      <dl className="work-summary">
        <div><dt>Responsável da candidatura</dt><dd>{applicationResponsibleId?memberName(applicationResponsibleId):'Não identificado'}</dd></div>
        <div><dt>Prazo interno da candidatura</dt><dd>{dateLabel(applicationDeadline)}</dd></div>
        <div><dt>Participantes carregados</dt><dd>{activeParticipants.length}</dd></div>
        <div><dt>Tarefas abertas</dt><dd>{openTasks.length}</dd></div>
      </dl>
      {(work.participantNextCursor||work.taskNextCursor)&&<p role="status">Existem mais participantes ou tarefas por carregar. Os resumos referem-se à lista «Todas» já carregada.</p>}
      {taskFilter !== 'all' && !work.taskNextCursor && <p className="text-muted">Os resumos da equipa referem-se à lista «Todas» já carregada.</p>}
      <div className="application-work-participant-heading">
        <h3>Participantes</h3>
        {work.canChat && <button type="button" className="btn btn-outline btn-sm" ref={chatTrigger}
          aria-haspopup="dialog" onClick={() => setChatOpen(true)}>
          <MessageSquare size={16} aria-hidden="true" /> Chat da equipa
        </button>}
      </div>
      {work.canChat && <ApplicationTeamChat key={`${organizationId}:${userId}:${applicationId}`}
        applicationId={applicationId} organizationId={organizationId} open={chatOpen}
        onClose={() => setChatOpen(false)} returnFocusRef={chatTrigger} />}
      <ul className="work-participants">{displayedParticipants.map(person => {
        const name = memberName(person.membershipId)
        return <li key={person.membershipId}>
          <span className="work-participant-avatar" aria-hidden="true">{initials(name)}</span>
          <div className="work-participant-info">
            <strong>{name}</strong>
            {person.membershipId === applicationResponsibleId && <span className="chip chip-blue">Responsável da candidatura</span>}
            {person.eligible === false && <span className="text-muted">Acesso inativo</span>}
            <span className="text-muted">Tarefas abertas: {openTaskCounts.get(person.membershipId) || 0}</span>
          </div>
          {writable && <button type="button" className="btn btn-danger btn-sm" disabled={busy || !!pending}
            onClick={() => mutate('participantRemove', {membershipId:person.membershipId})}>Remover</button>}
        </li>
      })}</ul>
      {!activeParticipants.length && <p>Sem participantes.</p>}
      {work.participantNextCursor&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>loadMore('participants')}>Mais participantes</button>}
      {writable && editor === 'participant' && <FormModal title="Adicionar membro" locked={busy || Boolean(pending)}
        returnFocusRef={participantTrigger} onClose={() => setEditor(null)}>
        <form className="application-work-editor" onSubmit={event => {
          event.preventDefault()
          if (canAddParticipant) mutate('participantAdd', { membershipId: participant })
        }}>
          {feedback}
          <p>O membro passa a consultar a candidatura. A edição e os documentos mantêm permissões próprias.</p>
          <label>Membro da equipa
            <select aria-label="Membro da equipa" required value={participant} onChange={event => setParticipant(event.target.value)} disabled={busy || Boolean(pending)}>
              <option value="">Escolha um membro ativo</option>
              {optionRows(availableParticipants)}
            </select>
          </label>
          {loadingResponsibles && <p role="status">A carregar membros…</p>}
          {responsiblesLoadFailed && <p role="alert">Não foi possível carregar os membros da organização.</p>}
          {!responsiblesLoadFailed && !loadingResponsibles && !responsiblesNext && availableParticipants.length === 0 &&
            <p className="text-muted">Não há membros ativos disponíveis para adicionar.</p>}
          {responsiblesNext && <button type="button" className="btn btn-secondary btn-sm"
            disabled={busy || Boolean(pending) || loadingResponsibles} onClick={loadMoreResponsibles}>Mais membros</button>}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" disabled={busy || Boolean(pending)} onClick={() => setEditor(null)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!canAddParticipant}>Adicionar</button>
          </div>
        </form>
      </FormModal>}
      <div className="work-task-toolbar">
        <h3>Tarefas</h3>
        <button type="button" className="btn btn-outline" aria-haspopup="dialog" ref={calendarTrigger}
          onClick={() => setShowCalendar(true)}>Calendário</button>
      </div>
      <div className="work-task-filters" role="group" aria-label="Filtrar tarefas">
        {[["all", "Todas"], ["mine", "Minhas tarefas"], ["open", "Por concluir"], ["unassigned", "Sem responsável"]].map(([key, label]) =>
          <button type="button" key={key} className="btn btn-outline" aria-pressed={taskFilter === key}
            disabled={key === 'mine' && !work.currentMembershipId}
            aria-describedby={key === 'mine' && !work.currentMembershipId ? 'task-membership-unavailable' : undefined}
            onClick={() => setTaskFilter(key)}>{label}</button>)}
      </div>
      {!work.currentMembershipId && <p id="task-membership-unavailable" className="text-muted">Não foi possível identificar a sua associação à organização para filtrar as suas tarefas.</p>}
      <p className="work-task-filter-status" role="status">{selection.loading ? 'A pesquisar tarefas…' : `${visibleTasks.length} tarefas apresentadas.`} A pesquisa abrange todas as tarefas da candidatura. O calendário mostra os resultados apresentados.{taskNextCursor && ' Existem mais resultados deste filtro.'}</p>
      {selection.error && <p role="alert">Não foi possível consultar as tarefas deste filtro. <button type="button" className="btn btn-outline btn-sm" disabled={selection.loading} onClick={selection.data ? selection.loadMore : selection.retry}>Tentar novamente</button></p>}
      {showCalendar && <ApplicationTaskCalendar tasks={visibleTasks} memberName={memberName} labels={STATUS}
        editing={writable && editor === 'task'} onClose={() => setShowCalendar(false)} returnFocusRef={calendarTrigger}
        onEdit={writable ? editTask : undefined} disabled={busy || Boolean(pending) || selection.loading} />}
      {visibleTasks.length>0&&<p className="work-task-order">Tarefas abertas primeiro nas tarefas carregadas.</p>}<ul className="work-tasks">{[...visibleTasks].sort((a,b)=>Number(b.status==='OPEN')-Number(a.status==='OPEN')).map(t=><li key={t.taskId} id={`tarefa-${t.taskId}`} tabIndex={-1} className="work-task"><div className="work-task-heading"><strong>{t.title}</strong><span className="chip chip-grey">{STATUS[t.status]}</span></div><dl><div><dt>Responsável</dt><dd>{memberName(t.responsibleMembershipId)}</dd></div><div><dt>Prazo</dt><dd>{dateLabel(t.deadline)}</dd></div></dl>
        {t.description&&<p className="task-description">{t.description}</p>}
        {t.status==='OPEN'&&afterInternal(t.deadline)&&<p className="work-deadline-note">Prazo posterior ao prazo interno da candidatura.</p>}
        {writable&&t.status==='OPEN'&&<>{' '}<button type="button" className="btn btn-outline btn-sm" disabled={busy||!!pending} onClick={event=>editTask(t,event.currentTarget)}>Editar</button>{' '}
        <button type="button" className="btn btn-outline btn-sm" disabled={busy||!!pending} onClick={()=>mutate('taskComplete',{taskId:t.taskId})}>Concluir</button>{' '}
        <button type="button" className="btn btn-danger btn-sm" disabled={busy||!!pending} onClick={()=>mutate('taskCancel',{taskId:t.taskId})}>Cancelar</button></>}
        {canDeleteTasks&&<button type="button" className="btn btn-danger btn-sm" aria-haspopup="dialog" disabled={busy||!!pending} onClick={()=>deleteTask(t)}>Eliminar</button>}
      </li>)}</ul>{taskFilter === 'all' && !work.tasks.length && !work.taskNextCursor && <p>Sem tarefas.</p>}
      {taskFilter !== 'all' && !selection.loading && !selection.error && !visibleTasks.length && <div className="work-task-empty">
        <p>Sem tarefas com este filtro na candidatura.</p>
        {taskFilter !== 'all' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTaskFilter('all')}>Limpar filtro</button>}
      </div>}
      {taskNextCursor&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy || selection.loading} onClick={()=>taskFilter === 'all' ? loadMore('tasks') : selection.loadMore()}>Mais tarefas</button>}
      {writable&&<button type="button" className="btn btn-primary" disabled={busy||!!pending} onClick={event=>{taskEditorTrigger.current=event.currentTarget;setEditor('task')}}>{editing?'Continuar edição da tarefa':'Nova tarefa'}</button>}
      {writable&&editor==='task'&&<FormModal title={editing?'Editar tarefa':'Nova tarefa'} locked={busy||!!pending} returnFocusRef={taskEditorTrigger} onClose={()=>setEditor(null)}><form className="application-work-editor" onSubmit={e=>{
        e.preventDefault()
        mutate(editing?'taskEdit':'taskCreate',{
          ...(editing?{taskId:editing}:{}),
          title:taskForm.title.trim(),
          ...(work.canDescribeTasks?{description:taskForm.description.trim()||null}:{}),
          responsibleMembershipId:taskForm.responsibleMembershipId,
          deadline:taskForm.deadline,
        })
      }}>
        {feedback}<p className="text-muted">Atribuir uma tarefa não adiciona a pessoa à equipa nem altera o seu acesso à candidatura.</p>
        <label>Título da tarefa <input required maxLength="200" value={taskForm.title} onChange={e=>setTaskForm(f=>({...f,title:e.target.value}))} disabled={busy||!!pending}/></label>
        {work.canDescribeTasks&&<label>Descrição (opcional)
          <textarea rows={4} maxLength={2000} value={taskForm.description} onChange={e=>setTaskForm(f=>({...f,description:e.target.value}))} disabled={busy||!!pending}/>
        </label>}
        <label>Responsável da tarefa <select required value={taskForm.responsibleMembershipId} onChange={e=>setTaskForm(f=>({...f,responsibleMembershipId:e.target.value}))} disabled={busy||!!pending}>
          {taskForm.responsibleMembershipId&&!responsibles.some(r=>r.membershipId===taskForm.responsibleMembershipId)&&<option value={taskForm.responsibleMembershipId}>{memberName(taskForm.responsibleMembershipId)}</option>}{options}</select></label>
        <label>Prazo da tarefa <input required type="date" value={taskForm.deadline} onChange={e=>setTaskForm(f=>({...f,deadline:e.target.value}))} disabled={busy||!!pending}/></label>
        {afterInternal(taskForm.deadline)&&<p role="status">Este prazo ultrapassa o prazo interno da candidatura. Confirme se é intencional.</p>}
        <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy||!!pending}>{editing?'Guardar tarefa':'Criar tarefa'}</button>{editing&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy||!!pending} onClick={()=>{setEditing(null);setTaskForm(emptyTask);setEditor(null)}}>Cancelar edição</button>}</div>
      </form></FormModal>}
      <details className="work-history"><summary>Histórico da equipa e tarefas</summary><p>Revisão da equipa e tarefas: {work.revision}.</p>{historyLoading&&<p role="status">A carregar histórico…</p>}{historyError&&<p role="alert">Não foi possível carregar o histórico da equipa. <button type="button" onClick={()=>setHistoryRefresh(n=>n+1)}>Repetir consulta</button></p>}<ol>{history.map(h=><li key={h.revision}>Revisão {h.revision}: {KIND[h.kind]}{h.membershipId&&` — ${memberName(h.membershipId)}`}{h.taskId&&` — tarefa ${h.taskId}`}{h.title&&` · título: ${h.title}`}{h.responsibleMembershipId&&` · responsável: ${memberName(h.responsibleMembershipId)}`}{h.deadline&&` · prazo: ${h.deadline}`}{h.status&&` · estado: ${STATUS[h.status]}`} · autor: {h.actorSubjectId} · {new Date(h.recordedAt).toLocaleString('pt-PT')}
        {h.description&&<p className="task-description">{h.description}</p>}
      </li>)}</ol>
      {historyNext&&<button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={loadHistory}>Mais histórico de tarefas</button>}
      </details>
    </>}
  </section>
}
