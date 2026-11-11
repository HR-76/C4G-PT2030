import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import LoadingIndicator from '../../components/LoadingIndicator'
import {useEffect,useRef,useState} from 'react'
import {Link,useLocation,useParams,useSearchParams} from 'react-router-dom'
import {RefreshCw,ArrowLeft,Building2,Users} from 'lucide-react'
import {platformDirectoryApi} from '../../api/api'
import {useAuth} from '../../contexts/AuthContext'
import './platform-directory.css'
import './directory-workspace.css'
import EntityUsers from './EntityUsers'
import EntityInvitation from './EntityInvitation'
import EntityProfileCard from '../Organization/EntityProfileCard'

const root='/administracao/entidades'
const states={ACTIVE:'Ativo',SUSPENDED:'Suspenso',ARCHIVED:'Arquivado',PROVISIONING:'Em preparação',TERMINATING:'Em encerramento',PENDING_PROJECTION:'Por ativar',REMOVED:'Removido'}
const roles={ORG_ADMIN:'Administrador',FUNDING_MANAGER:'Gestor de candidaturas',CONTRIBUTOR:'Técnico',VIEWER:'Consulta',C4G_ADMIN:'Administrador C4G',SUPPORT:'Suporte C4G'}
const types={UNSPECIFIED:'Não indicado',COMPANY:'Empresa',RESEARCH:'Investigação',UNIVERSITY:'Universidade',PUBLIC_BODY:'Entidade pública',ASSOCIATION:'Associação'}
const status=value=><span className={`directory-status directory-status-${value?.toLowerCase()}`}>{states[value]||value}</span>
const errors={C4G_ADMIN_REQUIRED:'Esta área está reservada à administração C4G. O seu acesso pode ter sido alterado.',RESOURCE_NOT_AVAILABLE:'A entidade não está disponível.',INVALID_INPUT:'Os filtros do endereço não são válidos. Limpe os filtros para voltar à lista.'}

