import {useEffect,useRef,useState} from 'react'
import {useSearchParams} from 'react-router-dom'
import {admissionApi} from '../../api/api'
import FormModal from '../../components/FormModal'
import './entity-users.css'
const phases={IDENTITY:'A preparar a conta',READY:'Convite por aceitar',FILLING:'Ficha em preenchimento',PREPARING:'Entidade em preparação',COMPLETE:'Acesso ativado',CANCELLED:'Convite cancelado'}
const errors={MEMBERSHIP_ALREADY_EXISTS:'Esta conta já pertence a uma entidade. Termine primeiro o vínculo anterior e só depois crie um convite para outra entidade.',IDENTITY_RECONCILIATION_REQUIRED:'Esta conta precisa de verificação pela C4G antes de poder ser associada.'}
const date=value=>value?new Date(value).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon'})+' (Lisboa)':'Não disponível'
export default function EntityInvitation({api=admissionApi}){
 const [params,setParams]=useSearchParams(),id=params.get('admission'),epoch=useRef(0)
 const [form,setForm]=useState(null),[review,setReview]=useState(false),[record,setRecord]=useState(null),[link,setLink]=useState(null),[pending,setPending]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [page,setPage]=useState(1),[list,setList]=useState(null),[listRevision,setListRevision]=useState(0),[listError,setListError]=useState(false)
 const invitationTrigger=useRef(null)
 useEffect(()=>{let current=true;setList(null);setListError(false);api.list(page).then(r=>{if(current)setList(r.data)}).catch(()=>{if(current)setListError(true)});return()=>{current=false}},[api,page,listRevision])
 useEffect(()=>{const current=++epoch.current;setLink(null);setRecord(null);if(id)api.get(id).then(r=>{if(epoch.current===current)setRecord(r.data)}).catch(()=>{if(epoch.current===current)setError('Não foi possível consultar este convite.')});return()=>{epoch.current++}},[id,api])
 async function execute(command){const current=epoch.current;setBusy(true);setError('');setPending(command)
  try{let value
   if(command.kind==='create')value=(await api.create(command.body)).data
   if(command.kind==='resume')value=(await api.resume(command.id)).data
   if(command.kind==='get')value=(await api.get(command.id)).data
   if(command.kind==='cancel'){value=(await api.cancel(command.id)).data;setLink(null)}
   if(command.kind==='issue'){const response=(await api.issue(command.id,command.body)).data;if(current!==epoch.current)return;setLink(response.secret?{url:`${window.location.origin}/api/admission-activation#${response.secret}`,expiresAt:response.expiresAt}:{});value=(await api.get(command.id)).data}
   if(current!==epoch.current)return
   setPending(null);setRecord(value);setForm(null);setListRevision(n=>n+1)
   if(command.kind==='create'){const next=new URLSearchParams(params);next.set('admission',value.id);setParams(next)}
  }catch(e){if(current!==epoch.current)return;const definite=e.response?.status<500;if(definite)setPending(null);setError(errors[e.response?.data?.error?.code]||(definite?'Não foi possível concluir. Confirme o estado do convite e o seu acesso.':'O resultado ficou por confirmar. Repita o mesmo pedido para retomar sem duplicar.'))}finally{if(current===epoch.current)setBusy(false)}
 }
 const locked=busy||Boolean(pending)
 return <section className="entity-users entity-invitations" aria-label="Convite para nova entidade">
  <div className="entity-users-heading"><div><h2>Convidar uma entidade</h2><p>A C4G indica o primeiro administrador. A pessoa completa a ficha portuguesa antes de aceder à nova entidade.</p></div><button ref={invitationTrigger} className="btn btn-primary" disabled={locked||Boolean(form)} onClick={()=>{setForm({name:'',email:'',requestId:crypto.randomUUID()});setReview(false);setLink(null);setRecord(null)}}>Novo convite</button></div>
  {!form&&error&&<p role="alert">{error}</p>}{!form&&busy&&<p role="status">A processar…</p>}
  {!form&&pending&&!busy&&<button className="btn btn-primary" onClick={()=>execute(pending)}>Repetir o mesmo pedido</button>}
  {form&&<FormModal title="Novo convite" locked={locked} step={review} returnFocusRef={invitationTrigger} onClose={()=>setForm(null)}><div className="entity-user-form">
   {error&&<p role="alert">{error}</p>}{busy&&<p role="status">A processar…</p>}
   {pending&&!busy&&<button className="btn btn-primary" onClick={()=>execute(pending)}>Repetir o mesmo pedido</button>}
   <h3>{review?'Rever convite':'Primeiro administrador'}</h3>{!review?<form onSubmit={e=>{e.preventDefault();setReview(true)}}>
   <label>Nome do administrador<input required maxLength={200} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
   <label>Email do administrador<input required type="email" maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
   <div className="entity-user-actions"><button className="btn btn-primary">Rever convite</button><button type="button" className="btn btn-secondary" onClick={()=>setForm(null)}>Cancelar</button></div>
  </form>:<><dl><dt>Nome</dt><dd>{form.name}</dd><dt>Email</dt><dd>{form.email}</dd></dl><p>A ligação será entregue manualmente pela C4G. Não será enviado email. Uma conta existente mantém a password e o histórico, mas só pode ter vínculo a uma entidade.</p><div className="entity-user-actions"><button className="btn btn-primary" disabled={locked} onClick={()=>execute({kind:'create',body:form})}>Criar convite</button><button className="btn btn-outline" disabled={locked} onClick={()=>setReview(false)}>Corrigir dados</button></div></>}</div></FormModal>}
  {record&&<div className="entity-user-form"><h3>{phases[record.phase]||'Preparar convite'}</h3><p>{record.name} — {record.email}</p><p>Criado em {date(record.createdAt)}</p>
   {!['READY','FILLING','PREPARING','COMPLETE','CANCELLED'].includes(record.phase)&&<button className="btn btn-primary" disabled={locked} onClick={()=>execute({kind:'resume',id:record.id})}>Preparar conta</button>}
   {record.phase==='READY'&&<div className="entity-user-actions"><button className="btn btn-primary" disabled={locked} onClick={()=>execute({kind:'issue',id:record.id,body:{requestId:crypto.randomUUID(),replace:false}})}>Emitir ligação temporária</button><button className="btn btn-outline" disabled={locked} onClick={()=>{if(window.confirm('Invalidar a ligação anterior e emitir outra?')){setLink(null);execute({kind:'issue',id:record.id,body:{requestId:crypto.randomUUID(),replace:true}})}}}>Substituir ligação</button></div>}
   {link&&<div className="entity-activation-link">{link.url?<><label>Ligação para entregar ao administrador<input readOnly value={link.url} onFocus={e=>e.target.select()}/></label><p>Apresentada apenas agora. Válida até {date(link.expiresAt)}.</p></>:<p>A ligação já foi emitida. Substitua-a para obter uma nova.</p>}</div>}
   <div className="entity-user-actions"><button className="btn btn-outline" disabled={locked} onClick={()=>execute({kind:'get',id:record.id})}>Verificar estado</button>{!['COMPLETE','CANCELLED'].includes(record.phase)&&<button className="btn btn-danger" disabled={locked} onClick={()=>{if(window.confirm('Cancelar o convite e impedir a ativação desta entidade?'))execute({kind:'cancel',id:record.id})}}>Cancelar convite</button>}</div>
  </div>}
  <section className="entity-activation-list" aria-label="Convites de novas entidades"><div className="invitation-list-heading"><h3>Convites de novas entidades</h3><button className="btn btn-outline" disabled={locked} onClick={()=>setListRevision(n=>n+1)}>Atualizar convites</button></div>
   {listError?<p role="alert">Não foi possível consultar os convites. Tente atualizar.</p>:!list?<p role="status">A consultar convites…</p>:<>
    {!list.items.length?<p>Ainda não existem convites nesta página.</p>:<div className="table-wrap"><table role="table" className="data-table mobile-card-table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Administrador</th><th role="columnheader" scope="col">Criado em / por</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Validade da ligação</th><th role="columnheader" scope="col">Ação</th></tr></thead><tbody role="rowgroup">{list.items.map(item=><tr role="row" key={item.id}>
     <td role="cell" data-label="Administrador"><span><bdi>{item.name}</bdi><small>{item.email}</small></span></td><td role="cell" data-label="Criado em / por"><span>{date(item.createdAt)}<small>{item.createdBy}</small></span></td><td role="cell" data-label="Estado"><span className="invitation-status" data-status={item.phase==='COMPLETE'?'complete':item.phase==='CANCELLED'?'failed':item.phase==='READY'?'ready':'preparing'}>{phases[item.phase]||'Em preparação'}</span></td>
     <td role="cell" data-label="Validade da ligação">{item.invitationStatus==='OPEN'?(new Date(item.expiresAt)>new Date()?'Até ':'Expirada em ')+date(item.expiresAt):item.invitationStatus==='USED'?'Utilizada':item.invitationStatus==='REVOKED'?'Revogada':'Por emitir'}</td>
     <td role="cell" data-label="Ação"><button className="btn btn-outline" disabled={locked||Boolean(form)} onClick={()=>{setLink(null);if(id===item.id)execute({kind:'get',id:item.id});else{const next=new URLSearchParams(params);next.set('admission',item.id);setParams(next)}}}>Consultar convite</button></td>
    </tr>)}</tbody></table></div>}
    <nav className="directory-pagination" aria-label="Paginação dos convites"><button className="btn btn-secondary" disabled={locked||page===1} onClick={()=>setPage(p=>p-1)}>Convites anteriores</button><span>Página {page} · {list.total} {list.total===1?'convite':'convites'}</span><button className="btn btn-secondary" disabled={locked||page*25>=list.total} onClick={()=>setPage(p=>p+1)}>Convites seguintes</button></nav>
   </>}
  </section>
 </section>
}
