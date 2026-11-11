import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {ToastProvider} from '../../components/ToastProvider'
import CentralOpportunityCreate,{CentralOpportunityForm} from './CentralOpportunityCreate'
import {platformCentralOpportunitiesApi as opportunitiesApi} from '../../api/api'
const auth=vi.hoisted(()=>({user:{id:'admin',platformRoles:['C4G_ADMIN']}}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
vi.mock('../../api/api',()=>({platformCentralOpportunitiesApi:{create:vi.fn(),get:vi.fn(),list:vi.fn()}}))
const id='71300000-0000-4000-8000-000000000002'
const view=component=>render(<MemoryRouter><ToastProvider>{component}</ToastProvider></MemoryRouter>)
afterEach(cleanup)
beforeEach(()=>{sessionStorage.clear();vi.resetAllMocks();opportunitiesApi.list.mockResolvedValue({data:{programmes:['Horizon Europe (HORIZON)','CENTRO2030'],opportunityTypes:['Concurso'],interventionAreas:[{code:'HEALTH',label:'Saúde'}]}});auth.user={id:'admin',platformRoles:['C4G_ADMIN']};opportunitiesApi.get.mockResolvedValue({data:{opportunityId:id}})})
it('blocks entity users and accepts C4G administration without any organization',()=>{
 auth.user={id:'member',platformRoles:[]}
 const first=render(<MemoryRouter initialEntries={['/administracao/oportunidades/nova']}><Routes><Route path='/administracao/oportunidades/nova' element={<CentralOpportunityCreate/>}/><Route path='/catalogo' element={<p>Catálogo público</p>}/></Routes></MemoryRouter>)
 expect(screen.getByText('Catálogo público')).toBeTruthy();expect(screen.queryByLabelText('Título')).toBeNull();first.unmount()
 auth.user={id:'admin',platformRoles:['C4G_ADMIN']};view(<CentralOpportunityCreate/>);expect(screen.getByLabelText('Título')).toBeTruthy()
})
  it('creates using functional fields only and independently re-reads before refreshing', async()=>{
    const done=vi.fn();opportunitiesApi.create.mockResolvedValue({data:{opportunityId:id,rowVersion:1,revisionNumber:1}})
    view(<CentralOpportunityForm onCreated={done} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Synthetic new'}})
    fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
    fireEvent.click(screen.getByText('Criar'))
    await waitFor(()=>expect(done).toHaveBeenCalledTimes(1))
    expect(Object.keys(opportunitiesApi.create.mock.calls[0][0]).sort()).toEqual(['fields','requestId'])
    expect(opportunitiesApi.create.mock.calls[0][0].fields).toEqual({title:'Synthetic new',funderName:'Synthetic funder'})
    expect(opportunitiesApi.get).toHaveBeenCalledWith(id)
  })
  it('retains creation key and freezes intention after uncertain result',async()=>{
    opportunitiesApi.create.mockRejectedValue({response:{status:503}})
    view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Synthetic retry'}})
    fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
    fireEvent.click(screen.getByText('Criar'));await screen.findByRole('alert')
    expect(screen.getByLabelText('Título').disabled).toBe(true)
    fireEvent.click(screen.getByText('Repetir confirmação'))
    await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
    expect(opportunitiesApi.create.mock.calls[0][0]).toEqual(opportunitiesApi.create.mock.calls[1][0])
  })
  it('does not repeat creation when receipt exists but READ is refused',async()=>{
    opportunitiesApi.create.mockResolvedValue({data:{opportunityId:id}});opportunitiesApi.get.mockRejectedValue({response:{status:404}})
    view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Synthetic receipt'}})
    fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
    fireEvent.click(screen.getByText('Criar'));await screen.findByRole('alert')
    fireEvent.click(screen.getByText('Repetir confirmação'))
    await waitFor(()=>expect(opportunitiesApi.get).toHaveBeenCalledTimes(2))
    expect(opportunitiesApi.create).toHaveBeenCalledTimes(1)
  })
  it.each([400,401,403,409])('renders controlled create failure %s without a false success',async status=>{
    const done=vi.fn();opportunitiesApi.create.mockRejectedValue({response:{status}})
    view(<CentralOpportunityForm onCreated={done} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Synthetic error'}})
    fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
    fireEvent.click(screen.getByText('Criar'));await screen.findByRole('alert')
    expect(done).not.toHaveBeenCalled();expect(opportunitiesApi.get).not.toHaveBeenCalled()
  })
  it('creation remains live under the application StrictMode mount cycle',async()=>{
    const done=vi.fn();opportunitiesApi.create.mockResolvedValue({data:{opportunityId:id}})
    render(<React.StrictMode><MemoryRouter><ToastProvider><CentralOpportunityForm onCreated={done} onCancel={vi.fn()} /></ToastProvider></MemoryRouter></React.StrictMode>)
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Synthetic strict mode'}})
    fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
    fireEvent.click(screen.getByText('Criar'));await waitFor(()=>expect(done).toHaveBeenCalledTimes(1))
  })
  it('does not unlock an uncertain creation when a later retry is denied',async()=>{
    opportunitiesApi.create.mockRejectedValueOnce({response:{status:503}}).mockRejectedValue({response:{status:403}})
    view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Synthetic uncertain then denied'}})
    fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
    fireEvent.click(screen.getByText('Criar'));await screen.findByRole('alert');fireEvent.click(screen.getByText('Repetir confirmação'))
    await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Título').disabled).toBe(true);expect(screen.getByText('Cancelar').disabled).toBe(true)
  })
function fill(){
 fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Recoverable opportunity'}})
 fireEvent.change(screen.getByLabelText('Financiador'),{target:{value:'Synthetic funder'}})
 fireEvent.click(screen.getByText('Criar'))
}
it.each([500,502,504])('freezes uncertain HTTP %s and retries the same command',async status=>{
 opportunitiesApi.create.mockRejectedValue({response:{status}})
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill()
 await screen.findByRole('alert');expect(screen.getByLabelText('Título').disabled).toBe(true)
 fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
 expect(opportunitiesApi.create.mock.calls[1][0]).toEqual(opportunitiesApi.create.mock.calls[0][0])
})
it('restores an uncertain command across unmount without exposing it to another admin',async()=>{
 opportunitiesApi.create.mockRejectedValue({response:{status:504}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill();await screen.findByRole('alert')
 const original=opportunitiesApi.create.mock.calls[0][0];first.unmount()
 auth.user={id:'other',platformRoles:['C4G_ADMIN']}
 const other=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);expect(screen.getByLabelText('Título').value).toBe('');other.unmount()
 auth.user={id:'admin',platformRoles:['C4G_ADMIN']}
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);
 expect(screen.getByLabelText('Título').value).toBe(original.fields.title)
 expect(screen.getByLabelText('Título').disabled).toBe(true)
 fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
 expect(opportunitiesApi.create.mock.calls[1][0]).toEqual(original)
})
it('persists before the response and recovers an in-flight command',async()=>{
 opportunitiesApi.create.mockImplementation(()=>new Promise(()=>{}))
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill()
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(1))
 const original=opportunitiesApi.create.mock.calls[0][0];first.unmount()
 opportunitiesApi.create.mockRejectedValue({response:{status:503}})
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
 expect(opportunitiesApi.create.mock.calls[1][0]).toEqual(original)
})
it('restores a receipt for GET only and clears storage after successful reading',async()=>{
 opportunitiesApi.create.mockResolvedValue({data:{opportunityId:id}});opportunitiesApi.get.mockRejectedValue({response:{status:503}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill();await screen.findByRole('alert');first.unmount()
 opportunitiesApi.get.mockResolvedValue({data:{opportunityId:id}});const done=vi.fn()
 const second=view(<CentralOpportunityForm onCreated={done} onCancel={vi.fn()}/>);fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));expect(opportunitiesApi.create).toHaveBeenCalledTimes(1);second.unmount()
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);expect(screen.getByLabelText('Título').value).toBe('')
})
it('does not send if durable browser storage is unavailable',async()=>{
 const blocked=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage blocked')})
 try{view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill();await screen.findByRole('alert');expect(opportunitiesApi.create).not.toHaveBeenCalled()}finally{blocked.mockRestore()}
})
it('clears a definitively rejected first command and permits correction after remount',async()=>{
 opportunitiesApi.create.mockRejectedValue({response:{status:400}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill();await screen.findByRole('alert');first.unmount()
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);expect(screen.getByLabelText('Título').disabled).toBe(false);expect(screen.getByLabelText('Título').value).toBe('')
})

it('retains the restored command when a retry is denied',async()=>{
 opportunitiesApi.create.mockRejectedValueOnce({response:{status:502}}).mockRejectedValue({response:{status:403}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill();await screen.findByRole('alert');first.unmount()
 const second=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByText('Repetir confirmação').disabled).toBe(false));second.unmount()
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);expect(screen.getByLabelText('Título').disabled).toBe(true)
 expect(opportunitiesApi.create.mock.calls[1][0]).toEqual(opportunitiesApi.create.mock.calls[0][0])
})
it('does not let a late response from an unmounted form overwrite recovery',async()=>{
 let resolveFirst
 opportunitiesApi.create.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve})).mockResolvedValue({data:{opportunityId:id}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);fill();await waitFor(()=>expect(resolveFirst).toBeTruthy());first.unmount()
 const done=vi.fn();const second=view(<CentralOpportunityForm onCreated={done} onCancel={vi.fn()}/>);fireEvent.click(screen.getByText('Repetir confirmação'));await waitFor(()=>expect(done).toHaveBeenCalledTimes(1))
 resolveFirst({data:{opportunityId:id}});await new Promise(resolve=>setTimeout(resolve,0));expect(opportunitiesApi.get).toHaveBeenCalledTimes(1);second.unmount()
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);expect(screen.getByLabelText('Título').value).toBe('')
})
it('blocks creation if the stored pending command cannot be recovered',()=>{
 sessionStorage.setItem('c4g.central-manual.intention.v1:admin','broken json')
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>);
 expect(screen.getByRole('alert')).toBeTruthy();expect(screen.getByText('Criar').disabled).toBe(true);expect(opportunitiesApi.create).not.toHaveBeenCalled()
})

