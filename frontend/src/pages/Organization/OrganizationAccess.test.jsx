import {afterEach,expect,it,vi} from 'vitest'
import {act,cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import {AccessTable} from './OrganizationAccess'
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>({})}))
vi.mock('../../api/api',()=>({organizationDirectoryApi:vi.fn(),authApi:{stepUpPolicy:vi.fn(),stepUp:vi.fn()}}))
afterEach(cleanup)
afterEach(()=>window.history.replaceState(null,'','/'))
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
it('opens at once with the accesses the shell already confirmed, reads them again and never shows them without a scope',async()=>{
 const {keepConfirmedRead}=await import('../../api/confirmedReads')
 const api=apiFor();api.access.mockResolvedValue({data:{items:[],profiles}})
 render(<AccessTable organizationId="a" api={api} scope="user:a"/>);await waitFor(()=>expect(api.access).toHaveBeenCalledTimes(1));cleanup()
 const held={items:[],profiles,marker:'held'}
 keepConfirmedRead('user:a','organization-access',held)
 api.access.mockReturnValue(new Promise(()=>{}))
 const first=render(<AccessTable organizationId="a" api={api} scope="user:a"/>)
 expect(first.container.textContent).not.toBe('');expect(api.access).toHaveBeenCalledTimes(2);cleanup()
 const second=render(<AccessTable organizationId="a" api={api}/>)
 expect(second.container.querySelector('table')).toBeNull()
})

async function requestStatusChange(){
 fireEvent.click(await screen.findByRole('button',{name:'Suspender acesso'}))
 fireEvent.click(screen.getByRole('button',{name:'Confirmar alteração',exact:true}))
 return screen.findByRole('button',{name:'Confirmar sessão'})
}
function expiredAccess(code='REAUTH_REQUIRED'){
 const api=apiFor()
 api.membershipStatus.mockRejectedValue({response:{status:403,data:{error:{code}}}})
 return api
}
it.each([[true,'REAUTH_REQUIRED','recent-auth'],[false,'MFA_REQUIRED','recent-mfa']])('confirms the configured session policy without repeating the access change (optional MFA: %s)',async(optional,code,category)=>{
 const target='/administracao/entidades/entity-a?tab=acessos#utilizadores'
 window.history.replaceState(null,'',target)
 const api=expiredAccess(code),auth={stepUpPolicy:vi.fn().mockResolvedValue({data:{mfaOptional:optional}}),stepUp:vi.fn()}
 render(<AccessTable organizationId="a" api={api} auth={auth}/>)
 const confirm=await requestStatusChange()
 expect(screen.getByRole('alert').textContent).toContain(optional?'Confirme novamente a sessão':'Confirme novamente a autenticação multifator')
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
 expect(auth.stepUpPolicy).not.toHaveBeenCalled()
 fireEvent.click(confirm)
 await waitFor(()=>expect(auth.stepUp).toHaveBeenCalledExactlyOnceWith(category,target))
 expect(api.membershipStatus).toHaveBeenCalledTimes(1)
 expect(api.membershipProfile).not.toHaveBeenCalled()
})
it.each(['unavailable','missing','invalid'])('lets the user retry session confirmation when its policy is %s',async(failure)=>{
 const api=expiredAccess(),auth={stepUpPolicy:vi.fn(),stepUp:vi.fn()}
 if(failure==='unavailable')auth.stepUpPolicy.mockRejectedValueOnce(Error('offline'))
 else auth.stepUpPolicy.mockResolvedValueOnce({data:failure==='missing'?{}:{mfaOptional:'true'}})
 auth.stepUpPolicy.mockResolvedValueOnce({data:{mfaOptional:true}})
 render(<AccessTable organizationId="a" api={api} auth={auth}/>)
 fireEvent.click(await requestStatusChange())
 await screen.findByText('Não foi possível iniciar a confirmação da sessão. Tente novamente.')
 expect(auth.stepUp).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Confirmar sessão'}))
 await waitFor(()=>expect(auth.stepUp).toHaveBeenCalledExactlyOnceWith('recent-auth','/'))
 expect(api.membershipStatus).toHaveBeenCalledTimes(1)
})
it.each(['resolve','reject'])('ignores a late session-policy %s after changing organization',async(outcome)=>{
 let resolve,reject
 const response=new Promise((yes,no)=>{resolve=yes;reject=no})
 const first=expiredAccess(),second=apiFor({...member,name:'Outra entidade'}),auth={stepUpPolicy:vi.fn().mockReturnValue(response),stepUp:vi.fn()}
 const view=render(<AccessTable organizationId="a" api={first} auth={auth}/>)
 fireEvent.click(await requestStatusChange())
 view.rerender(<AccessTable organizationId="b" api={second} auth={auth}/>)
 await screen.findByText('Outra entidade')
 await act(async()=>{if(outcome==='resolve')resolve({data:{mfaOptional:true}});else reject(Error('offline'));await response.catch(()=>{})})
 expect(auth.stepUp).not.toHaveBeenCalled()
 expect(screen.queryByRole('alert')).toBeNull()
 expect(screen.queryByRole('button',{name:'Confirmar sessão'})).toBeNull()
 expect(second.membershipStatus).not.toHaveBeenCalled()
})
it('ignores session-policy completion after leaving access management',async()=>{
 let resolve
 const response=new Promise(done=>{resolve=done})
 const auth={stepUpPolicy:vi.fn().mockReturnValue(response),stepUp:vi.fn()}
 const view=render(<AccessTable organizationId="a" api={expiredAccess()} auth={auth}/>)
 fireEvent.click(await requestStatusChange());view.unmount()
 await act(async()=>{resolve({data:{mfaOptional:true}});await response})
 expect(auth.stepUp).not.toHaveBeenCalled()
})
it('uses a safe fallback instead of an encoded external return path',async()=>{
 window.history.replaceState(null,'','/%2f%2foutside.invalid')
 const auth={stepUpPolicy:vi.fn().mockResolvedValue({data:{mfaOptional:true}}),stepUp:vi.fn()}
 render(<AccessTable organizationId="a" api={expiredAccess()} auth={auth}/>)
 fireEvent.click(await requestStatusChange())
 await waitFor(()=>expect(auth.stepUp).toHaveBeenCalledExactlyOnceWith('recent-auth','/'))
})
