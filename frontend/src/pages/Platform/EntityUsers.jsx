import FormModal from '../../components/FormModal'
import {useEffect,useMemo,useRef,useState} from 'react'
import {UserPlus,ArrowLeft} from 'lucide-react'
import {entityAccessApi} from '../../api/api'
import {AccessTable} from '../Organization/OrganizationAccess'
import './entity-users.css'
const roles={ORG_ADMIN:'Administrador',FUNDING_MANAGER:'Gestor de candidaturas',CONTRIBUTOR:'Técnico'}
const messages={ACTIVATION_INVALID:'A ligação já não está válida. Consulte a ativação e reenvie o email.',PERSON_RECONCILIATION_REQUIRED:'Já existe uma ficha de pessoa com este email. A C4G deve verificar a associação antes de continuar.',MEMBERSHIP_ALREADY_EXISTS:'Esta conta já está associada a uma entidade. Termine primeiro o vínculo anterior para preservar o histórico e só depois crie o novo acesso.',NOT_AUTHORIZED:'O seu perfil já não permite esta ação. Atualize os acessos.',C4G_ADMIN_REQUIRED:'Esta ação requer acesso de administração C4G.',ONBOARDING_CONFLICT:'O pedido já foi utilizado com outros dados. Atualize a lista.',IDENTITY_RECONCILIATION_REQUIRED:'Esta conta precisa de verificação pela C4G antes de poder ser associada.',ONBOARDING_BUSY:'A preparação ainda está a decorrer. Consulte novamente o resultado.',INVITATION_ALREADY_OPEN:'Já existe uma ligação emitida. Pode substituí-la, invalidando a anterior.'}
export default function EntityUsers({organizationId,organizationName,platform=false,api:provided}){
 const api=useMemo(()=>provided||entityAccessApi(organizationId,platform),[provided,organizationId,platform]),epoch=useRef(0)
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(null),[review,setReview]=useState(false),[pending,setPending]=useState(null),[result,setResult]=useState(null),[refresh,setRefresh]=useState(0)
 const addTrigger=useRef(null)
 const Heading=platform?'h2':'h1'
 async function load(generation=epoch.current){try{const r=await api.invitations();if(generation===epoch.current)setData(r.data)}catch(e){if(generation===epoch.current){setData(null);setError(messages[e.response?.data?.error?.code]||'Não foi possível consultar as ativações de utilizadores. Tente atualizar.')}}}
 useEffect(()=>{const generation=++epoch.current;setData(null);setForm(null);setResult(null);setError('');setPending(null);setReview(false);load(generation);return()=>{epoch.current++}},[api])
 async function execute(command){const generation=epoch.current;setBusy(true);setError('');setPending(command);
  try{let value;
   if(command.kind==='create')value=(await api.create(command.body)).data
   if(command.kind==='get')value=(await api.get(command.id)).data
   if(command.kind==='resume')value=(await api.resume(command.id)).data
   if(['create','resume'].includes(command.kind)){for(let step=0;step<2&&!['READY','COMPLETE'].includes(value.phase);step++){if(generation!==epoch.current)return;value=(await api.resume(value.id)).data;}if(generation!==epoch.current)return;setForm(null);setReview(false)}
   if(command.kind==='email'){const delivery=(await api.sendEmail(command.id,command.body)).data;value={...(await api.get(command.id)).data,emailDelivery:delivery}}
   if(command.kind==='revoke'){await api.revoke(command.id,command.invitationId);if(generation!==epoch.current)return;value=(await api.get(command.id)).data}
   if(generation!==epoch.current)return;setResult(value);setPending(null);await load(generation);if(generation===epoch.current)setRefresh(x=>x+1)
  }catch(e){if(generation!==epoch.current)return;const definite=e.response?.status<500;if(definite)setPending(null);setError(messages[e.response?.data?.error?.code]||(definite?'Não foi possível concluir. Atualize a lista e reveja os dados.':'O resultado não foi confirmado. Pode repetir o mesmo pedido; não será criado outro utilizador.'))}
  finally{if(generation===epoch.current)setBusy(false)}
 }
 function start(){setError('');setResult(null);setReview(false);setForm({name:'',email:'',profileCode:'',requestId:crypto.randomUUID()})}
 const locked=busy||Boolean(pending),selectedRole=roles[form?.profileCode]
 return <div className="entity-users">
  <div className="entity-users-heading"><div><p className="member-org-name">{organizationName}</p><Heading>Utilizadores e acessos</Heading><p>Adicione pessoas à entidade e acompanhe as suas ativações.</p></div><button ref={addTrigger} className="btn btn-primary btn-create" disabled={locked||!data?.profileOptions?.length||Boolean(form)} onClick={start}><UserPlus size={17} aria-hidden="true"/> Adicionar utilizador</button></div>
  {!form&&error&&<div role="alert" className="alert alert-error">{error}</div>}
  {!form&&busy&&<p role="status">A processar o pedido…</p>}
  {!form&&pending&&!busy&&<button className="btn btn-primary" onClick={()=>execute(pending)}>Repetir o mesmo pedido</button>}
  {!data&&!busy&&<button className="btn btn-outline" onClick={()=>load()}>Atualizar ativações</button>}
  {form&&<FormModal returnFocusRef={addTrigger} title="Adicionar utilizador" locked={locked} step={review} onClose={()=>{setForm(null);setReview(false)}}><section className="entity-user-form">
   {error&&<div role="alert" className="alert alert-error">{error}</div>}
   {busy&&<p role="status">A processar o pedido…</p>}
   {pending&&!busy&&<button className="btn btn-primary" onClick={()=>execute(pending)}>Repetir o mesmo pedido</button>}
   <h3>{review?'Rever novo acesso':'Novo utilizador'}</h3><p>Entidade: <strong>{organizationName}</strong></p>
   {!review?<form onSubmit={e=>{e.preventDefault();setReview(true)}}>
    <label>Nome<input required maxLength={200} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label>Email<input required type="email" maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
    <label>Perfil<select required value={form.profileCode} onChange={e=>setForm({...form,profileCode:e.target.value})}><option value="">Selecionar perfil</option>{data?.profileOptions.map(p=><option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
    <p className="text-muted">Se a conta já existir, a pessoa mantém a sua password. O novo acesso só fica ativo depois de aceitar a ligação temporária.</p>
    <div className="entity-user-actions"><button className="btn btn-primary">Rever acesso</button><button type="button" className="btn btn-secondary" onClick={()=>setForm(null)}>Cancelar</button></div>
   </form>:<><dl><dt>Nome</dt><dd>{form.name}</dd><dt>Email</dt><dd>{form.email}</dd><dt>Perfil</dt><dd>{selectedRole}</dd></dl>
    {form.profileCode==='CONTRIBUTOR'&&<p>O técnico terá acesso ao catálogo. A participação numa candidatura é atribuída separadamente na respetiva equipa.</p>}
    <p>Será enviado um email com uma ligação de ativação para definir a palavra-passe.</p>
    <div className="entity-user-actions"><button className="btn btn-primary btn-create" disabled={locked} onClick={()=>execute({kind:'create',body:form})}>Criar acesso por ativar</button><button className="btn btn-outline" disabled={locked} onClick={()=>setReview(false)}><ArrowLeft size={16} aria-hidden="true"/>Corrigir dados</button></div></>}
  </section></FormModal>}
  {result&&<section className="entity-user-form" aria-label="Resultado da preparação"><h3>{result.phase==='COMPLETE'?'Acesso ativado':result.phase==='READY'?'Pronto para ativar':'Preparar acesso'}</h3><p><strong>{result.name}</strong> · {result.email} · {roles[result.profileCode]}</p>
   {!['READY','COMPLETE'].includes(result.phase)&&<><p>{result.status==='FAILED'?'A preparação ficou por confirmar. Retome o mesmo registo.':'Falta preparar a conta e a ficha da pessoa antes de emitir a ligação.'}</p><button className="btn btn-primary" disabled={locked} onClick={()=>execute({kind:'resume',id:result.id})}>Continuar preparação</button></>}
   {result.phase==='READY'&&<><p>A pessoa define a sua password no primeiro acesso ou entra com a conta existente. A ligação é de uso único e válida por 24 horas.</p>
    {result.emailDelivery?.status==='ACCEPTED'&&<p role="status">Email de ativação enviado para {result.email}.</p>}
    {result.emailDelivery?.status==='UNCONFIRMED'&&<p role="alert">Não foi possível confirmar o envio do email. Pode reenviar a ligação.</p>}
    {result.emailDelivery?.status==='NOT_CONFIGURED'&&<p role="alert">O envio de email ainda não está configurado. Contacte a administração da plataforma.</p>}
    <button className="btn btn-primary" disabled={locked} onClick={()=>execute({kind:'email',id:result.id,body:{requestId:crypto.randomUUID(),replace:true}})}>Reenviar email de ativação</button>
    <p className="text-muted">O reenvio invalida a ligação anterior.</p></>}
   {result.phase==='READY'&&result.invitations?.filter(i=>i.status==='OPEN').map(i=><div key={i.id}><p>Ligação emitida: {new Date(i.expiresAt)>new Date()?'válida até':'expirada em'} {new Date(i.expiresAt).toLocaleString('pt-PT')}.</p><button className="btn btn-danger" disabled={locked} onClick={()=>execute({kind:'revoke',id:result.id,invitationId:i.id})}>Revogar ligação</button></div>)}
   <button className="btn btn-outline" disabled={locked} onClick={()=>execute({kind:'get',id:result.id})}>Verificar ativação</button>
  </section>}
  <AccessTable key={`${organizationId}:${refresh}`} organizationId={organizationId} api={api}/>
  {data?.items.length>0&&<section className="entity-activation-list"><h3>Ativações de utilizadores</h3><div className="table-wrap"><table role="table" className="data-table mobile-card-table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Pessoa</th><th role="columnheader" scope="col">Perfil</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Ação</th></tr></thead><tbody role="rowgroup">{data.items.map(item=><tr role="row" key={item.id}><td role="cell" data-label="Pessoa"><span>{item.name}<small>{item.email}</small></span></td><td role="cell" data-label="Perfil">{roles[item.profileCode]}</td><td role="cell" data-label="Estado"><span className="invitation-status" data-status={item.phase==='COMPLETE'?'complete':item.status==='FAILED'?'failed':item.phase==='READY'?'ready':'preparing'}>{item.phase==='COMPLETE'?'Ativado':item.phase==='READY'?'Por ativar':item.status==='FAILED'?'Preparação por confirmar':'Em preparação'}</span></td><td role="cell" data-label="Ação"><button className="btn btn-outline" disabled={locked||Boolean(form)} onClick={()=>{execute({kind:'get',id:item.id})}}>Consultar ativação</button></td></tr>)}</tbody></table></div></section>}

 </div>
}
