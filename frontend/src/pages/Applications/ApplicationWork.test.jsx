import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
const api=vi.hoisted(()=>({work:vi.fn(),workHistory:vi.fn(),chat:vi.fn(),chatSend:vi.fn(),taskCreate:vi.fn(),participantAdd:vi.fn(),participantRemove:vi.fn(),taskEdit:vi.fn(),taskComplete:vi.fn(),taskCancel:vi.fn(),taskDelete:vi.fn()}))
vi.mock('../../api/api',()=>({privateApplicationsApi:api}))
import ApplicationWork from './ApplicationWork'
import {lisbonDay} from '../../api/organizationDashboard'
import {applicationWorkIntentKey,loadWorkIntention,clearApplicationIntentions} from './intentions'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const props={applicationId:id(1),organizationId:id(2),userId:id(3),responsibles:[{membershipId:id(3),name:'Pessoa A'}],responsiblesNext:null,loadMoreResponsibles:vi.fn()}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();api.work.mockResolvedValue({data:{canEdit:true,revision:1,participants:[],tasks:[]}});api.workHistory.mockResolvedValue({data:{items:[],nextCursor:null}})})
afterEach(cleanup)

it('shows task descriptions in the list and calendar and lets an editor clear the text', async () => {
 const task={taskId:id(4),title:'Preparar orçamento',description:'Confirmar valores\nEnviar à equipa',status:'OPEN',responsibleMembershipId:id(3),deadline:lisbonDay()}
 api.work.mockResolvedValue({data:{canEdit:true,canDescribeTasks:true,canDeleteTasks:false,revision:1,participants:[],tasks:[task]}})
 api.taskEdit.mockResolvedValue({data:{revision:2}})
 render(<ApplicationWork {...props}/>)
 expect(await screen.findByText('Confirmar valores Enviar à equipa')).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Eliminar',exact:true})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Calendário',exact:true}))
 fireEvent.click(within(screen.getByRole('table')).getByRole('button',{name:'Ver tarefa Preparar orçamento'}))
 const details=within(screen.getByRole('dialog',{name:'Detalhes da tarefa'}))
 expect(details.getByText('Confirmar valores Enviar à equipa')).toBeTruthy()
 fireEvent.click(details.getByRole('button',{name:'Editar tarefa'}))
 const description=screen.getByLabelText('Descrição (opcional)')
 expect(description.value).toBe(task.description)
 fireEvent.change(description,{target:{value:''}})
 fireEvent.click(screen.getByRole('button',{name:'Guardar tarefa'}))
 await waitFor(()=>expect(api.taskEdit).toHaveBeenCalledWith(props.applicationId,expect.objectContaining({description:null,taskId:task.taskId})))
})

it('asks the organization admin to confirm before deleting a completed task and reloads its history', async () => {
 const task={taskId:id(4),title:'Orçamento aprovado',status:'COMPLETED',responsibleMembershipId:id(3),deadline:lisbonDay()}
 const work={canEdit:true,canDeleteTasks:true,revision:1,participants:[],tasks:[task]}
 api.work.mockResolvedValueOnce({data:work}).mockResolvedValue({data:{...work,revision:2,tasks:[]}})
 api.taskDelete.mockResolvedValue({data:{revision:2,deleted:true}})
 api.workHistory.mockResolvedValueOnce({data:{items:[],nextCursor:null}}).mockResolvedValue({
  data:{items:[{...task,revision:2,kind:'TASK_DELETED',actorSubjectId:id(3),recordedAt:new Date().toISOString()}],nextCursor:null}
 })
 render(<ApplicationWork {...props}/>)
 const remove=await screen.findByRole('button',{name:'Eliminar',exact:true})
 fireEvent.click(remove)
 const confirmation=()=>within(screen.getByRole('dialog',{name:'Eliminar tarefa?'}))
 fireEvent.click(confirmation().getByRole('button',{name:'Cancelar',exact:true}))
 expect(api.taskDelete).not.toHaveBeenCalled()
 fireEvent.click(remove)
 fireEvent.click(confirmation().getByRole('button',{name:'Eliminar tarefa',exact:true}))
 expect(await screen.findByText('Tarefa eliminada.',{exact:true})).toBeTruthy()
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Eliminar',exact:true})).toBeNull())
 expect(api.taskDelete).toHaveBeenCalledWith(props.applicationId,{taskId:task.taskId,expectedRevision:1,idempotencyKey:expect.any(String)})
 expect(await screen.findByText(/Revisão 2: Tarefa eliminada/)).toBeTruthy()
})
it('lets an active member with consultation access send only text and retry the same message',async()=>{
 api.work.mockResolvedValue({data:{canEdit:false,canChat:true,revision:1,participants:[{membershipId:id(3),active:true}],tasks:[]}})
 api.chat.mockResolvedValue({data:{items:[],nextCursor:null}})
 api.chatSend.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{messageId:id(8),own:true,body:'<b>Olá</b>',createdAt:'2026-11-11T10:00:00Z'}})
 render(<ApplicationWork {...props} canEdit={false} />)
 fireEvent.click(await screen.findByRole('button',{name:'Chat da equipa'}))
 const dialog=await screen.findByRole('dialog',{name:'Chat da equipa'})
 await within(dialog).findByText('Ainda não há mensagens.')
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Mensagem'}),{target:{value:' <b>Olá</b> '}})
 fireEvent.click(within(dialog).getByRole('button',{name:'Enviar'}))
 await within(dialog).findByRole('alert')
 fireEvent.click(within(dialog).getByRole('button',{name:'Enviar'}))
 expect(await within(dialog).findByText('<b>Olá</b>')).toBeTruthy()
 expect(dialog.querySelector('b')).toBeNull()
 const first=api.chatSend.mock.calls[0]
 expect(first.slice(0,3)).toEqual([props.applicationId,{messageId:expect.any(String),body:'<b>Olá</b>'},props.organizationId])
 expect(api.chatSend.mock.calls[1][1]).toEqual(first[1])
 fireEvent.click(within(dialog).getByRole('button',{name:'Fechar'}))
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Chat da equipa'})))
})

