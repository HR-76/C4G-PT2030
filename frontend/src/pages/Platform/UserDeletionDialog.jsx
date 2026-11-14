import {useEffect,useRef,useState} from 'react'
import FormModal from '../../components/FormModal'
const messages={MFA_REQUIRED:'Confirme novamente a autenticação multifator antes de eliminar a conta.',C4G_ADMIN_REQUIRED:'Só o administrador C4G pode eliminar contas.',SELF_ACCESS_PROTECTED:'Não pode eliminar a sua própria conta.',LAST_ADMIN_PROTECTED:'Atribua primeiro outro administrador ativo. Esta conta é o último administrador da plataforma ou de uma entidade.',ONBOARDING_IN_PROGRESS:'A criação desta conta ainda está em curso. Conclua ou reveja a ativação antes de a eliminar.',STALE_REVISION:'A conta foi alterada. Feche esta janela e reveja os dados.',DELETION_CONFLICT:'Já existe outro pedido para esta conta. Feche a janela e consulte novamente a eliminação.',DELETION_HISTORY_REVIEW_REQUIRED:'O acesso está bloqueado, mas há dados históricos de identidade que exigem revisão. A eliminação ainda não está concluída.'}
export default function UserDeletionDialog({user,api,onClose,onCompleted,returnFocusRef}){
 const [state,setState]=useState(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
 const command=useRef(null),active=useRef(true)
 useEffect(()=>{active.current=true;api.userDeletionStatus(user.id).then(r=>{if(!active.current)return;setState(r.data);command.current={requestId:r.data.requestId||crypto.randomUUID(),expectedRevision:r.data.expectedRevision,confirmation:'ELIMINAR'}}).catch(e=>{if(active.current)setError(messages[e.response?.data?.error?.code]||'Não foi possível consultar a conta. Feche a janela e tente novamente.')}).finally(()=>{if(active.current)setBusy(false)});return()=>{active.current=false}},[api,user.id])
 async function remove(){
  setBusy(true);setError('');
  try{const response=await api.deleteUser(user.id,command.current);if(!active.current)return;setState(response.data);setUncertain(false);if(response.data.phase==='COMPLETE')onCompleted()}
  catch(e){if(!active.current)return;setUncertain(!e.response||e.response.status>=500);setError(messages[e.response?.data?.error?.code]||'Não foi possível confirmar a conclusão. O acesso pode já estar bloqueado. Repita o mesmo pedido para retomar a eliminação.')}
  finally{if(active.current)setBusy(false)}
 }
 const complete=state?.phase==='COMPLETE',pending=state&&state.phase!=='NOT_STARTED'&&!complete
 return <FormModal title="Eliminar conta" onClose={onClose} locked={busy} returnFocusRef={returnFocusRef}>
  {error&&<p role="alert">{error}</p>}
  {busy&&<p role="status">A verificar a eliminação…</p>}
  {complete?<p role="status">Conta eliminada. A identidade da conta foi anonimizada e o histórico de trabalho foi preservado.</p>:<>
   <p><strong>{user.name}</strong> · {user.email}</p>
   <p>Esta ação é permanente: retira todos os acessos e elimina a conta de autenticação. As candidaturas, tarefas e o histórico são preservados, com a identidade da conta anonimizada.</p>
   <p>Não elimina automaticamente referências à pessoa em documentos, mensagens ou exportações.</p>
   {pending&&<p>O acesso já foi bloqueado. Falta concluir a eliminação.</p>}
   {state&&<><label>Escreva ELIMINAR para confirmar<input autoComplete="off" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
    <button className="btn btn-danger-solid" disabled={busy||confirmation!=='ELIMINAR'} onClick={remove}>{uncertain?'Repetir o mesmo pedido':pending?'Retomar eliminação':'Eliminar permanentemente'}</button></>}
  </>}
  <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{complete?'Fechar':'Cancelar'}</button>
 </FormModal>
}