export default function PlatformDirectory(){const {user,admissions}=useAuth();return <DirectoryView key={user?.id} enableInvitations={Boolean(admissions)}/>}
export function DirectoryView({api=platformDirectoryApi,enableInvitations=false}){
 const location=useLocation(),{entityId}=useParams(),[params,setParams]=useSearchParams()
 const users=location.pathname.endsWith('/utilizadores')||Boolean(entityId),key=location.pathname+'?'+params.toString(),generation=useRef(0)
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(true),[revision,setRevision]=useState(0)
 const [q,setQ]=useState(params.get('q')||''),[state,setState]=useState(params.get('status')||'')
 const data=snapshot?.key===key?snapshot:null,visibleError=error?.key===key?error.message:null
 useEffect(()=>{setQ(params.get('q')||'');setState(params.get('status')||'')},[key])
 useEffect(()=>{
  const epoch=++generation.current,controller=new AbortController();setSnapshot(null);setError(null);setBusy(true)
  const input=Object.fromEntries(params);delete input.admission;if(entityId)input.organizationId=entityId
   Promise.all([users?api.users(input,controller.signal):api.entities(input,controller.signal),entityId?api.entity(entityId,controller.signal):Promise.resolve(null),entityId?api.entityProfile(entityId,controller.signal):Promise.resolve(null)])
    .then(([list,entity,profile])=>{if(epoch===generation.current)setSnapshot({key,list:list.data,entity:entity?.data,profile:profile?.data?.registration})})
   .catch(e=>{if(epoch===generation.current)setError({key,message:errors[e.response?.data?.error?.code]||'Não foi possível consultar os registos. Tente atualizar a lista.'})})
   .finally(()=>{if(epoch===generation.current)setBusy(false)})
  return()=>{generation.current++;controller.abort()}
 },[key,revision,api])
 const filter=e=>{e.preventDefault();setParams({...(q.trim()?{q:q.trim()}:{}),...(state?{status:state}:{})})}
 const page=direction=>{const next=new URLSearchParams(params);next.set('page',String(data.list.page+direction));setParams(next)}
 return <div className={`page platform-directory${entityId?'':' directory-workspace'}`}>
  {entityId&&<Link to={root} className="directory-back"><ArrowLeft size={16} aria-hidden="true"/>Voltar às entidades</Link>}
  <div className="directory-heading"><div><h1>{entityId?(data?.entity?.name||'Ficha da entidade'):'Entidades e utilizadores'}</h1></div>
   <button className="btn btn-outline" disabled={busy} onClick={()=>setRevision(r=>r+1)}><RefreshCw size={16} aria-hidden="true"/> Atualizar</button>
  </div>
  {!entityId&&<nav className="directory-tabs" aria-label="Entidades e utilizadores"><Link to={root} aria-current={!users?'page':undefined}><Building2 size={18} aria-hidden="true"/>Entidades</Link><Link to={root+'/utilizadores'} aria-current={users?'page':undefined}><Users size={18} aria-hidden="true"/>Utilizadores</Link></nav>}
  {!entityId&&<p className="directory-availability">Abra a ficha de uma entidade para adicionar utilizadores e gerir os seus acessos.</p>}
  {enableInvitations&&!entityId&&!users&&data&&<EntityInvitation/>}
  {data?.entity&&<section className="directory-identity" aria-label="Dados da entidade"><dl>
   <div><dt>Denominação legal</dt><dd>{data.entity.legalName}</dd></div><div><dt>Estado da entidade</dt><dd>{status(data.entity.status)}</dd></div>
   <div><dt>Tipo</dt><dd>{types[data.entity.typeCode]||data.entity.typeCode}</dd></div><div><dt>Moeda de reporting</dt><dd>{data.entity.currency}</dd></div>
   <div><dt>Acessos ativos</dt><dd>{data.entity.activeAccounts}</dd></div><div><dt>Registada em</dt><dd>{new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(data.entity.createdAt))}</dd></div>
  </dl></section>}
   {entityId&&data?.entity&&<><EntityProfileCard profile={data.profile} organization={data.entity} canEdit onSave={async body=>(await api.saveEntityProfile(entityId,body)).data}/><EntityUsers key={entityId} organizationId={entityId} organizationName={data.entity.name} platform/></>}
  <div className={!entityId?'directory-register':undefined}>
  {!entityId&&<div className="directory-register-heading"><h2>{users?'Utilizadores registados':'Entidades registadas'}</h2><p>{users?'Consulte contas e respetivos acessos.':'Consulte as entidades e os seus acessos ativos.'}</p></div>}
  {!entityId&&<FilterBar as="form" variant="integrated" className="directory-filters" onSubmit={filter}>
   <label className="filter-search">Pesquisar<SearchInput value={q} maxLength={150} onChange={e=>setQ(e.target.value)} placeholder={users?'Nome ou email':'Nome ou identificador da entidade'}/></label>
   <label>{users?'Estado da conta':'Estado da entidade'}<select value={state} onChange={e=>setState(e.target.value)}><option value="">Todos</option>
    {(users?['ACTIVE','SUSPENDED','ARCHIVED']:['ACTIVE','PROVISIONING','SUSPENDED','TERMINATING','ARCHIVED']).map(s=><option key={s} value={s}>{states[s]}</option>)}</select></label>
   <button type="submit" className="btn btn-primary">Aplicar filtros</button><button type="button" className="btn btn-secondary" onClick={()=>{setQ('');setState('');setParams({})}}>Limpar filtros</button>
  </FilterBar>}
  {busy&&<LoadingIndicator>A consultar {users?'utilizadores':'entidades'}…</LoadingIndicator>}
  {visibleError&&<div role="alert" className="alert alert-error">{visibleError} <button className="btn btn-outline" onClick={()=>setRevision(r=>r+1)}>Tentar novamente</button></div>}
  {data&&!entityId&&<>
   <p className="directory-result" role="status">{data.list.total} {users?(data.list.total===1?'utilizador encontrado':'utilizadores encontrados'):(data.list.total===1?'entidade encontrada':'entidades encontradas')}</p>
   {data.list.items.length===0?<div className="directory-empty"><h2>Sem resultados</h2><p>{params.size?'Altere a pesquisa ou limpe os filtros.':users?'Ainda não existem contas nesta lista.':'Ainda não existem entidades registadas.'}</p></div>:
    users?<UsersTable items={data.list.items}/>:<EntitiesTable items={data.list.items}/>}
   <nav className="directory-pagination" aria-label="Paginação"><button className="btn btn-secondary" disabled={data.list.page<=1} onClick={()=>page(-1)}>Anterior</button>
    <span>Página {data.list.page}{data.list.total>0?` de ${Math.ceil(data.list.total/data.list.pageSize)}`:''}</span>
    <button className="btn btn-secondary" disabled={data.list.page*data.list.pageSize>=data.list.total} onClick={()=>page(1)}>Seguinte</button></nav>
  </>}
  </div>
 </div>
}
function EntitiesTable({items}){return <div className="table-wrap"><table role="table" className="data-table mobile-card-table directory-table"><caption className="sr-only">Entidades registadas</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Entidade</th><th role="columnheader" scope="col">Administradores ativos</th><th role="columnheader" scope="col">Acessos ativos</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Ação</th></tr></thead><tbody role="rowgroup">{items.map(o=><tr role="row" key={o.id}>
 <td role="cell" data-label="Entidade"><div><strong>{o.name}</strong><small>{o.legalName!==o.name?o.legalName:o.slug}</small></div></td>
 <td role="cell" data-label="Administradores ativos"><div>{o.administrators.length?o.administrators.map(a=><div key={a.email}>{a.name}<small>{a.email}</small></div>):<span className="text-muted">Sem administrador ativo</span>}{o.administrators.length===10&&<small>Até 10 nesta lista. Consulte a ficha.</small>}</div></td>
 <td role="cell" data-label="Acessos ativos">{o.activeAccounts}</td><td role="cell" data-label="Estado">{status(o.status)}</td><td role="cell" data-label="Ação"><Link className="btn btn-outline" to={root+'/'+o.id} aria-label={`Consultar ${o.name}`}>Consultar</Link></td>
 </tr>)}</tbody></table></div>}
