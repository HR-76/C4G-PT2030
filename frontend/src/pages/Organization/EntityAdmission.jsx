import LoadingIndicator from '../../components/LoadingIndicator'
import {useEffect,useRef,useState} from 'react'
import {useLocation,Link} from 'react-router-dom'
import {LogOut} from 'lucide-react'
import {useAuth} from '../../contexts/AuthContext'
import {admissionApi} from '../../api/api'
import {RegistrationFields,RegistrationSummary,registrationFields,registrationSteps} from './RegistrationFields'
import AdmissionPreparation from './AdmissionPreparation'

const payload=fields=>Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,key==='workerCount'&&value!==''?Number(value):value]))
const problem=e=>e.response?.status===409?'A ficha foi alterada noutra sessão. Consulte a versão guardada antes de continuar.':e.response?.status===404?'Esta adesão já não está disponível. Contacte a C4G.':e.response?.status===403?'Já não tem acesso a esta ficha.':'Não foi possível confirmar a operação. Os dados que preencheu continuam neste ecrã.'
export default function EntityAdmission({api=admissionApi}){
 const {admissions,logout}=useAuth(),location=useLocation(),id=location.pathname.split('/')[2]||admissions?.items?.[0]?.id
 const [draft,setDraft]=useState(null),[fields,setFields]=useState({}),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[errors,setErrors]=useState({}),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[loaded,setLoaded]=useState(false)
 const alive=useRef(true),mutex=useRef(false),heading=useRef(null),request=useRef(0)
 const [preparation,setPreparation]=useState(null),[submission,setSubmission]=useState(null)
 const dirty=draft&&JSON.stringify(payload(fields))!==JSON.stringify(draft.fields)
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load is read at that moment.
 useEffect(()=>{alive.current=true;setDraft(null);setFields({});setPending(null);setPreparation(null);setSubmission(null);setLoaded(false);load();return()=>{alive.current=false;request.current += 1}},[id])
 useEffect(()=>{const prevent=e=>{if(dirty||pending||submission){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent)},[dirty,pending,submission])
 useEffect(()=>{heading.current?.focus()},[step])
 async function load(){
  if(!id){setLoaded(true);return}
  const generation=++request.current;setError('');
  try{const result=(await api.draft(id)).data;if(!alive.current||generation!==request.current)return;setDraft(result);setFields(result.fields);setErrors({});setPending(null)}catch(e){if(e.response?.status===404&&api.status){try{const result=(await api.status(id)).data;if(alive.current&&generation===request.current&&result.phase!=='FILLING'){setPreparation(result);setError('');return}}catch{}}if(alive.current&&generation===request.current)setError(problem(e))}finally{if(alive.current&&generation===request.current)setLoaded(true)}
 }
 function showErrors(next){setErrors(next);setError('Reveja os campos assinalados.');const key=Object.keys(next)[0],index=registrationFields.findIndex(group=>group.some(field=>field[0]===key));if(index>=0)setStep(index);setTimeout(()=>document.getElementById(`registration-${key}`)?.focus(),0)}
 async function save(exit=false,validate=false){
  if(mutex.current||submission)return;const generation=request.current;mutex.current=true;setBusy(true);setError('');setNotice('')
  try{
   if(validate){const result=(await api.validate(id,{fields:payload(fields),step:null})).data;if(!alive.current||generation!==request.current)return;if(!result.valid){showErrors(result.errors);return}}
   const intent=pending||{fields:payload(fields),expectedRevision:draft.revision,requestId:crypto.randomUUID()};setPending(intent)
   const result=(await api.save(id,intent)).data;if(!alive.current||generation!==request.current)return;
   setDraft(result);setFields(result.fields);setPending(null);setNotice(validate?(result.completionAvailable?'Ficha completa e guardada. Reveja os dados e conclua para preparar o acesso.':'Ficha completa e guardada. A preparação do acesso será disponibilizada no próximo passo.'):'Rascunho guardado.');
   if(exit)await logout()
  }catch(e){if(!alive.current||generation!==request.current)return;if([400,401,403,404,409].includes(e.response?.status))setPending(null);if(e.response?.data?.error?.fields)showErrors(e.response.data.error.fields);else setError(problem(e))}
  finally{mutex.current=false;if(alive.current)setBusy(false)}
 }
 async function next(){
  if(mutex.current||submission)return;const generation=request.current;mutex.current=true;setBusy(true);setError('');setErrors({});
  try{const result=(await api.validate(id,{fields:payload(fields),step})).data;if(!alive.current||generation!==request.current)return;if(!result.valid)showErrors(result.errors);else setStep(old=>old+1)}catch(e){if(alive.current&&generation===request.current)setError(problem(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}
 }
 const change=(key,value)=>{setFields(old=>({...old,[key]:value}));setErrors(old=>({...old,[key]:undefined}));setNotice('')}
 async function submit(){
  if(mutex.current||dirty||pending)return;mutex.current=true;setBusy(true);setError('');const generation=request.current,intent=submission||{expectedRevision:draft.revision,requestId:crypto.randomUUID()};setSubmission(intent)
  try{const result=(await api.submit(id,intent)).data;if(alive.current&&generation===request.current){setPreparation(result);setSubmission(null)}}
  catch(e){if(alive.current&&generation===request.current){if([400,401,403,404,409].includes(e.response?.status))setSubmission(null);if(e.response?.data?.error?.fields)showErrors(e.response.data.error.fields);else {const code=e.response?.data?.error?.code;setError(code==='FISCAL_IDENTITY_REVIEW_REQUIRED'?'A identificação fiscal necessita de verificação pela C4G. Contacte a C4G para continuar.':code==='MEMBERSHIP_ALREADY_EXISTS'?'Esta conta já pertence a uma entidade. O vínculo anterior tem de ser terminado antes de concluir a adesão a outra entidade.':'Não foi possível confirmar a conclusão. Os dados guardados estão preservados.')}}}finally{mutex.current=false;if(alive.current)setBusy(false)}
 }
 return <main className="registration-page">
  <header className="registration-top"><strong>C4G <span>Funding Platform</span></strong>{draft&&!preparation?<button className="btn btn-logout" disabled={busy||Boolean(submission)} onClick={()=>save(true)}><LogOut size={16} aria-hidden="true"/>Guardar e sair</button>:<button className="btn btn-logout" onClick={()=>logout().catch(()=>setError('Não foi possível terminar a sessão.'))}><LogOut size={16} aria-hidden="true"/>Sair</button>}</header>
  <div className="registration-content"><div className="registration-title"><div><h1>Completar ficha da entidade</h1><p>Preencha os dados da entidade para preparar o seu acesso à plataforma.</p></div><span className="registration-status">{preparation?(preparation.canEnter?'Acesso ativo':'Em preparação'):'Por completar'}</span></div>
   <p><Link to="/conta/seguranca" onClick={e=>{if((dirty||pending)&&!window.confirm('Sair sem guardar as alterações?'))e.preventDefault()}}>Segurança da conta</Link></p>
   {error&&<div className="registration-error" role="alert"><strong>{error}</strong>{Object.keys(errors).filter(k=>errors[k]).length>0&&<ul>{Object.entries(errors).filter(([,value])=>value).map(([key,value])=><li key={key}><button className="registration-copy" onClick={()=>{const index=registrationFields.findIndex(g=>g.some(f=>f[0]===key));setStep(index);setTimeout(()=>document.getElementById(`registration-${key}`)?.focus(),0)}}>{registrationFields.flat().find(f=>f[0]===key)?.[1]}: {value}</button></li>)}</ul>}{!pending&&<button className="btn btn-outline" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Substituir os dados neste ecrã pela versão guardada?'))load()}}>Consultar versão guardada</button>}</div>}
   {!loaded?<LoadingIndicator>A carregar a ficha…</LoadingIndicator>:!id?<p>Não existe uma ficha disponível. Contacte a C4G.</p>:preparation?<AdmissionPreparation status={preparation} api={api} onStatus={setPreparation}/>:draft&&<>
    <ol className="registration-steps" aria-label="Passos da ficha">{registrationSteps.map((label,index)=><li key={label} aria-current={step===index?'step':undefined}><span>{index+1}</span>{label}</li>)}</ol>
    <form className="registration-panel" onSubmit={e=>{e.preventDefault();step<3?next():save(false,true)}} noValidate>
     <h2 ref={heading} tabIndex={-1}>{step+1}. {registrationSteps[step]}</h2><p className="registration-help">Os campos assinalados com * são obrigatórios. Pode guardar um rascunho e continuar mais tarde.</p>
     <fieldset disabled={busy||Boolean(pending)||Boolean(submission)}>{step<3?<RegistrationFields step={step} fields={fields} administrator={draft.administrator} types={draft.types} errors={errors} onChange={change}/>:<><RegistrationSummary fields={fields} administrator={draft.administrator} onEdit={setStep}/><p>{draft.completionAvailable?'Guarde e reveja os dados antes de concluir. Ao concluir, a ficha fica fixada e inicia-se a preparação da entidade.':'A ficha pode ser validada e guardada. A conclusão e preparação do acesso ainda não estão disponíveis.'}</p></>}</fieldset>
     {notice&&<p role="status" className="registration-notice">{notice}</p>}
     {pending&&!busy&&<div role="status" className="registration-error"><p>A gravação está por confirmar. Repita o mesmo envio para confirmar o resultado.</p><button type="button" className="btn btn-primary" onClick={()=>save()}>Confirmar gravação</button></div>}
     <footer className="registration-actions"><div><small>{draft.savedAt?`Última gravação confirmada: ${new Date(draft.savedAt).toLocaleString('pt-PT')}`:'Ainda não guardado'}</small>{dirty&&<small>Alterações por guardar</small>}</div><div>
      {step>0&&<button type="button" className="btn btn-secondary" disabled={busy||Boolean(pending)} onClick={()=>setStep(old=>old-1)}>Voltar</button>}
      <button type="button" className="btn btn-outline" disabled={busy||Boolean(pending)} onClick={()=>save()}>Guardar rascunho</button>
      <button className="btn btn-primary" disabled={busy||Boolean(pending)}>{busy?'A verificar…':step<3?'Continuar':'Validar e guardar ficha'}</button>
     </div></footer>
    </form>
    {step===3&&draft.completionAvailable&&<div className="registration-panel"><button type="button" className="btn btn-primary" disabled={busy||dirty||Boolean(pending)||draft.revision<1} onClick={submit}>{submission?'Confirmar conclusão':'Concluir ficha e preparar acesso'}</button>{dirty&&<p>Guarde as alterações antes de concluir.</p>}{submission&&<p>A conclusão está por confirmar. Repita a mesma operação para consultar o resultado.</p>}</div>}
    {!admissions?.limited&&<Link className="registration-back" to="/perfil-organizacao" onClick={e=>{if((dirty||pending)&&!window.confirm('Sair sem guardar as alterações?'))e.preventDefault()}}>Voltar à entidade atual</Link>}
   </>}
  </div>
 </main>
}
