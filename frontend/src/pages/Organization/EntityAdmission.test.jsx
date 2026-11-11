import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const auth=vi.hoisted(()=>({admissions:{limited:true,items:[]},logout:vi.fn()}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
import EntityAdmission from './EntityAdmission'
const record={admissionId:'test',revision:0,fields:{},savedAt:null,administrator:{name:'Ana',email:'ana@example.org'},types:['COMPANY'],country:'PT',currency:'EUR'}
let api
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();localStorage.clear();api={draft:vi.fn().mockResolvedValue({data:record}),validate:vi.fn().mockResolvedValue({data:{valid:true,errors:{}}}),save:vi.fn().mockImplementation((id,body)=>Promise.resolve({data:{...record,fields:body.fields,revision:1,savedAt:'2026-10-18T10:00:00Z'}}))}})
afterEach(cleanup)
const mount=()=>render(<MemoryRouter initialEntries={['/adesao/test']}><EntityAdmission api={api}/></MemoryRouter>)
it('loads server draft, explicit name copy, and saves partial data without browser storage',async()=>{
 mount();fireEvent.change(await screen.findByLabelText(/Nome legal/),{target:{value:'Associação Exemplo'}});fireEvent.click(screen.getByRole('button',{name:'Usar o nome legal'}));expect(screen.getByLabelText(/Nome apresentado/).value).toBe('Associação Exemplo');fireEvent.click(screen.getByRole('button',{name:'Guardar rascunho'}));await screen.findByText('Rascunho guardado.');expect(api.save.mock.calls[0][1]).toMatchObject({expectedRevision:0,fields:{legalName:'Associação Exemplo',displayName:'Associação Exemplo'}});expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0)
})
it('server errors keep the input and focus the first invalid field',async()=>{
 api.validate.mockResolvedValue({data:{valid:false,errors:{nif:'NIF inválido.'}}});mount();fireEvent.change(await screen.findByLabelText(/NIF/),{target:{value:'123'}});fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText(/NIF/)));expect(screen.getByLabelText(/NIF/).value).toBe('123');expect(api.save).not.toHaveBeenCalled()
})
it('uncertain save repeats identical intention and does not claim success prematurely',async()=>{
 api.save.mockRejectedValueOnce(Error('lost'));mount();fireEvent.change(await screen.findByLabelText(/Nome legal/),{target:{value:'Preservar'}});fireEvent.click(screen.getByRole('button',{name:'Guardar rascunho'}));await screen.findByRole('button',{name:'Confirmar gravação'});expect(screen.queryByText('Rascunho guardado.')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Confirmar gravação'}));await screen.findByText('Rascunho guardado.');expect(api.save.mock.calls[0][1]).toEqual(api.save.mock.calls[1][1])
})
it('revision conflict preserves entered data and requires explicitly reloading',async()=>{
 api.save.mockRejectedValue({response:{status:409}});mount();fireEvent.change(await screen.findByLabelText(/Nome legal/),{target:{value:'Meu texto'}});fireEvent.click(screen.getByRole('button',{name:'Guardar rascunho'}));await screen.findByText(/A ficha foi alterada noutra sessão/);expect(screen.getByLabelText(/Nome legal/).value).toBe('Meu texto');expect(api.draft).toHaveBeenCalledTimes(1)
})
it('four steps retain values, zero workers, and review does not activate an organization',async()=>{
 mount();await screen.findByLabelText(/Nome legal/);fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await screen.findByLabelText(/Morada \*/);fireEvent.click(screen.getByRole('button',{name:'Usar o email do administrador'}));expect(screen.getByLabelText(/Email institucional/).value).toBe('ana@example.org');fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await screen.findByText('Administrador convidado');fireEvent.change(screen.getByLabelText(/Número de trabalhadores/),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await screen.findByRole('button',{name:'Validar e guardar ficha'});expect(screen.getByText('0')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Validar e guardar ficha'}));await screen.findByText(/Ficha completa e guardada/);expect(api.save.mock.calls[0][1].fields.workerCount).toBe(0);expect(auth.logout).not.toHaveBeenCalled()
})
it('save and exit stays available by name and logs out once only after server confirmation',async()=>{
 let confirmSave
 api.save.mockImplementation(()=>new Promise(resolve=>{confirmSave=resolve}))
 mount()
 fireEvent.change(await screen.findByLabelText(/Nome legal/),{target:{value:'Preservar antes de sair'}})
 const exit=screen.getByRole('button',{name:'Guardar e sair'})
 fireEvent.click(exit)
 await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(1))
 expect(exit.disabled).toBe(true)
 fireEvent.click(exit)
 expect(api.save).toHaveBeenCalledTimes(1)
 expect(auth.logout).not.toHaveBeenCalled()
 expect(screen.queryByText('Rascunho guardado.')).toBeNull()
 await act(async()=>confirmSave({data:{...record,fields:api.save.mock.calls[0][1].fields,revision:1,savedAt:'2026-10-30T10:00:00Z'}}))
 await waitFor(()=>expect(auth.logout).toHaveBeenCalledTimes(1))
 expect(api.save.mock.calls[0][1].fields.legalName).toBe('Preservar antes de sair')
 expect(exit.classList.contains('btn-logout')).toBe(true)
 expect(exit.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
})
it('save and exit preserves the draft and never logs out when saving fails',async()=>{
 api.save.mockRejectedValue(Error('offline'));mount();fireEvent.change(await screen.findByLabelText(/Nome legal/),{target:{value:'Dados a preservar'}});fireEvent.click(screen.getByRole('button',{name:'Guardar e sair'}));await screen.findByRole('button',{name:'Confirmar gravação'});expect(auth.logout).not.toHaveBeenCalled();expect(screen.getByLabelText(/Nome legal/).value).toBe('Dados a preservar');expect(screen.queryByText('Rascunho guardado.')).toBeNull()
})
it('submits only the saved revision and retries an uncertain conclusion with the same intention',async()=>{
 api.draft.mockResolvedValue({data:{...record,revision:3,completionAvailable:true}});api.submit=vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValue({data:{admissionId:'test',organizationId:'org',phase:'TENANT',canEnter:false}});mount();await screen.findByLabelText(/Nome legal/);for(let n=0;n<3;n++){fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await screen.findByRole('heading',{name:`${n+2}. ${['Morada e contactos','Administrador e dimensão','Rever'][n]}`})}fireEvent.click(screen.getByRole('button',{name:'Concluir ficha e preparar acesso'}));await screen.findByRole('button',{name:'Confirmar conclusão'});fireEvent.click(screen.getByRole('button',{name:'Confirmar conclusão'}));await screen.findByRole('heading',{name:'Estamos a preparar a entidade'});expect(api.submit.mock.calls[0][1]).toEqual(api.submit.mock.calls[1][1]);expect(Object.keys(api.submit.mock.calls[0][1]).sort()).toEqual(['expectedRevision','requestId']);expect(screen.queryByRole('button',{name:'Entrar na entidade'})).toBeNull()
})
it('reloads submitted progress without allowing edits or claiming active access',async()=>{
 api.draft.mockRejectedValue({response:{status:404}});api.status=vi.fn().mockResolvedValue({data:{admissionId:'test',phase:'TENANT',canEnter:false}});mount();await screen.findByRole('heading',{name:'Estamos a preparar a entidade'});expect(screen.queryByRole('button',{name:'Guardar rascunho'})).toBeNull();expect(screen.queryByRole('button',{name:'Entrar na entidade'})).toBeNull()
})
it('a fiscal conflict preserves the draft without disclosing another entity',async()=>{
 api.draft.mockResolvedValue({data:{...record,revision:2,completionAvailable:true}});api.submit=vi.fn().mockRejectedValue({response:{status:409,data:{error:{code:'FISCAL_IDENTITY_REVIEW_REQUIRED'}}}});mount();await screen.findByLabelText(/Nome legal/);for(let n=0;n<3;n++){fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await screen.findByRole('heading',{name:`${n+2}. ${['Morada e contactos','Administrador e dimensão','Rever'][n]}`})}fireEvent.click(screen.getByRole('button',{name:'Concluir ficha e preparar acesso'}));await screen.findByText(/A identificação fiscal necessita de verificação/);expect(screen.queryByRole('heading',{name:'Estamos a preparar a entidade'})).toBeNull()
})
it('explains when the account already belongs to another entity',async()=>{
 api.draft.mockResolvedValue({data:{...record,revision:2,completionAvailable:true}});api.submit=vi.fn().mockRejectedValue({response:{status:409,data:{error:{code:'MEMBERSHIP_ALREADY_EXISTS'}}}});mount();await screen.findByLabelText(/Nome legal/);for(let n=0;n<3;n++){fireEvent.click(screen.getByRole('button',{name:'Continuar'}));await screen.findByRole('heading',{name:`${n+2}. ${['Morada e contactos','Administrador e dimensão','Rever'][n]}`})}fireEvent.click(screen.getByRole('button',{name:'Concluir ficha e preparar acesso'}));await screen.findByText(/já pertence a uma entidade/)
})
