import LoadingIndicator from '../../components/LoadingIndicator'
import {useEffect,useMemo,useRef,useState} from 'react'
import {Link,useParams,useLocation} from 'react-router-dom'
import {useAuth} from '../../contexts/AuthContext'
import {organizationDirectoryApi} from '../../api/api'
import {clearDirectoryCache} from './directoryCache'
import {AreaOptions} from './OrganizationStrategy'
import './organization-people.css'
import './personal-profile.css'

const clean=value=>value.trim().normalize('NFC')
export default function PersonalProfile(){
 const {organization,user}=useAuth(),{personId}=useParams()
 if(!organization?.id)return <p>Esta conta não tem uma entidade associada para consultar o perfil pessoal.</p>
 return <ProfileForm key={`${user?.id}:${organization.id}:${personId||'me'}`} organizationId={organization.id} personId={personId}/>
}
export function ProfileForm({organizationId,personId,api:providedApi}){
 const {search}=useLocation()
 const api=useMemo(()=>providedApi||organizationDirectoryApi(organizationId),[organizationId,providedApi])
 const [data,setData]=useState(null),[form,setForm]=useState(null),[members,setMembers]=useState(null),[membershipId,setMembershipId]=useState('')
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[pending,setPending]=useState(null)
 const alive=useRef(true),generation=useRef(0)
 async function load(){const gen=++generation.current;setLoading(true);setError('');try{
  const {data:value}=await (personId?api.person(personId):api.self());if(!alive.current||gen!==generation.current)return
  const profile=value.profile
  setData(value)
  setForm(profile?{
   biography:profile.biography,
   keywords:profile.keywords,
   thematicAreaIds:[...new Set([...profile.areaIds,...(profile.interestAreaIds??[])])]
  }:null)
  setMembershipId(profile?.membershipId||'')
 }catch{if(alive.current&&gen===generation.current){setData(null);setError('Não foi possível consultar o perfil. Verifique o acesso ou tente novamente.')}}finally{if(alive.current&&gen===generation.current)setLoading(false)}}
 useEffect(()=>{alive.current=true;let active=true;Promise.resolve().then(()=>{if(active)load()});return()=>{active=false;alive.current=false;generation.current++}},[api,personId])
 async function send(command){setBusy(true);setError('');setNotice('');setPending(command);try{
  if(command.method==='selfEdit')await api.selfEdit(command.body);else await api[command.method](personId,command.body)
  clearDirectoryCache()
  if(!alive.current)return
  setPending(null);await load();if(alive.current)setNotice('Perfil atualizado.')
 }catch(e){if(!alive.current)return;const status=e.response?.status
  if(status&&status<500)setPending(null)
  setError(status===409?'O perfil mudou ou a conta já está associada. Consulte novamente antes de editar.':'Não foi possível confirmar a gravação. Pode repetir o mesmo envio.')
 }finally{if(alive.current)setBusy(false)}}
 function save(event){
  event.preventDefault()
  const {areaIds,interestAreaIds,revision}=data.profile
  const selected=form.thematicAreaIds
  // Retained areas keep their original classification. New areas feed Matching.
  const body={
   biography:clean(form.biography),
   keywords:clean(form.keywords),
   areaIds:selected.filter(id=>areaIds.includes(id)||!interestAreaIds?.includes(id)),
   ...(interestAreaIds?{interestAreaIds:interestAreaIds.filter(id=>selected.includes(id))}:{}),
   expectedRevision:revision,
   idempotencyKey:crypto.randomUUID()
  }
  send({method:personId?'personProfileEdit':'selfEdit',body})
 }
 async function loadMembers(){setBusy(true);setError('');try{const {data:value}=await api.memberships();if(alive.current)setMembers(value.items)}catch{if(alive.current)setError('Não foi possível consultar as contas da organização.')}finally{if(alive.current)setBusy(false)}}
 return <section className={personId ? "organization-profile people-record" : "organization-profile personal-profile"}>
  <div className="toolbar"><div>{personId && data?.person && <p className="people-record-label">Ficha da pessoa</p>}<h1>{personId ? data?.person?.name || 'Ficha da pessoa' : 'Perfil pessoal'}</h1>{!personId && <p className="personal-profile-intro">Consulte os seus dados e apresente as suas competências à organização.</p>}</div><Link className="btn btn-secondary" to={personId?'/perfil-organizacao/pessoas'+search:'/conta/seguranca'}>{personId?'Voltar às pessoas':'Segurança da conta'}</Link></div>
  {error&&<div role="alert" className="alert alert-error">{error} <button type="button" disabled={busy} onClick={load}>Consultar novamente</button></div>}
  {notice&&<p role="status" className="alert alert-success">{notice}</p>}
  {pending&&!busy&&<button className="btn btn-primary" onClick={()=>send(pending)}>Repetir o mesmo envio</button>}
  {loading?<LoadingIndicator>A carregar o perfil…</LoadingIndicator>:data&&!data.person?<section className="detail-section"><h3>Perfil ainda não associado</h3><p>A sua conta ainda não está associada a uma pessoa nesta organização. O gestor pode fazer essa associação na ficha da pessoa.</p><Link to="/catalogo">Continuar no catálogo</Link><p>Não precisa de completar o perfil para criar uma candidatura.</p></section>:data&&<>
   <section className="detail-section"><h3>Dados pessoais</h3><dl className="dl-list"><div className="dl-row"><dt>Nome</dt><dd>{data.person.name}</dd></div><div className="dl-row"><dt>Email</dt><dd>{data.person.email||'Por indicar'}</dd></div><div className="dl-row"><dt>Função</dt><dd>{data.person.functionLabel||'Por indicar'}</dd></div><div className="dl-row"><dt>Departamentos / Unidades</dt><dd>{data.units.length?data.units.map(u=><div key={u.scopeId}>{u.label}{u.isPrimary?' · Principal':''}</div>):'Afeta à organização'}</dd></div></dl></section>
   {!data.permissions.edit&&<p>Acesso de consulta. Sem permissão para editar este perfil.</p>}
   <form onSubmit={save}><fieldset disabled={busy||Boolean(pending)||!data.permissions.edit}>
    <section className="detail-section personal-competencies"><h3>Apresentação</h3><div className="field-grid"><label className="field field-full">Biografia<textarea rows={3} maxLength={4000} value={form.biography} onChange={e=>setForm(f=>({...f,biography:e.target.value}))}/></label><label className="field field-full">Palavras-chave<textarea rows={2} maxLength={1000} value={form.keywords} onChange={e=>setForm(f=>({...f,keywords:e.target.value}))}/></label></div></section>
    <section className="detail-section personal-areas" aria-label="Áreas temáticas">
     <h3>Áreas temáticas</h3>
     <AreaOptions areas={data.areas} selected={form.thematicAreaIds}
      onChange={thematicAreaIds=>setForm(old=>({...old,thematicAreaIds}))}/>
    </section>
    {data.permissions.edit&&<div className="form-actions"><button className="btn btn-primary" type="submit">{busy?'A guardar…':'Guardar perfil'}</button></div>}
   </fieldset></form>
   <section className="detail-section personal-matching"><Link className="btn btn-outline" to={personId?`/matching?pessoa=${personId}`:'/matching'}>Ver oportunidades correspondentes</Link></section>
   {personId&&data.permissions.edit&&<section className="detail-section"><h3>Conta associada</h3><p>A associação liga o perfil pessoal a uma conta existente nesta organização. Não cria conta nem concede acesso.</p>
    {members===null?<button disabled={busy} className="btn btn-outline" onClick={loadMembers}>Consultar associação e contas</button>:<form onSubmit={e=>{e.preventDefault();send({method:'personLinkEdit',body:{membershipId:membershipId||null,expectedRevision:data.profile.revision,idempotencyKey:crypto.randomUUID()}})}}><fieldset disabled={busy||Boolean(pending)}><label>Conta da organização<select value={membershipId} onChange={e=>setMembershipId(e.target.value)}><option value="">Sem conta associada</option>{members.map(m=><option key={m.membershipId} value={m.membershipId}>{m.name} — {m.email}{m.status==='SUSPENDED'?' (acesso suspenso)':''}</option>)}</select></label><button type="submit" className="btn btn-primary">Guardar associação</button></fieldset></form>}
   </section>}
  </>}
 </section>
}
