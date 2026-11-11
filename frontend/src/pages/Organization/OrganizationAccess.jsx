import {useEffect,useMemo,useRef,useState} from 'react'
import {useAuth} from '../../contexts/AuthContext'
import {organizationDirectoryApi} from '../../api/api'
import FormModal from '../../components/FormModal'
import './organization-access.css'
import EntityUsers from '../Platform/EntityUsers'
const labels={ORG_ADMIN:'Administrador',FUNDING_MANAGER:'Gestor de candidaturas',CONTRIBUTOR:'Técnico',VIEWER:'Consulta (perfil existente)'}
const messages={MFA_REQUIRED:'Confirme novamente a autenticação multifator antes de alterar este acesso.',SELF_ACCESS_PROTECTED:'O seu próprio acesso está protegido. Peça a outro administrador para o alterar.',STALE_REVISION:'Este acesso foi alterado entretanto. Atualize a lista e reveja a alteração.',NOT_AUTHORIZED:'O seu perfil não permite alterar este acesso.',CONTEXT_CHANGED:'A organização mudou. Atualize a lista.',MEMBERSHIP_UNAVAILABLE:'Este acesso já não está disponível para alteração.'}
export default function OrganizationAccess(){
 const {user,organization}=useAuth()
 if(!organization)return <p>Esta conta não tem uma entidade associada para consultar acessos.</p>
 return <EntityUsers key={`${user.id}:${organization.id}`} organizationId={organization.id} organizationName={organization.name||organization.displayName||'Organização selecionada'}/>
}
export function AccessTable({organizationId,api:providedApi}){
 const api=useMemo(()=>providedApi||organizationDirectoryApi(organizationId),[providedApi,organizationId]),generation=useRef(0)
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[review,setReview]=useState(null),[selected,setSelected]=useState({})
 const reviewTrigger=useRef(null)
 async function load(epoch=generation.current){setBusy(true);setError('');try{const r=await api.access();if(epoch===generation.current){setData(r.data);setSelected({})}}catch(e){if(epoch===generation.current){setData(null);setError(e.response?.status===403?'O seu perfil não permite consultar os acessos desta organização.':e.response?.status===409?'A organização ou a sessão mudou. Atualize a lista.':'O serviço de acessos está temporariamente indisponível. Tente atualizar a lista.')}}finally{if(epoch===generation.current)setBusy(false)}}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load is read at that moment.
 useEffect(()=>{const epoch=++generation.current;setData(null);setPending(null);setReview(null);setSelected({});setNotice('');load(epoch);return()=>{generation.current += 1}},[api])
 async function send(command){const epoch=generation.current;setBusy(true);setPending(command);setReview(null);setError('');setNotice('');try{
  await (command.kind==='billing'?api.membershipBilling:command.kind==='profile'?api.membershipProfile:api.membershipStatus)(command.id,command.body)
  if(epoch!==generation.current)return
  setPending(null);await load(epoch);if(epoch===generation.current)setNotice('Acesso atualizado nesta organização.')
 }catch(e){if(epoch===generation.current){const definite=e.response?.status<500;if(definite)setPending(null);setError(messages[e.response?.data?.error?.code]||(definite?'Não foi possível alterar o acesso. Atualize a lista e verifique a sua autorização.':'A resposta não foi confirmada. Pode repetir o mesmo envio em segurança.'))}}finally{if(epoch===generation.current)setBusy(false)}}
 function prepare(m,kind,trigger){reviewTrigger.current=trigger;const value=kind==='billing'?!m.billingRead:kind==='profile'?selected[m.membershipId]:(m.status==='ACTIVE'?'SUSPENDED':'ACTIVE');setReview({id:m.membershipId,name:m.name,kind,value,body:{[kind==='billing'?'billingRead':kind==='profile'?'profileCode':'status']:value,expectedRevision:Number(m.revision),idempotencyKey:crypto.randomUUID()}});setNotice('');setError('')}
 const locked=busy||Boolean(pending)||Boolean(review)
 return <section className="member-access"><div className="member-access-heading"><h2>Acessos da organização</h2>{data && <span>{data.items.length} {data.items.length===1?"membro":"membros"}</span>}</div>
  {error&&<div role="alert" className="alert alert-error">{error} <button disabled={busy} onClick={()=>load()}>Atualizar lista</button></div>}
  {notice&&<p role="status">{notice}</p>}{busy&&<p role="status">A consultar ou atualizar acessos…</p>}
  {pending&&!busy&&<button className="btn btn-primary" onClick={()=>send(pending)}>Repetir o mesmo envio</button>}
  {review&&<FormModal title="Confirmar alteração de acesso" onClose={()=>setReview(null)} returnFocusRef={reviewTrigger}><div className="access-review">
   <p><strong>{review.name}</strong>: {review.kind==='billing'?(review.value?'permitir consulta de faturas e pagamentos':'retirar consulta de faturas e pagamentos'):review.kind==='profile'?`atribuir ${labels[review.value]}`:review.value==='SUSPENDED'?'suspender acesso':'reativar acesso'}.</p>
   {review.kind==='profile'&&<p>As permissões gerais passam a ser as deste perfil. As concessões específicas de trabalho são preservadas. A pessoa poderá ter de selecionar novamente a organização.</p>}
   <button className={`btn ${review.kind==='status'&&review.value==='SUSPENDED'?'btn-danger-solid':'btn-primary'}`} disabled={busy} onClick={()=>send(review)}>Confirmar alteração</button>{' '}<button className="btn btn-secondary" disabled={busy} onClick={()=>setReview(null)}>Cancelar</button>
  </div></FormModal>}
  {data&&<div className="table-wrap" role="region" aria-label="Tabela de acessos" tabIndex={0}><table role="table" className="data-table mobile-card-table access-table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Nome</th><th role="columnheader" scope="col">Email</th><th role="columnheader" scope="col">Perfil</th><th role="columnheader" scope="col">Acesso</th><th role="columnheader" scope="col">Faturação</th><th role="columnheader" scope="col">Ações</th></tr></thead><tbody role="rowgroup">{data.items.map(m=><tr role="row" key={m.membershipId}>
   <td role="cell" data-label="Nome" className="td-notrunc"><span>{m.name}{m.membershipId===data.actorMembershipId&&<small> (a sua conta)</small>}</span></td><td role="cell" data-label="Email" className="td-notrunc"><span>{m.email}</span></td>
   <td role="cell" data-label="Perfil"><span className="member-profile">{labels[m.profileCode]||m.profileCode}</span></td>
   <td role="cell" data-label="Acesso"><span className="member-state" data-state={m.status}>{m.status==='ACTIVE'?'Ativo':m.status==='SUSPENDED'?'Suspenso':m.status}</span></td>
   <td role="cell" data-label="Faturação"><span>{m.profileCode==='ORG_ADMIN'?'Incluído no perfil':m.billingRead?'Consulta autorizada':'Sem acesso'}</span>{m.canChangeBilling&&<button className="btn btn-outline" disabled={locked} onClick={e=>prepare(m,'billing',e.currentTarget)} aria-label={`${m.billingRead?'Retirar':'Dar'} acesso financeiro a ${m.name}`}>{m.billingRead?'Retirar acesso financeiro':'Dar acesso financeiro'}</button>}</td>
   <td role="cell" data-label="Ações" className="td-notrunc"><div className="access-actions">
    {m.profileOptions?.length>0&&<><label>Novo perfil<select aria-label={`Novo perfil de ${m.name}`} value={selected[m.membershipId]||m.profileCode} disabled={locked} onChange={e=>setSelected(s=>({...s,[m.membershipId]:e.target.value}))}>
      {!m.profileOptions.some(p=>p.code===m.profileCode)&&<option value={m.profileCode}>{labels[m.profileCode]||m.profileCode}</option>}
      {m.profileOptions.map(p=><option key={p.code} value={p.code}>{p.label}</option>)}
    </select></label><button className="btn btn-outline" disabled={locked||!selected[m.membershipId]||selected[m.membershipId]===m.profileCode} onClick={e=>prepare(m,'profile',e.currentTarget)}>Rever perfil</button></>}
    {m.canChangeStatus&&<button className={`btn ${m.status==='ACTIVE'?'btn-danger':'btn-outline'}`} disabled={locked} onClick={e=>prepare(m,'status',e.currentTarget)}>{m.status==='ACTIVE'?'Suspender acesso':'Reativar acesso'}</button>}
    {m.membershipId===data.actorMembershipId?<small>O seu acesso está protegido.</small>:!m.profileOptions?.length&&!m.canChangeStatus&&<small>Apenas consulta</small>}
   </div></td></tr>)}</tbody></table>{data.items.length===0&&<p>Sem contas associadas disponíveis.</p>}</div>}
 </section>
}
