import {beforeEach,expect,it,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import EntityInvitation from './EntityInvitation'
const record={id:'test',name:'Ana',email:'ana@example.invalid',phase:'IDENTITY',createdAt:'2026-10-18T12:00:00Z'}
const api={list:vi.fn(),create:vi.fn(),get:vi.fn(),resume:vi.fn(),issue:vi.fn(),cancel:vi.fn()}
beforeEach(()=>{cleanup();vi.resetAllMocks();api.get.mockResolvedValue({data:record});api.list.mockResolvedValue({data:{page:1,pageSize:25,total:0,items:[]}})})
const mount=()=>render(<MemoryRouter><EntityInvitation api={api}/></MemoryRouter>)
it('opens a modal focused on name and cancels without creating an invitation',async()=>{
 mount();const trigger=screen.getByRole('button',{name:'Novo convite'});trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'Novo convite'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByLabelText('Nome do administrador'));
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(trigger));expect(api.create).not.toHaveBeenCalled();
})
it('contains uncertain feedback and retry, locking dismissal until the result is known',async()=>{
 api.create.mockRejectedValueOnce(Error('lost')).mockResolvedValue({data:record});mount();await review();fireEvent.click(screen.getByRole('button',{name:'Criar convite'}));
 const retry=await screen.findByRole('button',{name:'Repetir o mesmo pedido'}),dialog=screen.getByRole('dialog');
 expect(dialog.contains(retry)).toBe(true);expect(dialog.contains(screen.getByRole('alert'))).toBe(true);
 fireEvent.keyDown(document.activeElement,{key:'Escape'});expect(screen.getByRole('dialog')).toBe(dialog);expect(screen.getByRole('button',{name:'Corrigir dados'}).disabled).toBe(true);
 fireEvent.click(retry);await screen.findByText('Preparar conta');expect(screen.queryByRole('dialog')).toBeNull();expect(api.create.mock.calls[0][0]).toEqual(api.create.mock.calls[1][0]);expect(api.issue).not.toHaveBeenCalled();
})
async function review(){fireEvent.click(screen.getByText('Novo convite'));fireEvent.change(screen.getByLabelText('Nome do administrador'),{target:{value:'Ana'}});fireEvent.change(screen.getByLabelText('Email do administrador'),{target:{value:'ana@example.invalid'}});fireEvent.click(screen.getByText('Rever convite'))}
it('reviews only name/email and retries the same uncertain intent',async()=>{
 api.create.mockRejectedValueOnce(Error('lost')).mockResolvedValue({data:record});mount();await review();expect(api.create).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Criar convite'));await screen.findByText('Repetir o mesmo pedido');expect(screen.getByLabelText('Convite para nova entidade')).toBeTruthy();fireEvent.click(screen.getByText('Repetir o mesmo pedido'));await screen.findByText('Preparar conta');expect(api.create.mock.calls[0][0]).toEqual(api.create.mock.calls[1][0]);expect(Object.keys(api.create.mock.calls[0][0]).sort()).toEqual(['email','name','requestId'])
})
it('resumes a saved invitation without exposing an old secret',async()=>{
 api.get.mockResolvedValue({data:{...record,phase:'FILLING'}});render(<MemoryRouter initialEntries={['/?admission=test']}><EntityInvitation api={api}/></MemoryRouter>);await screen.findByText('Ficha em preenchimento');expect(api.get).toHaveBeenCalledWith('test');expect(screen.queryByText('Enviar convite')).toBeNull();expect(screen.queryByLabelText('Ligação para entregar ao administrador')).toBeNull()
})
it('opens an invitation from the list and displays Lisbon dates without secret material',async()=>{
 api.list.mockResolvedValue({data:{page:1,pageSize:25,total:1,items:[{...record,createdBy:'C4G',invitationStatus:'OPEN',expiresAt:'2027-10-18T12:00:00Z'}]}});mount();await screen.findByText('Consultar convite');expect(screen.getAllByText(/Lisboa/).length).toBeGreaterThan(0);fireEvent.click(screen.getByText('Consultar convite'));await screen.findByText('Preparar conta');expect(api.get).toHaveBeenCalledWith('test');expect(screen.queryByLabelText('Ligação para entregar ao administrador')).toBeNull()
})
it('explains that an existing entity link blocks a second entity',async()=>{
 api.create.mockRejectedValue({response:{status:409,data:{error:{code:'MEMBERSHIP_ALREADY_EXISTS'}}}});mount();await review();fireEvent.click(screen.getByText('Criar convite'));await screen.findByText(/já pertence a uma entidade/);expect(screen.queryByText('Repetir o mesmo pedido')).toBeNull()
})

