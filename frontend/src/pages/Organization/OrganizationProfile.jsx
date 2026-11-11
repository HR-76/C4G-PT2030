import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import FormModal from '../../components/FormModal'
import LoadingIndicator from '../../components/LoadingIndicator'
import {useEffect,useMemo,useRef,useState} from 'react'
import {Link,NavLink,useLocation,useSearchParams} from 'react-router-dom'
import {Building2,Users,Network,Plus,Search} from 'lucide-react'
import {useAuth} from '../../contexts/AuthContext'
import {organizationDirectoryApi} from '../../api/api'
import InfoTooltip from '../../components/InfoTooltip'
import {directoryIntentKey} from './intentions'
import {clearDirectoryCache,defaultPeopleQuery,directoryCacheEpoch,directoryCacheKey,keepDirectoryRead,peopleQueryKey,readDirectoryCache,sharedDirectoryRead,writeDirectoryCache} from './directoryCache'
import EntityProfileCard from './EntityProfileCard'
import './organization.css'
import OrganizationStrategy, { AreaNames, StrategyFields } from './OrganizationStrategy'

const emptyPerson={name:'',email:'',functionLabel:'',active:true,unitIds:[],primaryUnitId:null}
const clean=value=>value.trim().normalize('NFC')
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
export function directoryError(error){
 const status=error.response?.status,code=error.response?.data?.error?.code
 if(status===401)return 'Sessão expirada. Inicie sessão novamente.'
 if(status===403)return 'Não tem permissão para esta área ou ação na organização selecionada.'
 if(status===404)return 'O registo já não está disponível nesta organização.'
 if(code==='AUTHORITY_STALE')return 'A autorização mudou durante a consulta. Consulte novamente para confirmar o acesso atual.'
 if(code==='CONTEXT_CHANGED')return 'A organização mudou. Consulte novamente antes de guardar.'
 if(code==='STALE_REVISION')return 'Outra pessoa alterou este registo. Consulte a versão atual antes de editar.'
 if(code==='UNIT_UNAVAILABLE'||code==='DEPENDENCY_CONFLICT')return 'A unidade selecionada não está disponível ou criaria uma relação inválida.'
 if(code==='LIMIT_EXCEEDED')return 'A estrutura excede o limite desta consulta. Contacte a administração C4G.'
 if(status===400)return 'Verifique os campos e volte a tentar.'
 if(status===409)return 'O registo mudou ou este envio está em conflito. Consulte novamente antes de editar.'
 return 'Não foi possível confirmar a operação. Pode consultar novamente ou repetir o mesmo envio.'
}
export function unitPath(unit,units){
 const labels=[unit.label],seen=new Set([unit.scopeId]);let parent=units.find(u=>u.scopeId===unit.parentScopeId)
 while(parent&&!seen.has(parent.scopeId)){seen.add(parent.scopeId);labels.unshift(parent.label);parent=units.find(u=>u.scopeId===parent.parentScopeId)}
 return labels.join(' › ')
}
export default function OrganizationProfile(){
 const auth=useAuth()
 if(!auth.organization)return <section className="organization-page"><h2>Perfil da organização</h2><p role="status">Esta conta não tem uma entidade associada.</p></section>
 return <Workspace key={`${auth.user.id}:${auth.organization.id}`} userId={auth.user.id} organizationId={auth.organization.id}/>
}
function Workspace({userId,organizationId}){
 const location=useLocation(),api=useMemo(()=>organizationDirectoryApi(organizationId),[organizationId])
 const tab=/^\/perfil-organizacao\/pessoas(?:\/|$)/.test(location.pathname)?'people':location.pathname.endsWith('/unidades')?'units':'profile'
 const cacheKey=directoryCacheKey(userId,organizationId),[initial]=useState(()=>readDirectoryCache(cacheKey))
 const [params,setParams]=useSearchParams()
 const appliedUnit=params.get('unitId')||''
 const [context,setContext]=useState(initial?.context||null),[units,setUnits]=useState(initial?.units||[])
 const [people,setPeople]=useState(()=>{const kept=tab==='people'&&initial?.people;return kept&&kept.query===peopleQueryKey({...defaultPeopleQuery,unitId:appliedUnit})?{items:kept.data.items,nextCursor:kept.data.nextCursor}:{items:[],nextCursor:null}})
 const [loading,setLoading]=useState(!initial),[listLoading,setListLoading]=useState(false),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[form,setForm]=useState(null),[pending,setPending]=useState(null)
 const [areas,setAreas]=useState([]),[areaId,setAreaId]=useState(''),[interestAreaId,setInterestAreaId]=useState('')
 const [areasOpen,setAreasOpen]=useState(false),areasTrigger=useRef(null)
 const strategyTrigger=useRef(null)
 const [search,setSearch]=useState(''),[unitId,setUnitId]=useState(appliedUnit),[status,setStatus]=useState('ACTIVE'),[otherFilters,setFilters]=useState({search:'',status:'ACTIVE'})
 const filters=useMemo(()=>({...otherFilters,unitId:appliedUnit}),[otherFilters,appliedUnit])
 useEffect(()=>{setUnitId(appliedUnit)},[appliedUnit])
 function applyUnit(value){const next=new URLSearchParams(params);if(value)next.set('unitId',value);else next.delete('unitId');setParams(next,{replace:true})}
 const alive=useRef(true),generation=useRef(0),listGeneration=useRef(0),mutex=useRef(false),formRef=useRef(null)
 const key=directoryIntentKey(userId,organizationId)
 useEffect(()=>{alive.current=true;try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.userId===userId&&saved?.organizationId===organizationId)setPending(saved)}catch{setError('Não foi possível recuperar o envio anterior.')}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load, organizationId, userId are read at that moment.
  let active=true;Promise.resolve().then(()=>{if(active)load()});return()=>{active=false;alive.current=false;generation.current += 1;listGeneration.current += 1}},[key,tab])
 useEffect(()=>{setForm(null);setNotice('')},[tab])
 const previousPath=useRef(location.pathname)
 useEffect(()=>{
  setAreasOpen(false)
  const returnedToPeople=location.pathname==='/perfil-organizacao/pessoas'&&previousPath.current.startsWith('/perfil-organizacao/pessoas/')
  previousPath.current=location.pathname
  if(returnedToPeople&&context&&!readDirectoryCache(cacheKey))load(true)
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; cacheKey, context, load are read at that moment.
 },[location.pathname])
 // Deferred like the context read, so a development double mount sends one request.
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; loadPeople is read at that moment.
 useEffect(()=>{if(tab!=='people'||!context)return;let active=true;Promise.resolve().then(()=>{if(active)loadPeople(filters)});return()=>{active=false}},[tab,context,filters])
 useEffect(()=>{formRef.current?.focus()},[form?.method,form?.id])
 const current=token=>alive.current&&token===generation.current
 // Entering a page reuses the context the server confirmed moments ago, so the
 // page and its lists start at once; the context is still read again on every
 // entry and a refusal hides everything. `fresh` (after a save or an explicit
 // retry) waits for the server before showing anything.
 async function load(fresh=false){
  const token=++generation.current,held=fresh?null:readDirectoryCache(cacheKey),wantsUnits=tab!=='profile'
  const unitsAllowed=held?.context.permissions.units===true,ready=Boolean(held)&&(!wantsUnits||!unitsAllowed||Boolean(held.units))
  setError('');setLoading(!ready)
  if(held){setContext(old=>same(old,held.context)?old:held.context);setUnits(held.units||[])}
  else{setContext(null);setUnits([]);setPeople({items:[],nextCursor:null});setAreasOpen(false);listGeneration.current += 1}
  try{
   const readUnits=()=>sharedDirectoryRead(cacheKey,'units',()=>api.units())
   const early=held&&wantsUnits&&unitsAllowed?readUnits():null;early?.catch(()=>{})
   const result=(await api.context()).data;if(!current(token))return
   if(tab==='people')setContext(old=>same(old,result)?old:result)
   const rows=wantsUnits&&result.permissions.units?(await (early||readUnits())).data.items:null;if(!current(token))return
   writeDirectoryCache(cacheKey,{context:result,...(rows?{units:rows}:result.permissions.units?{}:{units:undefined})})
   setContext(old=>same(old,result)?old:result);setUnits(old=>rows?(same(old,rows)?old:rows):result.permissions.units?old:[])
   prepare(result)
  }catch(e){if(current(token)){clearDirectoryCache();listGeneration.current += 1;setContext(null);setUnits([]);setPeople({items:[],nextCursor:null});setAreasOpen(false);setError(directoryError(e))}}finally{if(current(token))setLoading(false)}
 }
 // Reads in the background what the other two pages will need, so they open at
 // once. Their own entry still reads the data again; a save or a refusal in
 // the meantime discards these answers.
 function prepare(result){
  const since=directoryCacheEpoch(),entry=readDirectoryCache(cacheKey);if(!entry)return
  if(tab==='profile'&&result.permissions.units&&!entry.units)sharedDirectoryRead(cacheKey,'units',()=>api.units()).then(r=>keepDirectoryRead(cacheKey,since,{units:r.data.items}),()=>{})
  const usual=peopleQueryKey(defaultPeopleQuery)
  if(tab!=='people'&&entry.people?.query!==usual)sharedDirectoryRead(cacheKey,'people:'+usual,()=>api.people({...defaultPeopleQuery})).then(r=>keepDirectoryRead(cacheKey,since,{people:{query:usual,data:r.data}}),()=>{})
 }
 // The first page of a query confirmed moments ago is shown at once and read
 // again; a refusal removes it. Further pages are never kept.
 async function loadPeople(query,append=false){
  const token=++listGeneration.current,since=directoryCacheEpoch(),queryKey=append?null:peopleQueryKey(query),kept=queryKey?readDirectoryCache(cacheKey)?.people:null
  const shown=kept?.query===queryKey?kept.data:null,valid=()=>alive.current&&token===listGeneration.current
  setError('')
  if(shown){setListLoading(false);setAreas(shown.areas||[]);setPeople(old=>same(old.items,shown.items)&&old.nextCursor===shown.nextCursor?old:{items:shown.items,nextCursor:shown.nextCursor})}
  else{setListLoading(true);if(!append)setPeople({items:[],nextCursor:null})}
  try{const data=(await (append?api.people(query):sharedDirectoryRead(cacheKey,'people:'+queryKey,()=>api.people(query)))).data
   if(queryKey)keepDirectoryRead(cacheKey,since,{people:{query:queryKey,data}})
   if(valid()){setAreas(data.areas||[]);setPeople(old=>append?{items:[...old.items,...data.items],nextCursor:data.nextCursor}:same(old.items,data.items)&&old.nextCursor===data.nextCursor?old:{items:data.items,nextCursor:data.nextCursor})}}
  catch(e){if(shown)keepDirectoryRead(cacheKey,since,{people:undefined});if(valid()){if(shown)setPeople({items:[],nextCursor:null});setError(directoryError(e))}}finally{if(valid())setListLoading(false)}
 }
 async function send(intent){
  if(mutex.current)return;mutex.current=true;setBusy(true);setError('');setNotice('')
  try{
   // Persist before dispatch; uncertain outcomes can only repeat this exact command.
   sessionStorage.setItem(key,JSON.stringify(intent));setPending(intent)
   await (intent.id?api[intent.method](intent.id,intent.body):api[intent.method](intent.body))
   sessionStorage.removeItem(key);clearDirectoryCache()
   if(!alive.current)return;setPending(null);setForm(null);setNotice('Alterações guardadas.');await load(true)
  }catch(e){if(!alive.current)return
   if([400,401,403,404,409].includes(e.response?.status)){try{sessionStorage.removeItem(key)}catch{}setPending(null);setForm(null)}
   setError(directoryError(e))
  }finally{mutex.current=false;if(alive.current)setBusy(false)}
 }
 function submit(event){event.preventDefault();if(!form||pending||busy)return
  const body={...form.values,idempotencyKey:crypto.randomUUID()};for(const field of ['name','label','description','email','website','functionLabel'])if(field in body)body[field]=clean(body[field])
  if('stableCode'in body)body.stableCode=body.stableCode.trim()||null
  if(form.method==='strategyEdit'){
   const interests=[...new Set(body.interestText.split('\n').map(clean).filter(Boolean))]
   const objectives=body.objectives.map(item=>({...item,title:clean(item.title),target:clean(item.target)}))
   if(interests.length>30||interests.some(interest=>interest.length>256)){setError('Indique até 30 interesses, com um máximo de 256 caracteres por interesse.');return}
   if(objectives.some(objective=>!objective.title)){setError('Indique o nome de cada objetivo.');return}
   delete body.interestText
   Object.assign(body,{interests,objectives})
  }
  send({userId,organizationId,method:form.method,id:form.id||null,body})
 }
 const updateValues=values=>setForm(old=>({...old,values:{...old.values,...values}}))
 const update=(field,value)=>updateValues({[field]:value})
 const activeUnits=units.filter(u=>u.lifecycle==='ACTIVE'),canEdit=context?.permissions.edit&&!pending
 const strategy=context?.profile?.strategy,editingStrategy=form?.method==='strategyEdit'
 function editStrategy(){
  setForm({method:'strategyEdit',values:{areaIds:strategy.areaIds,objectives:strategy.objectives,
   interestText:strategy.interests.join('\n'),expectedRevision:context.profile.revision}})
 }
 function editPerson(person){setForm({method:'personEdit',id:person.personId,values:{name:person.name,email:person.email,functionLabel:person.functionLabel,active:person.active,unitIds:person.unitIds,primaryUnitId:person.primaryUnitId,expectedRevision:person.revision}})}
 const loadMorePeople=people.nextCursor?()=>loadPeople({...filters,cursor:people.nextCursor},true):null
 const personForm=form?.method.startsWith('person'),unitForm=form?.method.startsWith('unit')
 const modalForm=unitForm||personForm||editingStrategy
 const formTitle=form?({strategyEdit:'Editar estratégia',unitCreate:'Criar departamento / unidade',unitRename:'Renomear unidade',personCreate:'Registar pessoa',personEdit:'Editar pessoa'})[form.method]:undefined
 const feedback=<>{error&&<div className="organization-alert" role="alert"><p>{error}</p><button className="btn btn-outline" disabled={busy||loading||Boolean(modalForm&&pending)} onClick={()=>{setForm(null);load(true)}}>Consultar novamente</button></div>}{pending&&!busy&&<div className="organization-alert"><p>Existe um envio por confirmar nesta organização. Repita-o para confirmar o resultado, sem criar um segundo registo.</p><button className="btn btn-primary" disabled={busy||loading} onClick={()=>send(pending)}>{busy?'A confirmar…':'Repetir o mesmo envio'}</button></div>}</>
 const editor=form&&<form className="edit-form organization-card organization-form" onSubmit={submit}>{!modalForm&&<h3 ref={formRef} tabIndex={-1}>Editar descrição da organização</h3>}<fieldset disabled={busy||Boolean(pending)}>
    {editingStrategy?<StrategyFields areas={context?.profile.strategyAreas || []} values={form.values} onChange={updateValues}/>:<div className="field-grid">
    {form.method==='descriptionEdit'&&<label>Descrição<textarea rows={5} maxLength={4000} value={form.values.description} onChange={e=>update('description',e.target.value)}/></label>}
    {unitForm&&<><label>Nome da unidade<input required maxLength={256} value={form.values.label} onChange={e=>update('label',e.target.value)}/></label>{form.method==='unitCreate'&&<label>Código interno (opcional)<input maxLength={64} pattern="[A-Z][A-Z0-9]*([-_][A-Z0-9]+)*" placeholder="EX: FINANCEIRO" value={form.values.stableCode} onChange={e=>update('stableCode',e.target.value)}/><small>O código identifica a unidade e não muda depois de criada.</small></label>}</>}
    {personForm&&<><label>Nome da pessoa<input required maxLength={256} value={form.values.name} onChange={e=>update('name',e.target.value)}/></label><label>Email (opcional)<input type="email" maxLength={254} value={form.values.email} onChange={e=>update('email',e.target.value)}/></label><label>Função (opcional)<input maxLength={256} value={form.values.functionLabel} onChange={e=>update('functionLabel',e.target.value)}/></label><label>Estado da pessoa<select aria-label="Estado da pessoa" value={String(form.values.active)} onChange={e=>update('active',e.target.value==='true')}><option value="true">Ativa</option><option value="false">Inativa</option></select></label></>}
    </div>}
    {personForm&&<><fieldset className="organization-affiliations"><legend>Afetação a departamentos / unidades</legend><p className="text-muted">Sem seleção, a pessoa fica diretamente afeta à organização.</p>{activeUnits.map(u=><label key={u.scopeId}><input type="checkbox" checked={form.values.unitIds.includes(u.scopeId)} onChange={e=>{const selected=e.target.checked?[...form.values.unitIds,u.scopeId]:form.values.unitIds.filter(id=>id!==u.scopeId);setForm(old=>({...old,values:{...old.values,unitIds:selected,primaryUnitId:selected.includes(old.values.primaryUnitId)?old.values.primaryUnitId:selected[0]||null}}))}}/>{unitPath(u,units)}</label>)}</fieldset>{form.values.unitIds.length>0&&<label>Unidade principal<select aria-label="Unidade principal" required value={form.values.primaryUnitId||''} onChange={e=>update('primaryUnitId',e.target.value)}>{activeUnits.filter(u=>form.values.unitIds.includes(u.scopeId)).map(u=><option key={u.scopeId} value={u.scopeId}>{unitPath(u,units)}</option>)}</select></label>}</>}
    <div className="organization-actions"><button className={['unitCreate','personCreate'].includes(form.method) ? 'btn btn-primary btn-create' : 'btn btn-primary'} type="submit">{busy?'A guardar…':'Guardar alterações'}</button><button type="button" className="btn btn-secondary" onClick={()=>setForm(null)}>Cancelar</button></div>
   </fieldset></form>
 return <section className={`organization-page${tab==='people'?' people-directory':tab==='units'?' units-directory':' institutional-profile'}`}>
  <header className="page-header"><div><span className="organization-eyebrow">{context?.organization.name}</span><h1>{tab==='units'?'Departamentos / Unidades':tab==='people'?'Pessoas':'Perfil da organização'}</h1></div><Building2 aria-hidden="true" size={32}/></header>
  <nav className="tabs-header" aria-label="Perfil da organização">
   <NavLink end className={({isActive})=>'tab-btn'+(isActive?' active':'')} to="/perfil-organizacao"><Building2 size={17}/> Organização</NavLink>
   <NavLink className={({isActive})=>'tab-btn'+(isActive?' active':'')} to="/perfil-organizacao/unidades"><Network size={17}/> Departamentos / Unidades</NavLink>
   <NavLink className={({isActive})=>'tab-btn'+(isActive?' active':'')} to="/perfil-organizacao/pessoas"><Users size={17}/> Pessoas</NavLink>
  </nav>
  {!modalForm&&feedback}
  {notice&&<p role="status" className="organization-notice">{notice}</p>}

  {loading?<LoadingIndicator>A carregar a organização…</LoadingIndicator>:context&&<>
   {!context.permissions.edit&&<p className="text-muted">Acesso de consulta. A edição requer permissão na organização.</p>}
    {tab==='profile'&&<div className="organization-grid"><section className="detail-section organization-card"><div className="organization-heading"><div className="heading-with-info"><h3>Apresentação da organização</h3></div>{canEdit&&form?.method!=='descriptionEdit'&&<button className="btn btn-outline" onClick={()=>setForm({method:'descriptionEdit',values:{description:context.profile.description,expectedRevision:context.profile.revision}})}>Editar descrição</button>}</div>
     {form?.method==='descriptionEdit'?editor:<dl className="dl-list"><div className="dl-row dl-full"><dt>Descrição</dt><dd className="organization-description">{context.profile.description||'Por preencher'}</dd></div></dl>}
   </section><aside className="detail-section organization-card"><h3>Estrutura da entidade</h3><Link aria-label="Ver departamentos e unidades" to="/perfil-organizacao/unidades" className="btn btn-outline">Ver departamentos e unidades</Link><Link aria-label="Ver pessoas" to="/perfil-organizacao/pessoas" className="btn btn-outline">Ver pessoas</Link><hr/><div className="heading-with-info"><h3>Competências e Matching</h3></div><Link to="/matching" className="btn btn-outline">Consultar Matching</Link></aside></div>}
    {tab==='profile'&&strategy&&<OrganizationStrategy strategy={strategy} areas={context.profile.strategyAreas}
     onEdit={canEdit?editStrategy:null} editTriggerRef={strategyTrigger}/>}
    {tab==='profile'&&<EntityProfileCard profile={context.registration} organization={context.organization} canEdit={canEdit} defaults={!context.registration?{institutionalEmail:context.profile.email||'',website:context.profile.website||''}:{}} onSave={async body=>{const saved=(await api.registrationProfile(body)).data;clearDirectoryCache();return saved}}/>}
   {tab==='units'&&<><div className="organization-heading"><div className="heading-with-info"><h3>Departamentos / Unidades</h3></div>{canEdit&&context.permissions.createUnit&&<button className="btn btn-primary btn-create" onClick={()=>setForm({method:'unitCreate',values:{label:'',stableCode:'',parentScopeId:null}})}><Plus size={16}/> Criar unidade</button>}</div>
    {!context.permissions.units?<p>Sem permissão para consultar a estrutura completa da organização.</p>:units.length===0?<div className="detail-section organization-card"><h3>A organização ainda não tem unidades</h3><p>Crie o primeiro departamento ou unidade para começar a organizar a equipa.</p></div>:<div className="table-wrap" role="region" aria-label="Tabela de departamentos e unidades" tabIndex={0}><table role="table" className="data-table mobile-card-table organization-directory-table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Departamento / Unidade</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Ações</th></tr></thead><tbody role="rowgroup">{[...units].sort((a,b)=>unitPath(a,units).localeCompare(unitPath(b,units),'pt')).map(unit=><tr role="row" key={unit.scopeId}><td role="cell" data-label="Unidade"><Link className="unit-people-link" aria-label={`Ver pessoas de ${unit.label}`} to={`/perfil-organizacao/pessoas?unitId=${encodeURIComponent(unit.scopeId)}`}>{unit.label}</Link>{(unitPath(unit,units)!==unit.label||unit.stableCode)&&<small className="organization-path">{unitPath(unit,units)!==unit.label?unitPath(unit,units):''}{unitPath(unit,units)!==unit.label&&unit.stableCode?' · ':''}{unit.stableCode||''}</small>}</td><td role="cell" data-label="Estado"><span className={unit.lifecycle==='ACTIVE'?'badge-green':'badge-grey'}>{unit.lifecycle==='ACTIVE'?'Ativa':'Arquivada'}</span></td><td role="cell" data-label="Ações"><div className="organization-actions">{canEdit&&unit.lifecycle==='ACTIVE'&&<>{context.permissions.renameUnit&&<button className="btn btn-outline" onClick={()=>setForm({method:'unitRename',id:unit.scopeId,values:{label:unit.label,expectedRevision:unit.revision}})}>Renomear</button>}</>}</div></td></tr>)}</tbody></table></div>}
   </>}
   {tab==='people'&&<><div className="organization-heading">
    <div className="heading-with-info"><h3>Pessoas da organização</h3><InfoTooltip label="Informação sobre o registo de pessoas">Registar uma pessoa não cria uma conta nem concede acesso à aplicação.</InfoTooltip></div>
    <div className="people-heading-actions">
     <button type="button" className="btn btn-outline" ref={areasTrigger} aria-haspopup="dialog"
      disabled={!people.items.length} onClick={()=>setAreasOpen(true)}>Áreas temáticas</button>
     {canEdit&&context.permissions.units&&<button className="btn btn-primary btn-create" onClick={()=>setForm({method:'personCreate',values:{...emptyPerson}})}><Plus size={16}/> Registar pessoa</button>}
    </div>
   </div>
    {appliedUnit && <div className="people-unit-context"><span>Unidade selecionada <strong>{units.find(u=>u.scopeId===appliedUnit)?.label || 'Unidade'}</strong></span><Link to="/perfil-organizacao/unidades">Voltar às unidades</Link></div>}
    <FilterBar aria-label="Filtros de pessoas" as="form" className="organization-filters" onSubmit={event=>{
      event.preventDefault()
      applyUnit(unitId)
      setFilters({search:clean(search),status,...(areaId?{areaId}:{}),...(strategy&&interestAreaId?{interestAreaId}:{})})
    }}>
      <label className="filter-search">Pesquisar<SearchInput value={search} maxLength={100} placeholder="Nome, email ou função" onChange={e=>setSearch(e.target.value)}/></label>
      <details className="people-more-filters"><summary>Filtros avançados</summary><div>
        <label>Departamento / Unidade<select aria-label="Departamento / Unidade" value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">Todas as unidades</option>{units.map(u=><option key={u.scopeId} value={u.scopeId}>{unitPath(u,units)}</option>)}</select></label>
        <label>Área temática<select aria-label="Área temática" value={areaId} onChange={e=>setAreaId(e.target.value)}><option value="">Todas as competências</option>{areas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        {strategy&&<label>Área de interesse<select aria-label="Área de interesse" value={interestAreaId} onChange={e=>setInterestAreaId(e.target.value)}><option value="">Todos os interesses</option>{areas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}</select></label>}
        <label>Estado<select aria-label="Estado" value={status} onChange={e=>setStatus(e.target.value)}><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option><option value="ALL">Todas</option></select></label>
      </div></details>
      <button className="btn btn-primary" disabled={listLoading}><Search size={16}/> Aplicar filtros</button>
      <button type="button" className="btn btn-secondary" onClick={()=>{
        setSearch('');setUnitId('');setAreaId('');setInterestAreaId('');setStatus('ACTIVE');applyUnit('');setFilters({search:'',status:'ACTIVE'})
      }}>Limpar filtros</button>
    </FilterBar>
    {listLoading&&<LoadingIndicator>A consultar pessoas…</LoadingIndicator>}
    {!listLoading&&!error&&people.items.length===0&&<div className="detail-section organization-card"><h3>Nenhuma pessoa encontrada</h3><p>Registe a primeira pessoa ou ajuste os filtros.</p></div>}
    {!listLoading&&!error&&people.items.length>0&&<p className="people-count" role="status">{people.items.length} {people.items.length===1?'pessoa apresentada':'pessoas apresentadas'}</p>}
    {people.items.length>0&&<PeopleTable people={people.items} units={units} search={location.search}
     onEdit={canEdit&&context.permissions.units?editPerson:null}/>}
    {loadMorePeople&&<button className="btn btn-secondary" disabled={listLoading} onClick={loadMorePeople}>Mais pessoas</button>}
    {areasOpen&&<PeopleAreasModal people={people.items} areas={areas}
     loading={listLoading} error={error} onLoadMore={loadMorePeople}
     returnFocusRef={areasTrigger} onClose={()=>setAreasOpen(false)}/>}
   </>}
   {modalForm&&<FormModal title={formTitle} locked={busy||Boolean(pending)} onClose={()=>setForm(null)}
    className={editingStrategy?'strategy-edit-modal':undefined} returnFocusRef={editingStrategy?strategyTrigger:undefined}>
    {editingStrategy?<div className="strategy-edit-content">{feedback}{editor}</div>:<>{feedback}{editor}</>}
   </FormModal>}
  </>}
 </section>
}

function PeopleTable({ people, units, search, onEdit }) {
 const columns=['Pessoa','Função','Departamentos / Unidades','Estado','Ações']
 return <div className="table-wrap" role="region" aria-label="Tabela de pessoas" tabIndex={0}>
  <table role="table" className="data-table mobile-card-table organization-directory-table">
   <thead role="rowgroup"><tr role="row">{columns.map(column=><th key={column} role="columnheader" scope="col">{column}</th>)}</tr></thead>
   <tbody role="rowgroup">{people.map(person=><tr role="row" key={person.personId}>
    <td role="cell" data-label="Pessoa"><Link state={{fromPeopleList:true}} to={`/perfil-organizacao/pessoas/${person.personId}${search}`}><strong>{person.name}</strong></Link><small className="organization-path">{person.email||'Sem email indicado'}</small></td>
    <td role="cell" data-label="Função">{person.functionLabel||'Por indicar'}</td>
    <td role="cell" data-label="Unidades">{person.unitIds.length?person.unitIds.map(id=><div key={id}>{units.find(u=>u.scopeId===id)?.label||'Unidade com consulta restrita'}{id===person.primaryUnitId&&<small> · Principal</small>}</div>):'Afeta à organização'}</td>
    <td role="cell" data-label="Estado"><span className={person.active?'badge-green':'badge-grey'}>{person.active?'Ativa':'Inativa'}</span></td>
    <td role="cell" data-label="Ações">{onEdit&&<button className="btn btn-outline" onClick={()=>onEdit(person)}>Editar {person.name}</button>}</td>
   </tr>)}</tbody>
  </table>
 </div>
}

function PeopleAreasModal({ people, areas, loading, error, onLoadMore, onClose, returnFocusRef }) {
 const results=useRef(null)
 return <FormModal title="Áreas temáticas" className="people-areas-modal" onClose={onClose} returnFocusRef={returnFocusRef}>
  <div ref={results} className="people-areas-results" role="region" aria-label="Resultados por pessoa" aria-busy={loading} tabIndex={0}>
   {people.length>0&&<table role="table" className="data-table mobile-card-table">
    <thead role="rowgroup"><tr role="row">
     <th role="columnheader" scope="col">Pessoa</th>
     <th role="columnheader" scope="col">Áreas temáticas</th>
    </tr></thead>
    <tbody role="rowgroup">{people.map(person=><tr role="row" key={person.personId}>
     <th role="rowheader" scope="row">
      <strong>{person.name}</strong>
      <small className="organization-path">{person.email||'Sem email indicado'}</small>
     </th>
     <td role="cell" data-label="Áreas temáticas">
      <AreaNames areas={areas} ids={[...(person.areaIds??[]),...(person.interestAreaIds??[])]} asList/>
     </td>
    </tr>)}</tbody>
   </table>}
  </div>
  {error&&<p className="organization-alert" role="alert">{error}</p>}
  <footer className="people-areas-footer">
   <p role="status">{loading?'A consultar pessoas…':people.length===0?'Nenhuma pessoa encontrada':
    `${people.length} ${people.length===1?'pessoa apresentada':'pessoas apresentadas'}`}</p>
   {onLoadMore&&<button type="button" className="btn btn-secondary" disabled={loading} onClick={()=>{
    results.current?.focus({preventScroll:true})
    onLoadMore()
   }}>Mais pessoas</button>}
  </footer>
 </FormModal>
}