const callTexts={geographySummary:'Portugal continental\nLocal de realização: Coimbra.',eligibleGroups:'PME e entidades de investigação.\nConsórcios com pelo menos duas entidades.',eligibilitySummary:'Apresentar plano de trabalhos.\n<img src=x onerror=alert(1)> é texto literal.'}
const callLabels={geographySummary:'Geografia/Local',eligibleGroups:'Grupos elegíveis',eligibilitySummary:'Requisitos aplicáveis à call'}
it('offers optional call information with explicit text limits and useful examples',()=>{
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>)
 for(const [field,max] of Object.entries({geographySummary:2000,eligibleGroups:4000,eligibilitySummary:4000})){
  const input=screen.getByLabelText(callLabels[field])
  expect(input.tagName).toBe('TEXTAREA');expect(input.maxLength).toBe(max);expect(input.required).toBe(false)
  expect(input.placeholder).not.toBe('')
 }
 expect(screen.getByRole('group',{name:'Destinatários e requisitos'})).toBeTruthy()
 expect(screen.queryByRole('checkbox')).toBeNull()
})
it('recovers all call texts and repeats the original key after an uncertain response',async()=>{
 opportunitiesApi.create.mockRejectedValue({response:{status:503}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>)
 for(const [field,value] of Object.entries(callTexts))fireEvent.change(screen.getByLabelText(callLabels[field]),{target:{value}})
 fill();await screen.findByRole('alert')
 const original=opportunitiesApi.create.mock.calls[0][0]
 expect(original.fields).toEqual({title:'Recoverable opportunity',funderName:'Synthetic funder',...callTexts})
 first.unmount()
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>)
 for(const [field,value] of Object.entries(callTexts)){
  expect(screen.getByLabelText(callLabels[field]).value).toBe(value)
  expect(screen.getByLabelText(callLabels[field]).disabled).toBe(true)
 }
 expect(document.querySelector('img,script')).toBeNull()
 fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
 expect(opportunitiesApi.create.mock.calls[1][0]).toEqual(original)
})
it('keeps a legacy recovered request unchanged when optional call fields are absent',async()=>{
 const original={requestId:'71300000-0000-4000-8000-000000000003',fields:{title:'Legacy command',funderName:'Legacy funder',summary:'Unchanged',currencyCode:'EUR'}}
 sessionStorage.setItem('c4g.central-manual.intention.v1:admin',JSON.stringify({userId:'admin',...original}))
 opportunitiesApi.create.mockRejectedValue({response:{status:503}})
 view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>)
 for(const field of Object.keys(callTexts))expect(screen.getByLabelText(callLabels[field]).value).toBe('')
 fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(1))
 expect(opportunitiesApi.create.mock.calls[0][0]).toEqual(original)
})