it('clears messages and the composer when access is revoked on a history request',async()=>{
 api.work.mockResolvedValue({data:{canEdit:false,canChat:true,revision:1,participants:[],tasks:[]}})
 api.chat.mockResolvedValueOnce({data:{items:[{messageId:id(9),authorName:'Pessoa B',body:'Olá equipa',createdAt:'2026-11-11T10:00:00Z'}],nextCursor:'older'}})
  .mockRejectedValueOnce({response:{status:404}})
 render(<ApplicationWork {...props} canEdit={false} />)
 fireEvent.click(await screen.findByRole('button',{name:'Chat da equipa'}))
 await screen.findByText('Olá equipa')
 fireEvent.click(screen.getByRole('button',{name:'Mensagens anteriores'}))
 expect((await screen.findByRole('alert')).textContent).toContain('Já não tem acesso ao chat da equipa.')
 expect(screen.queryByText('Olá equipa')).toBeNull()
 expect(screen.queryByRole('textbox',{name:'Mensagem'})).toBeNull()
})

it('retries a temporarily unavailable chat read before showing an error',async()=>{
 api.work.mockResolvedValue({data:{canEdit:false,canChat:true,revision:1,participants:[],tasks:[]}})
 api.chat.mockRejectedValueOnce({response:{status:503}})
  .mockResolvedValueOnce({data:{items:[],nextCursor:null}})
 render(<ApplicationWork {...props} canEdit={false} />)
 fireEvent.click(await screen.findByRole('button',{name:'Chat da equipa'}))
 await screen.findByText('Ainda não há mensagens.')
 expect(api.chat).toHaveBeenCalledTimes(2)
 expect(screen.queryByRole('alert')).toBeNull()
})
it('describes a read timeout as a retryable query rather than an uncertain write',async()=>{
 api.work.mockRejectedValueOnce({code:'ECONNABORTED'})
 render(<ApplicationWork {...props}/>);
 await screen.findByText('Não foi possível carregar a equipa e tarefas. Repita a consulta.');
 fireEvent.click(screen.getByRole('button',{name:'Recarregar equipa e tarefas'}));
 await screen.findByText('Sem participantes.');
 expect(screen.queryByRole('alert')).toBeNull();
})
it('shows scoped API names without loading the organization member list',async()=>{
 api.work.mockResolvedValue({data:{canEdit:false,revision:1,members:[{membershipId:id(3),name:'Técnico da equipa'}],participants:[{membershipId:id(3),active:true}],tasks:[]}})
 render(<ApplicationWork {...props} responsibles={[]} canEdit={false}/>);
 expect(await screen.findByText('Técnico da equipa')).toBeTruthy();
 expect(screen.queryByText(/Colaborador não disponível/)).toBeNull();
})
it('keeps team and task actions available after a temporary history failure',async()=>{
 api.workHistory.mockRejectedValueOnce({response:{status:503}})
 render(<ApplicationWork {...props}/>)
 await screen.findByRole('button',{name:'Adicionar membro'})
 fireEvent.click(screen.getByText('Histórico da equipa e tarefas',{selector:'summary'}))
 expect(await screen.findByText('Não foi possível carregar o histórico da equipa.')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Nova tarefa'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Repetir consulta'}))
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull())
})
it('provides preparation data while the work history is still loading',async()=>{
 api.workHistory.mockImplementation(()=>new Promise(()=>{}))
 const onPreparationChange=vi.fn()
 render(<ApplicationWork {...props} onPreparationChange={onPreparationChange}/> )
 await waitFor(()=>expect(onPreparationChange).toHaveBeenCalledWith(expect.objectContaining({state:'ready',data:expect.objectContaining({revision:1})})))
})
it('counts only loaded open tasks for each active participant',async()=>{
 const participants=[{membershipId:id(3),active:true},{membershipId:id(5),active:true}]
 const tasks=[{taskId:id(6),title:'Aberta A',status:'OPEN',responsibleMembershipId:id(3),deadline:'2027-01-30'},{taskId:id(7),title:'Fechada A',status:'COMPLETED',responsibleMembershipId:id(3),deadline:'2027-01-30'},{taskId:id(8),title:'Aberta B',status:'OPEN',responsibleMembershipId:id(5),deadline:'2027-01-30'}]
 api.work.mockResolvedValue({data:{canEdit:false,revision:1,participants,tasks}})
 const view=render(<ApplicationWork {...props} canEdit={false} responsibles={[...props.responsibles,{membershipId:id(5),name:'Pessoa B'}]}/>);
 await screen.findByText('Aberta A')
 const items=[...view.container.querySelectorAll('.work-participants li')]
 expect(items.map(item=>item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Pessoa A'),expect.stringContaining('Pessoa B')]))
 expect(items.every(item=>item.textContent.includes('Tarefas abertas: 1'))).toBe(true)
 expect(screen.queryByRole('button',{name:'Remover'})).toBeNull()
})
it('keeps tasks and participants visible without mutation controls for a read-only team member',async()=>{
 api.work.mockResolvedValue({data:{canEdit:true,revision:2,participants:[{membershipId:id(3),active:true}],tasks:[{taskId:id(4),title:'Tarefa preservada',status:'OPEN',responsibleMembershipId:id(3),deadline:'2027-01-30'}]}})
 render(<ApplicationWork {...props} canEdit={false}/>);
 await screen.findByText('Tarefa preservada');
 expect(screen.queryByRole('button',{name:'Remover'})).toBeNull();expect(screen.queryByRole('button',{name:'Concluir'})).toBeNull();
 expect(screen.queryByLabelText('Membro da equipa')).toBeNull();expect(screen.queryByRole('button',{name:'Criar tarefa'})).toBeNull();
})
it('opens member selection from the team header and explains when no member can be added', async () => {
  api.work.mockResolvedValue({ data: {
    canEdit: true, revision: 1, participants: [{ membershipId: id(3), active: true }], tasks: [],
  } })
  render(<ApplicationWork {...props} />)
  const action = await screen.findByRole('button', { name: 'Adicionar membro', exact: true })
  fireEvent.click(action)
  const editor = within(screen.getByRole('dialog', { name: 'Adicionar membro' }))
  expect(editor.getByText('Não há membros ativos disponíveis para adicionar.')).toBeTruthy()
  expect(editor.getByRole('button', { name: 'Adicionar', exact: true }).disabled).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(action))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.participantAdd).not.toHaveBeenCalled()
})
it('distinguishes an unavailable member list from an empty team selection', async () => {
  render(<ApplicationWork {...props} responsibles={[]} responsiblesLoadFailed />)
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar membro', exact: true }))
  const editor = within(screen.getByRole('dialog', { name: 'Adicionar membro' }))
  expect(editor.getByRole('alert').textContent).toContain('Não foi possível carregar os membros da organização.')
  expect(editor.queryByText('Não há membros ativos disponíveis para adicionar.')).toBeNull()
  expect(editor.getByRole('button', { name: 'Adicionar', exact: true }).disabled).toBe(true)
})
it('places tasks on their deadline and opens the existing editor only when permitted', async () => {
  const deadline = lisbonDay()
  const task = { taskId: id(4), title: 'Preparar orçamento', status: 'OPEN', responsibleMembershipId: id(3), deadline }
  api.work.mockResolvedValue({ data: { canEdit: true, revision: 1, participants: [], tasks: [task] } })
  const view = render(<ApplicationWork {...props} canEdit />)
  const opener = await screen.findByRole('button', { name: 'Calendário', exact: true })
  fireEvent.click(opener)
  const calendar = within(screen.getByRole('dialog', { name: 'Calendário de tarefas' }))
  const month = within(calendar.getByRole('table'))
  const editButton = () => month.getByRole('button', { name: 'Ver tarefa Preparar orçamento' })
  expect(editButton().closest('td').querySelector('time').dateTime).toBe(deadline)
  fireEvent.click(calendar.getByRole('button', { name: 'Mês seguinte' }))
  expect(month.queryByText(task.title)).toBeNull()
  fireEvent.click(calendar.getByRole('button', { name: 'Hoje' }))
  fireEvent.click(editButton())
  const details = within(screen.getByRole('dialog', { name: 'Detalhes da tarefa' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(details.getByText(task.title)).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(editButton()))
  fireEvent.click(editButton())
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Detalhes da tarefa' })).getByRole('button', { name: 'Editar tarefa' }))
  const editor = within(screen.getByRole('dialog', { name: 'Editar tarefa' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(editor.getByLabelText('Título da tarefa').value).toBe(task.title)
  expect(editor.getByLabelText('Prazo da tarefa').value).toBe(deadline)
  fireEvent.click(editor.getByRole('button', { name: 'Fechar', exact: true }))
  await waitFor(() => expect(document.activeElement).toBe(editButton()))
  view.rerender(<ApplicationWork {...props} canEdit={false} />)
  fireEvent.click(editButton())
  const readOnlyDetails = within(screen.getByRole('dialog', { name: 'Detalhes da tarefa' }))
  expect(readOnlyDetails.queryByRole('button', { name: 'Editar tarefa' })).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(opener))
  expect(api.taskEdit).not.toHaveBeenCalled()
})
it('keeps the same task intention after 503 and recovers on reload without duplicate submission',async()=>{
 api.taskCreate.mockRejectedValueOnce({response:{status:503}}).mockResolvedValue({data:{canEdit:true,revision:2,taskId:id(4)}})
 const view=render(<ApplicationWork {...props}/>)
 await screen.findByText('Revisão da equipa e tarefas: 1.',{exact:false})
 fireEvent.click(screen.getByRole('button',{name:'Nova tarefa',exact:true}))
 fireEvent.change(screen.getByLabelText('Título da tarefa'),{target:{value:'Preparar orçamento'}})
 fireEvent.change(screen.getByLabelText('Responsável da tarefa'),{target:{value:id(3)}})
 fireEvent.change(screen.getByLabelText('Prazo da tarefa'),{target:{value:'2027-01-30'}})
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa'}))
 await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 const stored=JSON.parse(sessionStorage.getItem(applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId)))
 expect(stored.payload.title).toBe('Preparar orçamento')
 view.unmount();render(<ApplicationWork {...props}/>)
 fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo envio'}))
 await waitFor(()=>expect(api.taskCreate).toHaveBeenCalledTimes(2))
 expect(api.taskCreate.mock.calls[0][1].idempotencyKey).toBe(stored.idempotencyKey)
 expect(api.taskCreate.mock.calls[1][1].idempotencyKey).toBe(stored.idempotencyKey)
 await waitFor(()=>expect(sessionStorage.getItem(applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId))).toBeNull())
})
it('clears uncertain work on logout before another user enters the same organization',async()=>{
 sessionStorage.setItem(applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId),JSON.stringify({...props,method:'taskCreate',payload:{title:'A',responsibleMembershipId:id(3),deadline:'2027-01-30',expectedRevision:1},idempotencyKey:id(5)}))
 const view=render(<ApplicationWork {...props}/>)
 await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 clearApplicationIntentions();view.unmount()
 render(<ApplicationWork {...props} userId={id(6)}/>)
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull())
 expect(api.taskCreate).not.toHaveBeenCalled()
})
it('waits for the confirmed revision before enabling the next mutation',async()=>{
 let resolveReload
 api.work.mockResolvedValueOnce({data:{canEdit:true,revision:1,participants:[],tasks:[]}})
   .mockImplementationOnce(()=>new Promise(resolve=>{resolveReload=resolve}))
 api.participantAdd.mockResolvedValue({data:{canEdit:true,revision:2,membershipId:id(3),active:true}})
 api.participantRemove.mockResolvedValue({data:{canEdit:true,revision:3,membershipId:id(3),active:false}})
 render(<ApplicationWork {...props}/>)
 await screen.findByText('Revisão da equipa e tarefas: 1.',{exact:false})
 fireEvent.click(screen.getByRole('button',{name:'Adicionar membro',exact:true}))
 fireEvent.change(screen.getByLabelText('Membro da equipa'),{target:{value:id(3)}})
 fireEvent.click(screen.getByRole('button',{name:'Adicionar',exact:true}))
 await waitFor(()=>expect(api.participantAdd).toHaveBeenCalledTimes(1))
 expect(screen.getByRole('button',{name:'Adicionar membro',exact:true}).disabled).toBe(true)
 await act(async()=>resolveReload({data:{canEdit:true,revision:2,participants:[{membershipId:id(3),active:true,eligible:true}],tasks:[]}}))
 fireEvent.click(await screen.findByRole('button',{name:'Remover'}))
 await waitFor(()=>expect(api.participantRemove).toHaveBeenCalledTimes(1))
 expect(api.participantRemove.mock.calls[0][1].expectedRevision).toBe(2)
})

