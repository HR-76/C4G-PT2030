import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useAuth} from '../../contexts/AuthContext'

export default function AdmissionPreparation({status,api,onStatus}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),navigate=useNavigate(),auth=useAuth()
 async function refresh(){setBusy(true);setError('');try{onStatus((await api.status(status.admissionId)).data)}catch{setError('Não foi possível confirmar o estado. Tente novamente.')}finally{setBusy(false)}}
 async function enter(){setBusy(true);setError('');try{await auth.refreshSession();await auth.selectOrganization(status.organizationId);navigate('/perfil-organizacao',{replace:true})}catch{setError('Não foi possível abrir a entidade. Atualize o estado para confirmar o acesso.')}finally{setBusy(false)}}
 return <section className="registration-panel" aria-labelledby="preparation-title">
  <h2 id="preparation-title">{status.canEnter?'A entidade está preparada':status.phase==='COMPLETE'?'A ficha está concluída':'Estamos a preparar a entidade'}</h2>
  <p>A ficha foi concluída e a identificação fiscal ficou reservada. Os dados submetidos estão guardados.</p>
  <p>{status.canEnter?'O acesso de administrador está ativo. Pode entrar no perfil da entidade.':status.phase==='COMPLETE'?'O acesso à entidade não está disponível. Contacte a C4G.':'Pode sair e regressar mais tarde. O acesso será disponibilizado depois de concluída a preparação.'}</p>
  {status.errorCode&&<p role="status" className="registration-notice">A preparação ainda não foi confirmada. Os dados estão preservados para retoma.</p>}
  {status.submittedAt&&<p className="registration-help">Ficha concluída em {new Date(status.submittedAt).toLocaleString('pt-PT')}</p>}
  {error&&<p role="alert" className="registration-error">{error}</p>}
  <div className="organization-actions"><button className="btn btn-outline" disabled={busy} onClick={refresh}>Atualizar estado</button>{status.canEnter&&<button className="btn btn-primary" disabled={busy} onClick={enter}>Entrar na entidade</button>}</div>
 </section>
}