it('selects business classification and preserves it through an uncertain retry',async()=>{
 opportunitiesApi.create.mockRejectedValue({response:{status:503}})
 const first=view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>)
 await screen.findByRole('option',{name:'Horizon Europe (HORIZON)'})
 fireEvent.change(screen.getByLabelText('Programa'),{target:{value:'Horizon Europe (HORIZON)'}})
 fireEvent.change(screen.getByLabelText('Tipo de oportunidade'),{target:{value:'Concurso'}})
 fireEvent.change(screen.getByLabelText('Área de intervenção'),{target:{value:'HEALTH'}})
 fireEvent.change(screen.getByLabelText('URL oficial'),{target:{value:'https://example.org/official'}})
 fill();await screen.findByRole('alert')
 const command=opportunitiesApi.create.mock.calls[0][0]
 expect(command.fields).toMatchObject({programmeName:'Horizon Europe (HORIZON)',opportunityType:'Concurso',interventionArea:'HEALTH',officialUrl:'https://example.org/official'})
 first.unmount();view(<CentralOpportunityForm onCreated={vi.fn()} onCancel={vi.fn()}/>)
 expect(screen.getByLabelText('Área de intervenção').disabled).toBe(true)
 fireEvent.click(screen.getByText('Repetir confirmação'))
 await waitFor(()=>expect(opportunitiesApi.create).toHaveBeenCalledTimes(2))
 expect(opportunitiesApi.create.mock.calls[1][0]).toEqual(command)
})