it('returns focus to the invitation opener even when the browser has already blurred it',async()=>{
 mount();const trigger=screen.getByRole('button',{name:'Novo convite'})
 document.activeElement?.blur();fireEvent.click(trigger)
 expect(screen.getByRole('dialog',{name:'Novo convite'})).toBeTruthy()
 fireEvent.keyDown(document.activeElement,{key:'Escape'})
 await waitFor(()=>expect(document.activeElement).toBe(trigger))
})
const ready=()=>{api.get.mockResolvedValue({data:{...record,phase:'READY'}});return render(<MemoryRouter initialEntries={['/?admission=test']}><EntityInvitation api={api}/></MemoryRouter>)}
it('tells the administrator the invitation was emailed and shows no link once the service accepted it',async()=>{
 api.issue.mockResolvedValue({data:{id:'inv',expiresAt:'2027-10-18T12:00:00Z',emailDelivery:{status:'ACCEPTED',recipient:'ana@example.invalid'}}});ready()
 fireEvent.click(await screen.findByRole('button',{name:'Enviar convite'}))
 const sent=await screen.findByText(/^Convite enviado por email para ana@example\.invalid\. A ligação é válida até .*Lisboa/);expect(sent.getAttribute('role')).toBe('status')
 expect(screen.queryByLabelText('Ligação para entregar ao administrador')).toBeNull();expect(api.issue).toHaveBeenCalledWith('test',{requestId:expect.any(String),replace:false})
})
it('shows the link for manual delivery, with the reason, when the email did not leave',async()=>{
 for(const [status,reason] of [['NOT_CONFIGURED','O envio de email não está configurado neste ambiente.'],['UNCONFIRMED','O envio do email não foi confirmado.']]){
  cleanup();api.issue.mockResolvedValue({data:{id:'inv',secret:'ab'.repeat(32),expiresAt:'2027-10-18T12:00:00Z',emailDelivery:{status}}});ready()
  fireEvent.click(await screen.findByRole('button',{name:'Enviar convite'}))
  expect((await screen.findByRole('alert')).textContent).toBe(reason+' Entregue esta ligação ao administrador.')
  expect(screen.getByLabelText('Ligação para entregar ao administrador').value).toBe(window.location.origin+'/api/admission-activation#'+'ab'.repeat(32))
 }
})
it('keeps showing the link where the server sends no email, and asks before resending',async()=>{
 api.issue.mockResolvedValue({data:{id:'inv',secret:'cd'.repeat(32),expiresAt:'2027-10-18T12:00:00Z'}});ready()
 fireEvent.click(await screen.findByRole('button',{name:'Enviar convite'}))
 expect((await screen.findByLabelText('Ligação para entregar ao administrador')).value).toContain('cd'.repeat(32));expect(screen.queryByRole('alert')).toBeNull()
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:'Reenviar convite'}))
 expect(confirm).toHaveBeenCalledWith('Invalidar a ligação anterior e enviar um convite novo?');expect(api.issue).toHaveBeenCalledTimes(1);confirm.mockRestore()
})
it('says the invitation was already issued when a repeated request returns no link',async()=>{
 api.issue.mockResolvedValue({data:{id:'inv',expiresAt:'2027-10-18T12:00:00Z',secretUnavailable:true}});ready()
 fireEvent.click(await screen.findByRole('button',{name:'Enviar convite'}))
 expect(await screen.findByText('O convite já foi emitido. Reenvie-o para invalidar a ligação anterior e enviar outra.')).toBeTruthy()
})
