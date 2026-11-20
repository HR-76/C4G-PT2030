import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import UserDeletionDialog from './UserDeletionDialog'
afterEach(cleanup)
const user={id:'synthetic',name:'Pessoa de teste',email:'synthetic@example.invalid'}
function fixture(){const api={userDeletionStatus:vi.fn().mockResolvedValue({data:{phase:'NOT_STARTED',expectedRevision:2}}),deleteUser:vi.fn().mockResolvedValue({data:{phase:'COMPLETE'}})},onCompleted=vi.fn();render(<UserDeletionDialog user={user} api={api} onClose={()=>{}} onCompleted={onCompleted}/>);return {api,onCompleted}}
it('requires explicit typed confirmation before a permanent deletion',async()=>{
 const {api,onCompleted}=fixture();const button=await screen.findByRole('button',{name:'Eliminar permanentemente'});
 expect(button.disabled).toBe(true);expect(api.deleteUser).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Escreva ELIMINAR para confirmar'),{target:{value:'ELIMINAR'}});fireEvent.click(button);
 await screen.findByText(/Conta eliminada/);expect(onCompleted).toHaveBeenCalledTimes(1);
 expect(api.deleteUser).toHaveBeenCalledWith(user.id,{requestId:expect.any(String),expectedRevision:2,confirmation:'ELIMINAR'});
 expect(screen.queryByRole('button',{name:'Eliminar permanentemente'})).toBeNull();
});
it('reuses exactly the original command after an uncertain response',async()=>{
 const {api}=fixture();api.deleteUser.mockRejectedValueOnce({response:{status:503}});
 const button=await screen.findByRole('button',{name:'Eliminar permanentemente'});
 fireEvent.change(screen.getByLabelText('Escreva ELIMINAR para confirmar'),{target:{value:'ELIMINAR'}});fireEvent.click(button);
 const retry=await screen.findByRole('button',{name:'Repetir o mesmo pedido'});expect(screen.queryByText(/Conta eliminada/)).toBeNull();fireEvent.click(retry);
 await waitFor(()=>expect(api.deleteUser).toHaveBeenCalledTimes(2));expect(api.deleteUser.mock.calls[1]).toEqual(api.deleteUser.mock.calls[0]);
});

it.each([[true,'recent-auth'],[false,'recent-mfa']])('offers session confirmation using the configured policy (optional MFA: %s)',async(optional,category)=>{
 const api={userDeletionStatus:vi.fn().mockRejectedValue({response:{status:403,data:{error:{code:optional?'REAUTH_REQUIRED':'MFA_REQUIRED'}}}}),deleteUser:vi.fn()};
 const auth={stepUpPolicy:vi.fn().mockResolvedValue({data:{mfaOptional:optional}}),stepUp:vi.fn()};
 render(<UserDeletionDialog user={user} api={api} auth={auth} onClose={()=>{}} onCompleted={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Confirmar sessão'}));
 await waitFor(()=>expect(auth.stepUp).toHaveBeenCalledWith(category,'/administracao/entidades/utilizadores'));
 expect(api.deleteUser).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:'Eliminar permanentemente'})).toBeNull();
});
