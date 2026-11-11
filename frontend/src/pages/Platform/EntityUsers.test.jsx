import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor,act} from '@testing-library/react'
import EntityUsers from './EntityUsers'
afterEach(cleanup)
it('opens an accessible modal and restores focus after Escape',async()=>{
 const client=api();render(<EntityUsers organizationId="org-a" organizationName="Entidade A" api={client}/>);
 const trigger=screen.getByRole('button',{name:'Adicionar utilizador'});
 await waitFor(()=>expect(trigger.disabled).toBe(false));trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'Adicionar utilizador'})).toBeTruthy();
 expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
 fireEvent.keyDown(document.activeElement,{key:'Escape'});
 expect(screen.queryByRole('dialog')).toBeNull();
 await waitFor(()=>expect(document.activeElement).toBe(trigger));
 expect(client.create).not.toHaveBeenCalled();
});
it('keeps uncertain submission feedback and retry inside the modal',async()=>{
 const client=api();client.create.mockRejectedValueOnce({});await prepare(client);
 fireEvent.click(screen.getByRole('button',{name:'Criar acesso por ativar'}));
 const retry=await screen.findByRole('button',{name:'Repetir o mesmo pedido'});
 const dialog=screen.getByRole('dialog');expect(dialog.contains(retry)).toBe(true);
 expect(dialog.contains(screen.getByRole('alert'))).toBe(true);
 fireEvent.keyDown(document.activeElement,{key:'Escape'});expect(screen.getByRole('dialog')).toBe(dialog);
 expect(screen.getByRole('button',{name:'Corrigir dados'}).disabled).toBe(true);
 fireEvent.click(retry);await screen.findByRole('heading',{name:'Pronto para ativar'});
 expect(screen.queryByRole('dialog')).toBeNull();
});
const roles=[{code:'ORG_ADMIN',label:'Administrador'},{code:'FUNDING_MANAGER',label:'Gestor de candidaturas'},{code:'CONTRIBUTOR',label:'Técnico'}]
const op={id:'operation',name:'Pessoa nova',email:'nova@example.invalid',profileCode:'CONTRIBUTOR',phase:'READY'}
function api(options=roles){return {invitations:vi.fn().mockResolvedValue({data:{items:[],profileOptions:options}}),access:vi.fn().mockResolvedValue({data:{items:[]}}),create:vi.fn().mockResolvedValue({data:{...op,phase:'IDENTITY'}}),resume:vi.fn().mockResolvedValue({data:op}),sendEmail:vi.fn().mockResolvedValue({data:{status:'ACCEPTED'}}),get:vi.fn().mockResolvedValue({data:op}),issue:vi.fn().mockResolvedValue({data:{id:'invite',status:'OPEN',secret:'a'.repeat(64),expiresAt:'2027-01-01'}}),revoke:vi.fn().mockResolvedValue({data:{status:'REVOKED'}})}}
async function prepare(client){render(<EntityUsers organizationId="org-a" organizationName="Entidade A" api={client}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Adicionar utilizador'}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Adicionar utilizador'}));fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Pessoa nova'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'nova@example.invalid'}});fireEvent.change(screen.getByLabelText('Perfil'),{target:{value:'CONTRIBUTOR'}});fireEvent.click(screen.getByRole('button',{name:'Rever acesso'}));}
it('reviews destination and profile before requesting automatic activation email',async()=>{const client=api();await prepare(client);expect(client.create).not.toHaveBeenCalled();expect(screen.getByText(/participação numa candidatura/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Criar acesso por ativar'}));await screen.findByRole('heading',{name:'Pronto para ativar'});expect(client.create).toHaveBeenCalledWith(expect.objectContaining({name:'Pessoa nova',email:'nova@example.invalid',profileCode:'CONTRIBUTOR'}));expect(client.issue).not.toHaveBeenCalled();});
it('manager can select only the server supplied technician profile',async()=>{const client=api(roles.slice(2));await prepare(client);expect(screen.queryByText(/os perfis e as alterações/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Corrigir dados'}));expect(screen.queryByRole('option',{name:'Administrador'})).toBeNull();expect(screen.getByRole('option',{name:'Técnico'})).toBeTruthy();});
it('reuses the original request after an uncertain response',async()=>{const client=api();client.create.mockRejectedValueOnce({});await prepare(client);fireEvent.click(screen.getByRole('button',{name:'Criar acesso por ativar'}));await screen.findByRole('button',{name:'Repetir o mesmo pedido'});const original=client.create.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'Repetir o mesmo pedido'}));await screen.findByRole('heading',{name:'Pronto para ativar'});expect(client.create.mock.calls[1][0]).toBe(original);});
it('resends activation email and reports acceptance without exposing a link',async()=>{
 const client=api();await prepare(client);
 fireEvent.click(screen.getByRole('button',{name:'Criar acesso por ativar'}));
 await screen.findByRole('heading',{name:'Pronto para ativar'});
 fireEvent.click(screen.getByRole('button',{name:'Reenviar email de ativação'}));
 expect(await screen.findByText('Email de ativação enviado para nova@example.invalid.')).toBeTruthy();
 expect(client.sendEmail).toHaveBeenCalledWith('operation',{requestId:expect.any(String),replace:true});
 expect(screen.queryByLabelText('Ligação para entregar à pessoa')).toBeNull();
});
it('shows unconfirmed email and permits explicit resend',async()=>{
 const client=api();client.create.mockResolvedValue({data:{...op,emailDelivery:{status:'UNCONFIRMED'}}});
 await prepare(client);fireEvent.click(screen.getByRole('button',{name:'Criar acesso por ativar'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','Não foi possível confirmar o envio do email. Pode reenviar a ligação.');
 expect(screen.getByRole('button',{name:'Reenviar email de ativação'}).disabled).toBe(false);
});
it('retries an uncertain resend with the same request identifier',async()=>{
 const client=api();client.sendEmail.mockRejectedValueOnce({});
 await prepare(client);fireEvent.click(screen.getByRole('button',{name:'Criar acesso por ativar'}));
 await screen.findByRole('heading',{name:'Pronto para ativar'});
 fireEvent.click(screen.getByRole('button',{name:'Reenviar email de ativação'}));
 fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo pedido'}));
 await screen.findByText('Email de ativação enviado para nova@example.invalid.');
 expect(client.sendEmail.mock.calls[1]).toEqual(client.sendEmail.mock.calls[0]);
});
it('does not retain the previous entity result when changed',async()=>{const a=api(),b=api();let resolve;a.invitations.mockReturnValue(new Promise(r=>{resolve=r}));const view=render(<EntityUsers organizationId="a" organizationName="Entidade A" api={a}/>);view.rerender(<EntityUsers organizationId="b" organizationName="Entidade B" api={b}/>);await waitFor(()=>expect(b.invitations).toHaveBeenCalled());await act(async()=>resolve({data:{items:[op],profileOptions:roles}}));expect(screen.queryByText('Pessoa nova')).toBeNull();});