it('shows the resulting assignee and deadline for a task edit after reload',async()=>{
 const entry={revision:3,kind:'TASK_EDITED',taskId:id(4),title:'Preparar',responsibleMembershipId:id(5),deadline:'2027-02-15',status:'OPEN',actorSubjectId:id(6),recordedAt:'2027-01-10T12:00:00.000Z'}
 api.workHistory.mockResolvedValue({data:{items:[entry],nextCursor:null}})
 const view=render(<ApplicationWork {...props}/>)
 await screen.findByText('Revisão 3:',{exact:false})
 view.unmount();render(<ApplicationWork {...props}/>)
 const history=await screen.findByText('Revisão 3:',{exact:false})
 expect(history.textContent).toContain(`tarefa ${id(4)}`)
 expect(history.textContent).toContain(`responsável: Colaborador não disponível (${id(5)})`)
 expect(history.textContent).toContain('prazo: 2027-02-15')
 expect(history.textContent).toContain('estado: Aberta')
 expect(history.textContent).toContain(`autor: ${id(6)}`)
})
it('distinguishes application responsibility, team and task assignment with partial-page context',async()=>{
 api.work.mockResolvedValue({data:{canEdit:true,revision:2,participants:[{membershipId:id(3),active:true}],participantNextCursor:'more',taskNextCursor:'tasks',tasks:[{taskId:id(4),title:'Orçamento',status:'OPEN',responsibleMembershipId:id(3),deadline:'2027-02-01'}]}})
 render(<ApplicationWork {...props} applicationResponsibleId={id(3)} applicationDeadline="2027-01-30" responsibles={[...props.responsibles,{membershipId:id(5),name:'Pessoa B'}]}/>);
 await screen.findAllByText('Responsável da candidatura')
 expect(screen.getByText('Prazo posterior ao prazo interno da candidatura.')).toBeTruthy()
 expect(screen.getByText('Existem mais participantes ou tarefas por carregar. Os resumos referem-se à lista «Todas» já carregada.')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Adicionar membro',exact:true}))
 const add=screen.getByLabelText('Membro da equipa')
 expect([...add.options].map(o=>o.value)).not.toContain(id(3));expect([...add.options].map(o=>o.value)).toContain(id(5))
 fireEvent.click(screen.getByRole('button',{name:'Fechar',exact:true}))
 fireEvent.click(screen.getByRole('button',{name:'Nova tarefa',exact:true}))
 const task=screen.getByLabelText('Responsável da tarefa')
 expect(task.querySelector('optgroup[label="Equipa da candidatura"] option').value).toBe(id(3))
 expect(task.querySelector('optgroup[label="Outros membros disponíveis"] option').value).toBe(id(5))
 fireEvent.change(screen.getByLabelText('Prazo da tarefa'),{target:{value:'2027-02-02'}})
 expect(screen.getByText('Este prazo ultrapassa o prazo interno da candidatura. Confirme se é intencional.')).toBeTruthy()
 expect(api.taskCreate).not.toHaveBeenCalled();expect(api.participantAdd).not.toHaveBeenCalled()
})
it('keeps an intentional later task deadline and does not add the assignee to the team',async()=>{
 api.taskCreate.mockRejectedValue({response:{status:503}})
 render(<ApplicationWork {...props} applicationDeadline="2027-01-30"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Nova tarefa',exact:true}))
 fireEvent.change(await screen.findByLabelText('Título da tarefa'),{target:{value:'Relatório posterior'}})
 fireEvent.change(screen.getByLabelText('Responsável da tarefa'),{target:{value:id(3)}})
 fireEvent.change(screen.getByLabelText('Prazo da tarefa'),{target:{value:'2027-02-15'}})
 expect(screen.getByText('Este prazo ultrapassa o prazo interno da candidatura. Confirme se é intencional.')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa'}))
 await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 expect(api.taskCreate).toHaveBeenCalledWith(props.applicationId,expect.objectContaining({title:'Relatório posterior',responsibleMembershipId:id(3),deadline:'2027-02-15',expectedRevision:1}))
 expect(api.participantAdd).not.toHaveBeenCalled()
})

it('publishes existing reads, hides updating data, refreshes and clears its projection on unmount',async()=>{
 let finish
 const initial={canEdit:true,revision:1,participants:[],tasks:[{taskId:id(4),title:'Preparar',status:'OPEN',responsibleMembershipId:id(3)}]}
 api.work.mockResolvedValueOnce({data:initial}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 api.taskComplete.mockResolvedValue({data:{canEdit:true,revision:2}})
 const publish=vi.fn(),view=render(<ApplicationWork {...props} onPreparationChange={publish}/>)
 await waitFor(()=>expect(publish).toHaveBeenLastCalledWith({state:'ready',data:initial}))
 expect(api.work).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'Concluir'}))
 await waitFor(()=>expect(api.work).toHaveBeenCalledTimes(2))
 expect(publish.mock.calls.at(-1)[0].data).toBeNull()
 const updated={...initial,revision:2,tasks:[{...initial.tasks[0],status:'COMPLETED'}]}
 await act(async()=>finish({data:updated}))
 await waitFor(()=>expect(publish).toHaveBeenLastCalledWith({state:'ready',data:updated}))
 expect(api.work).toHaveBeenCalledTimes(2)
 view.unmount();expect(publish).toHaveBeenLastCalledWith(null)
})
it('publishes unavailable instead of an empty successful projection on access refusal',async()=>{
 api.work.mockRejectedValue({response:{status:403}})
 const publish=vi.fn();render(<ApplicationWork {...props} onPreparationChange={publish}/>)
 await waitFor(()=>expect(publish).toHaveBeenLastCalledWith({state:'unavailable',data:null}))
})

it('does not offer a foreign legacy intention on the open application',async()=>{
 const legacy=`c4g.application.work.intention.v1:${props.userId}:${props.organizationId}`
 const value={...props,applicationId:id(99),method:'taskComplete',payload:{taskId:id(4),expectedRevision:1},idempotencyKey:id(8)}
 sessionStorage.setItem(legacy,JSON.stringify(value));render(<ApplicationWork {...props}/>);await screen.findByText('Revisão da equipa e tarefas: 1.',{exact:false})
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull();expect(sessionStorage.getItem(legacy)).toBe(JSON.stringify(value))
})
it('does not retry a pending command with no current work permission',async()=>{
 const key=applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId)
 sessionStorage.setItem(key,JSON.stringify({...props,method:'taskComplete',payload:{taskId:id(4),expectedRevision:1},idempotencyKey:id(8)}))
 api.work.mockResolvedValue({data:{revision:1,canEdit:false,participants:[],tasks:[]}})
 render(<ApplicationWork {...props}/>);await screen.findByText('Revisão da equipa e tarefas: 1.',{exact:false})
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull();expect(screen.queryByRole('button',{name:'Criar tarefa'})).toBeNull();expect(sessionStorage.getItem(key)).not.toBeNull()
})
it.each([401,403,404])('removes stale tasks after %s and retries only after explicit authority reload',async status=>{
 api.work.mockResolvedValue({data:{canEdit:true,revision:1,participants:[],tasks:[{taskId:id(4),title:'Privada',status:'OPEN'}]}})
 api.taskComplete.mockRejectedValueOnce({response:{status}}).mockResolvedValueOnce({data:{revision:2}})
 render(<ApplicationWork {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Concluir'}));await screen.findByRole('alert')
 expect(screen.queryByText('Privada')).toBeNull();expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
 const key=applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId),stored=sessionStorage.getItem(key);expect(stored).not.toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Recarregar equipa e tarefas'}));await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 expect(api.taskComplete).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(key)).toBe(stored)
 fireEvent.click(screen.getByRole('button',{name:'Repetir o mesmo envio'}));await screen.findByText('Alteração confirmada.')
 expect(api.taskComplete.mock.calls[1]).toEqual(api.taskComplete.mock.calls[0])
})

it('migrates only matching legacy work without changing the command or replacing another scoped intention',()=>{
 const legacy=`c4g.application.work.intention.v1:${props.userId}:${props.organizationId}`,key=applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId)
 const value={userId:props.userId,organizationId:props.organizationId,applicationId:props.applicationId,method:'taskComplete',payload:{taskId:id(4),expectedRevision:1},idempotencyKey:id(8)}
 sessionStorage.setItem(legacy,JSON.stringify(value));expect(loadWorkIntention(props.userId,props.organizationId,id(99))).toBeNull()
 expect(loadWorkIntention(props.userId,props.organizationId,props.applicationId)).toEqual(value);expect(sessionStorage.getItem(legacy)).toBeNull()
 sessionStorage.setItem(legacy,JSON.stringify({...value,idempotencyKey:id(9)}));expect(loadWorkIntention(props.userId,props.organizationId,props.applicationId)).toEqual(value)
 expect(JSON.parse(sessionStorage.getItem(key))).toEqual(value);expect(sessionStorage.getItem(legacy)).not.toBeNull()
})
it('keeps independent pending commands for two applications',()=>{
 const first=applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId),second=applicationWorkIntentKey(props.userId,props.organizationId,id(99))
 expect(first).not.toBe(second)
 for(const app of [props.applicationId,id(99)])sessionStorage.setItem(applicationWorkIntentKey(props.userId,props.organizationId,app),JSON.stringify({...props,applicationId:app,method:'taskComplete',payload:{taskId:id(4)},idempotencyKey:app}))
 expect(loadWorkIntention(props.userId,props.organizationId,props.applicationId).applicationId).toBe(props.applicationId)
 expect(loadWorkIntention(props.userId,props.organizationId,id(99)).applicationId).toBe(id(99))
})
it('hides cached work after history access is revoked',async()=>{
 api.work.mockResolvedValue({data:{canEdit:true,revision:1,participants:[],tasks:[{taskId:id(4),title:'Privada',status:'OPEN'}]}})
 api.workHistory.mockResolvedValueOnce({data:{items:[],nextCursor:'next'}}).mockRejectedValueOnce({response:{status:403}})
 render(<ApplicationWork {...props}/>);fireEvent.click(await screen.findByText('Histórico da equipa e tarefas'));fireEvent.click(await screen.findByRole('button',{name:'Mais histórico de tarefas'}));await screen.findByRole('alert')
 expect(screen.queryByText('Privada')).toBeNull();expect(screen.queryByRole('button',{name:'Criar tarefa'})).toBeNull()
})