function UsersTable({items}){return <div className="table-wrap"><table role="table" className="data-table mobile-card-table directory-table"><caption className="sr-only">Contas e acessos</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Utilizador</th><th role="columnheader" scope="col">Estado da conta</th><th role="columnheader" scope="col">Acesso à plataforma</th><th role="columnheader" scope="col">Entidades e perfis</th></tr></thead><tbody role="rowgroup">{items.map(u=><tr role="row" key={u.id}>
 <td role="cell" data-label="Utilizador"><div><strong>{u.name}</strong><small>{u.email}</small></div></td><td role="cell" data-label="Estado da conta">{status(u.status)}</td>
 <td role="cell" data-label="Acesso à plataforma"><div>{u.platformRoles.length?u.platformRoles.map(r=><div key={r}>{roles[r]||r}</div>):<span className="text-muted">Sem perfil de plataforma</span>}</div></td>
 <td role="cell" data-label="Entidades e perfis"><div className="directory-memberships">{u.memberships.length?u.memberships.map(m=><div key={m.membershipId}><Link to={root+'/'+m.organizationId}>{m.organizationName}</Link><span>{roles[m.roleCode]||m.roleCode} · {states[m.status]||m.status}</span>{!m.effective&&m.status==='ACTIVE'&&<small>Acesso indisponível: verifique a validade e o estado da conta e da entidade.</small>}</div>):<span className="text-muted">Sem vínculo a entidades</span>}{u.membershipCount>u.memberships.length&&<small>{u.memberships.length} de {u.membershipCount} vínculos apresentados.</small>}</div></td>
 </tr>)}</tbody></table></div>}
