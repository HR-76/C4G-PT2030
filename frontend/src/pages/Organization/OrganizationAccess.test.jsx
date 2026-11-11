import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import {AccessTable} from './OrganizationAccess'
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>({})}))
vi.mock('../../api/api',()=>({organizationDirectoryApi:vi.fn()}))
afterEach(cleanup)
it.each([[403,'O seu perfil não permite consultar os acessos desta organização.'],[503,'O serviço de acessos está temporariamente indisponível. Tente atualizar a lista.'],[500,'O serviço de acessos está temporariamente indisponível. Tente atualizar a lista.']])('explains access load failure %s accurately',async(status,message)=>{
 const api=apiFor();api.access.mockRejectedValue({response:{status}});
 render(<AccessTable organizationId="a" api={api}/>);
 expect((await screen.findByRole('alert')).textContent).toContain(message);
});
const profiles=[{code:'ORG_ADMIN',label:'Administrador'},{code:'FUNDING_MANAGER',label:'Gestor de candidaturas'},{code:'CONTRIBUTOR',label:'Técnico'}]
const member={membershipId:'member',name:'Ana',email:'ana@example.invalid',profileCode:'CONTRIBUTOR',status:'ACTIVE',revision:4,canChangeStatus:true,profileOptions:profiles}
function apiFor(item=member){return {access:vi.fn().mockResolvedValue({data:{actorMembershipId:'self',items:[item]}}),membershipProfile:vi.fn().mockResolvedValue({}),membershipStatus:vi.fn().mockResolvedValue({})}}
it('requires review before a profile update and sends only its versioned command',async()=>{
 const api=apiFor();render(<AccessTable organizationId="a" api={api}/>);await screen.findByText('Ana');
 expect(screen.queryByText(/O administrador atribui/)).toBeNull();expect(screen.queryByText(/Esta lista gere contas/)).toBeNull();
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'FUNDING_MANAGER'}});fireEvent.click(screen.getByRole('button',{name:'Rever perfil'}));expect(api.membershipProfile).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar alteração',exact:true}));await waitFor(()=>expect(api.membershipProfile).toHaveBeenCalledOnce());
 expect(api.membershipProfile).toHaveBeenCalledWith('member',{profileCode:'FUNDING_MANAGER',expectedRevision:4,idempotencyKey:expect.any(String)});await screen.findByText('Acesso atualizado nesta organização.');
});
it('manager sees only options supplied by the server and cannot change own access',async()=>{
 const api=apiFor({...member,profileOptions:profiles.filter(p=>p.code==='CONTRIBUTOR')});render(<AccessTable organizationId="a" api={api}/>);await screen.findByText('Ana');expect(screen.getAllByRole('option').map(o=>o.value)).toEqual(['CONTRIBUTOR']);
 cleanup();render(<AccessTable organizationId="a" api={apiFor({...member,membershipId:'self',canChangeStatus:false,profileOptions:[]})}/>);await screen.findByText('O seu acesso está protegido.');expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByRole('button',{name:'Suspender acesso'})).toBeNull();
});
it('retries an uncertain status change with exactly the same body',async()=>{
 const api=apiFor();api.membershipStatus.mockRejectedValueOnce(new Error('offline'));render(<AccessTable organizationId="a" api={api}/>);await screen.findByText('Ana');
 fireEvent.click(screen.getByRole('button',{name:'Suspender acesso'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar alteração',exact:true}));await screen.findByRole('button',{name:'Repetir o mesmo envio'});
 const first=api.membershipStatus.mock.calls[0];fireEvent.click(screen.getByRole('button',{name:'Repetir o mesmo envio'}));await screen.findByText('Acesso atualizado nesta organização.');expect(api.membershipStatus.mock.calls[1]).toEqual(first);
});
it('preserves VIEWER until an explicit assignment and allows cancellation',async()=>{
 const api=apiFor({...member,profileCode:'VIEWER'});render(<AccessTable organizationId="a" api={api}/>);await screen.findByText('Ana');expect(screen.getByRole('combobox').value).toBe('VIEWER');
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'CONTRIBUTOR'}});fireEvent.click(screen.getByRole('button',{name:'Rever perfil'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(api.membershipProfile).not.toHaveBeenCalled();
});
it('does not show a late response from the previous organization',async()=>{
 let resolve;const first=apiFor();first.access.mockReturnValue(new Promise(r=>{resolve=r}));const second=apiFor({...member,name:'Outra entidade'});
 const view=render(<AccessTable organizationId="a" api={first}/>);view.rerender(<AccessTable organizationId="b" api={second}/>);await screen.findByText('Outra entidade');resolve({data:{items:[member]}});await waitFor(()=>expect(screen.queryByText('Ana')).toBeNull());
});
it.each([
 ['ACTIVE','Suspender acesso','SUSPENDED','btn-danger','btn-danger-solid'],
 ['SUSPENDED','Reativar acesso','ACTIVE','btn-outline','btn-primary'],
])('distinguishes the %s access transition from cancelling its confirmation',async(status,label,nextStatus,initialClass,confirmClass)=>{
 const api=apiFor({...member,status});render(<AccessTable organizationId="a" api={api}/>);
 const trigger=await screen.findByRole('button',{name:label});expect(trigger.classList.contains(initialClass)).toBe(true);fireEvent.click(trigger);
 expect(screen.getByRole('button',{name:'Confirmar alteração',exact:true}).classList.contains(confirmClass)).toBe(true);
 const cancel=screen.getByRole('button',{name:'Cancelar'});expect(cancel.classList.contains('btn-secondary')).toBe(true);fireEvent.click(cancel);
 expect(api.membershipStatus).not.toHaveBeenCalled();fireEvent.click(trigger);fireEvent.click(screen.getByRole('button',{name:'Confirmar alteração',exact:true}));
 await waitFor(()=>expect(api.membershipStatus).toHaveBeenCalledExactlyOnceWith('member',{status:nextStatus,expectedRevision:4,idempotencyKey:expect.any(String)}));
});
it('reviews a financial grant separately from the profile',async()=>{
 const api=apiFor({...member,canChangeBilling:true,billingRead:false});api.membershipBilling=vi.fn().mockResolvedValue({});render(<AccessTable organizationId="a" api={api}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Dar acesso financeiro a Ana'}));expect(api.membershipBilling).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirmar alteração',exact:true}));await waitFor(()=>expect(api.membershipBilling).toHaveBeenCalledWith('member',{billingRead:true,expectedRevision:4,idempotencyKey:expect.any(String)}));expect(api.membershipProfile).not.toHaveBeenCalled();
});