it('preserves an unresolved intention when its response arrives after leaving the application',async()=>{
 let finish;api.taskComplete.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 api.work.mockResolvedValue({data:{canEdit:true,revision:1,participants:[],tasks:[{taskId:id(4),title:'Privada',status:'OPEN'}]}})
 const view=render(<ApplicationWork {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Concluir'}))
 const key=applicationWorkIntentKey(props.userId,props.organizationId,props.applicationId),saved=sessionStorage.getItem(key)
 view.unmount();await act(async()=>finish({data:{revision:2}}))
 expect(sessionStorage.getItem(key)).toBe(saved);expect(api.work).toHaveBeenCalledTimes(1)
})

it('opens task editing in a modal and preserves the draft when closed',async()=>{
 render(<ApplicationWork {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Nova tarefa',exact:true}))
 expect(screen.getByRole('dialog',{name:'Nova tarefa'})).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Título da tarefa'),{target:{value:'Budget em preparação'}})
 fireEvent.click(screen.getByRole('button',{name:'Fechar',exact:true}))
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(screen.queryByLabelText('Título da tarefa')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Nova tarefa',exact:true}))
 expect(screen.getByLabelText('Título da tarefa').value).toBe('Budget em preparação')
 expect(api.taskCreate).not.toHaveBeenCalled()
})

it('closes an editor after permission loss without sending its draft',async()=>{
 const view=render(<ApplicationWork {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Nova tarefa',exact:true}))
 fireEvent.change(screen.getByLabelText('Título da tarefa'),{target:{value:'Preservada'}})
 view.rerender(<ApplicationWork {...props} canEdit={false}/>);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
 expect(api.taskCreate).not.toHaveBeenCalled()
 view.rerender(<ApplicationWork {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Nova tarefa',exact:true}))
 expect(screen.getByLabelText('Título da tarefa').value).toBe('Preservada')
})

it('keeps an uncertain modal locked with explicit recovery and closes only after confirmation',async()=>{
 api.taskCreate.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{revision:2}})
 render(<ApplicationWork {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Nova tarefa',exact:true}))
 fireEvent.change(screen.getByLabelText('Título da tarefa'),{target:{value:'Budget'}})
 fireEvent.change(screen.getByLabelText('Responsável da tarefa'),{target:{value:id(3)}})
 fireEvent.change(screen.getByLabelText('Prazo da tarefa'),{target:{value:'2027-01-30'}})
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa'}))
 const retry=await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 expect(screen.getByRole('button',{name:'Fechar',exact:true}).disabled).toBe(true)
 fireEvent.keyDown(document,{key:'Escape'})
 expect(screen.getByRole('dialog',{name:'Nova tarefa'})).toBeTruthy()
 fireEvent.click(retry)
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
 expect(api.taskCreate).toHaveBeenCalledTimes(2)
 expect(api.taskCreate.mock.calls[1]).toEqual(api.taskCreate.mock.calls[0])
})

it('apresenta primeiro as tarefas abertas entre as carregadas',async()=>{
 api.work.mockResolvedValue({data:{canEdit:true,revision:1,participants:[],tasks:[{taskId:id(4),title:'Concluída antes',status:'COMPLETED',responsibleMembershipId:id(3),deadline:'2027-01-30'},{taskId:id(5),title:'Aberta depois',status:'OPEN',responsibleMembershipId:id(3),deadline:'2027-01-30'}],taskNextCursor:'next'}})
 const view=render(<ApplicationWork {...props}/>);await screen.findByText('Aberta depois');expect([...view.container.querySelectorAll('.work-task strong')].map(x=>x.textContent)).toEqual(['Aberta depois','Concluída antes']);expect(screen.getByText('Tarefas abertas primeiro nas tarefas carregadas.')).toBeTruthy();expect(screen.getByRole('button',{name:'Mais tarefas'})).toBeTruthy()
})

const filterTasks = () => [
 {taskId:id(40),title:'Minha aberta',status:'OPEN',responsibleMembershipId:id(30),deadline:lisbonDay()},
 {taskId:id(41),title:'Minha concluída',status:'COMPLETED',responsibleMembershipId:id(30),deadline:lisbonDay()},
 {taskId:id(42),title:'Outra aberta',status:'OPEN',responsibleMembershipId:id(31),deadline:lisbonDay()},
 {taskId:id(43),title:'Sem atribuição',status:'OPEN',responsibleMembershipId:null,deadline:lisbonDay()},
 {taskId:id(44),title:'Cancelada',status:'CANCELLED',responsibleMembershipId:id(31),deadline:lisbonDay()},
]
const taskTitles = container => [...container.querySelectorAll('.work-tasks .work-task-heading strong')].map(node=>node.textContent)
it('filters by authenticated membership, status and missing assignment without confusing unknown names',async()=>{
 api.work.mockImplementation(async (_,params)=>({data:{canEdit:false,currentMembershipId:id(30),revision:1,participants:[],tasks:filterTasks().filter(t=>!params?.taskFilter||params.taskFilter==='mine'&&t.responsibleMembershipId===id(30)||params.taskFilter==='open'&&t.status==='OPEN'||params.taskFilter==='unassigned'&&!t.responsibleMembershipId)}}))
 const view=render(<ApplicationWork {...props} canEdit={false}/>);
 await screen.findByText('Minha aberta');
 fireEvent.click(screen.getByRole('button',{name:'Minhas tarefas',exact:true}));
 await waitFor(()=>expect(taskTitles(view.container)).toEqual(['Minha aberta','Minha concluída']));
 fireEvent.click(screen.getByRole('button',{name:'Por concluir',exact:true}));
 await waitFor(()=>expect(taskTitles(view.container)).toEqual(['Minha aberta','Outra aberta','Sem atribuição']));
 fireEvent.click(screen.getByRole('button',{name:'Sem responsável',exact:true}));
 await waitFor(()=>expect(taskTitles(view.container)).toEqual(['Sem atribuição']));
 expect(screen.queryByRole('button',{name:'Editar',exact:true})).toBeNull();
})
it('finds personal tasks absent from the initial page and paginates within the server filter',async()=>{
 const base={canEdit:false,currentMembershipId:id(30),revision:1,participants:[]};
 api.work.mockResolvedValueOnce({data:{...base,tasks:[filterTasks()[2]],taskNextCursor:'all-next'}})
  .mockResolvedValueOnce({data:{...base,tasks:[filterTasks()[0]],taskNextCursor:'mine-next'}})
  .mockResolvedValueOnce({data:{...base,tasks:[filterTasks()[1]],taskNextCursor:null}});
 const view=render(<ApplicationWork {...props}/>);await screen.findByText('Outra aberta');
 fireEvent.click(screen.getByRole('button',{name:'Minhas tarefas',exact:true}));
 await screen.findByText('Minha aberta');expect(taskTitles(view.container)).toEqual(['Minha aberta']);
 expect(api.work.mock.calls[1][1]).toEqual({taskFilter:'mine'});
 fireEvent.click(screen.getByRole('button',{name:'Mais tarefas'}));await screen.findByText('Minha concluída');
 expect(api.work.mock.calls[2][1]).toEqual({taskFilter:'mine',taskCursor:'mine-next'});
 expect(taskTitles(view.container)).toEqual(['Minha aberta','Minha concluída']);
 fireEvent.click(screen.getByRole('button',{name:'Todas',exact:true}));
 expect(taskTitles(view.container)).toEqual(['Outra aberta']);
})
it('opens the calendar with the active filter and resets filters for another candidature',async()=>{
 api.work.mockImplementation(async (_,params)=>({data:{canEdit:false,currentMembershipId:id(30),revision:1,participants:[],tasks:filterTasks().filter(t=>!params?.taskFilter||params.taskFilter==='mine'&&t.responsibleMembershipId===id(30)||params.taskFilter==='open'&&t.status==='OPEN'||params.taskFilter==='unassigned'&&!t.responsibleMembershipId)}}));
 const view=render(<ApplicationWork {...props}/>);await screen.findByText('Minha aberta');
 fireEvent.click(screen.getByRole('button',{name:'Minhas tarefas',exact:true}));
 await waitFor(()=>expect(taskTitles(view.container)).toEqual(['Minha aberta','Minha concluída']));
 fireEvent.click(screen.getByRole('button',{name:'Calendário',exact:true}));
 const calendar=within(screen.getByRole('dialog',{name:'Calendário de tarefas'}));
 expect(calendar.queryByText('Outra aberta')).toBeNull();
 expect(calendar.getAllByText('Minha aberta').length).toBeGreaterThan(0);
 view.rerender(<ApplicationWork {...props} applicationId={id(90)}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Todas',exact:true}).getAttribute('aria-pressed')).toBe('true'));
 expect(screen.queryByRole('dialog')).toBeNull();
})
it('does not infer personal membership from the user identifier',async()=>{
 render(<ApplicationWork {...props}/>);
 expect((await screen.findByRole('button',{name:'Minhas tarefas'})).disabled).toBe(true);
})
it('discards a late response after selecting another server filter',async()=>{
 let resolveMine;const base={canEdit:false,currentMembershipId:id(30),revision:1,participants:[]};
 api.work.mockImplementation((_,params)=>params?.taskFilter==='mine'?new Promise(resolve=>{resolveMine=resolve}):Promise.resolve({data:{...base,tasks:params?.taskFilter==='open'?[filterTasks()[2]]:filterTasks()}}));
 const view=render(<ApplicationWork {...props}/>);await screen.findByText('Minha aberta');
 fireEvent.click(screen.getByRole('button',{name:'Minhas tarefas'}));
 fireEvent.click(screen.getByRole('button',{name:'Por concluir'}));await screen.findByText('Outra aberta');
 await act(async()=>resolveMine({data:{...base,tasks:[filterTasks()[0]]}}));
 expect(taskTitles(view.container)).toEqual(['Outra aberta']);
})
it('shows retry rather than a false empty result when server filtering fails',async()=>{
 api.work.mockResolvedValueOnce({data:{canEdit:false,currentMembershipId:id(30),revision:1,participants:[],tasks:[]}}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({data:{canEdit:false,revision:1,tasks:[filterTasks()[0]],members:[]}});
 render(<ApplicationWork {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Minhas tarefas'}));
 await screen.findByText(/Não foi possível consultar as tarefas deste filtro/);
 expect(screen.queryByText('Sem tarefas com este filtro na candidatura.')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Tentar novamente',exact:true}));await screen.findByText('Minha aberta');
})
