import ApplicationListPriority from './ApplicationListPriority'
import EmptyStatePanel from '../../components/EmptyStatePanel'
import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import FormModal from '../../components/FormModal'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ArrowRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { readScope, startConfirmedRead } from '../../api/confirmedReads'
import { privateApplicationsApi as api } from '../../api/api'
import InfoTooltip from '../../components/InfoTooltip'
import { ApplicationsTable, SortIcon } from './ApplicationPresentation'
import { ApplicationAreaHeader } from './ApplicationAreaNav'
import { LABEL, CHIP, budgetLabel, dateLabel } from './lifecycle'
import { primaryApplicationStatuses } from '../../utils/applicationStatuses'
import { applicationIntentKey, loadApplicationIntention } from './intentions'
import { applicationDetailTarget } from './navigation'
import { unitLabel } from '../Interests/UnitSelector'
import './applications.css'
import './application-list.css'

const columns=[['title','Título'],['opportunityTitle','Oportunidade'],['status','Estado'],['statusChangedAt','Data do estado'],['responsibleName','Responsável'],['totalBudget','Orç. total'],['organizationBudget','Orç. organização'],['opportunityClosingDate','Prazo da oportunidade']]
export default function ApplicationBrowse(){
 const {user,organization}=useAuth(),navigate=useNavigate(),[params,setParams]=useSearchParams()
 const org=organization?.id,userId=user?.id,alive=useRef(true)
 const q=params.get('q')||'',status=params.get('status')==='INTENTION'?'IDENTIFIED':params.get('status')||'',sort=params.get('sort')||'title',direction=params.get('direction')||'asc',opportunityId=params.get('oportunidade')||params.get('opportunityId')||''
 const unitId=params.get('unitId')||'',returnTo='/candidaturas'+(params.size?'?'+params.toString():'')
 // The first page of a query already confirmed is shown at once and read again.
 const scope=org&&userId?readScope(userId,org):null,pageName=`applications:${JSON.stringify([q,status,sort,direction,opportunityId,unitId])}`
 const [cursor,setCursor]=useState(null),[data,setData]=useState(()=>startConfirmedRead(scope,pageName).held),[loading,setLoading]=useState(!data),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 const statusTrigger=useRef(null)
 const [selection,setSelection]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const [pending,setPending]=useState(()=>loadApplicationIntention(userId,org))
 const units=data?.units||[],lastQuery=useRef({org,userId,q})
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{setCursor(null);setData(null);setSelection(null)},[q,status,sort,direction,opportunityId,unitId])
 useEffect(()=>{if(!org||!userId)return;let active=true;const controller=new AbortController(),read=startConfirmedRead(scope,cursor?null:pageName);setLoading(!read.held);setData(read.held);setError('')
  const previous=lastQuery.current,delay=previous.org===org&&previous.userId===userId&&previous.q!==q?250:0
  lastQuery.current={org,userId,q}
  const timer=setTimeout(()=>api.browsePage({q,status,sort,direction,opportunityId:opportunityId||undefined,unitId:unitId||undefined,cursor:cursor||undefined},org,controller.signal).then(r=>{if(!Array.isArray(r.data.units))throw Error('Incomplete page');read.keep(r.data);if(active)setData(r.data)})
   .catch(e=>{if(active&&e?.code!=='ERR_CANCELED'){read.drop();setData(null)}if(active&&e?.code!=='ERR_CANCELED')setError(e?.response?.data?.error?.code==='INVALID_CURSOR'?'A lista mudou ou a página expirou. Volte à primeira página.':'Não foi possível carregar as candidaturas. Tente novamente.')})
   .finally(()=>{if(active)setLoading(false)}),delay)
  return()=>{active=false;controller.abort();clearTimeout(timer)}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; pageName, scope are read at that moment.
 },[org,userId,q,status,sort,direction,opportunityId,unitId,cursor,refresh])
 function filter(values){setCursor(null);setData(null);setSelection(null);setParams(previous=>{const next=new URLSearchParams(previous);for(const [key,value] of Object.entries(values)){if(value)next.set(key,value);else next.delete(key)}return next},{replace:true})}
 async function send(intent){if(busy)return;setBusy(true);setError('');setNotice('')
  const key=applicationIntentKey(userId,org)
  try{
   const body={...intent.payload,idempotencyKey:intent.idempotencyKey}
   const result=intent.method==='create'?await api.create(body,org):intent.method==='edit'?await api.edit(intent.id,body,org):await api.transition(intent.id,body,org)
   if(!alive.current)return
   sessionStorage.removeItem(key);setPending(null);setSelection(null);setReason('');setNotice('Alteração guardada.');setCursor(null);setRefresh(n=>n+1)
   if(intent.method==='create')navigate(applicationDetailTarget(result.data.applicationId,returnTo))
  }catch(e){if(!alive.current)return
   const definitive=e?.response?.status===400||(e?.response?.status===409&&['STALE_REVISION','STATE_CONFLICT','SCHEMA_UPGRADE_REQUIRED','RESPONSIBLE_UNAVAILABLE','UNIT_UNAVAILABLE','STALE_OPPORTUNITY_REVISION'].includes(e?.response?.data?.error?.code))
   if(definitive){sessionStorage.removeItem(key);setPending(null);setSelection(null);setCursor(null);setRefresh(n=>n+1);setNotice('Os dados mudaram. Confirme o estado atual antes de voltar a alterar.')}
   else setError('Resultado por confirmar. Repita o mesmo envio para confirmar a alteração.')
  }finally{if(alive.current)setBusy(false)}
 }
 function transition(event){event.preventDefault();if(!selection?.status||busy||pending||!reason.trim())return
  const existing=loadApplicationIntention(userId,org);if(existing){setPending(existing);return}
  const intent={userId,organizationId:org,method:'transition',id:selection.row.applicationId,payload:{status:selection.status,reason:reason.trim(),expectedRevision:selection.row.revision},idempotencyKey:crypto.randomUUID()}
  try{sessionStorage.setItem(applicationIntentKey(userId,org),JSON.stringify(intent))}catch{setError('Não foi possível preparar o envio neste navegador. Tente novamente.');return}
  setPending(intent);send(intent)
 }
 if(!org||!userId)return <main className="page"><p role="status">Esta conta não tem uma entidade associada para acompanhar candidaturas.</p></main>
 const choosePage=value=>{setCursor(value);setData(null);setSelection(null)}
 const otherStates=Object.keys(LABEL).filter(code=>!primaryApplicationStatuses.includes(code))
 const stateDot=code=><span aria-hidden="true" className="state-dot" data-state={code}/>
 const stateButton=code=><button key={code} aria-pressed={status===code} className="state-option" onClick={()=>filter({status:status===code?'':code})}>{stateDot(code)}<span>{LABEL[code]}</span><span className="pill-count">{data?data.countsByStatus[code]??0:'—'}</span></button>
 return <main className="page application-browse"><ApplicationAreaHeader organization={organization} title="Candidaturas"><Link className="btn btn-primary" to="/catalogo" title="Escolher uma oportunidade para iniciar a candidatura"><Plus size={17} aria-hidden="true"/>Nova candidatura</Link></ApplicationAreaHeader>
  {pending&&<p role="status">Existe um envio por confirmar. <button className="btn btn-outline" disabled={busy} onClick={()=>send(pending)}>Repetir o mesmo envio</button></p>}
  {notice&&<p role="status">{notice}</p>}
  <FilterBar aria-label="Filtros de candidaturas"><label className="filter-search">Pesquisar candidaturas<SearchInput aria-label="Pesquisar candidaturas" placeholder="Pesquisar candidatura, oportunidade ou responsável…" value={q} maxLength={200} onChange={e=>filter({q:e.target.value})}/></label>
   <label>Departamento / Unidade<select value={unitId} disabled={loading||!data} onChange={e=>filter({unitId:e.target.value})}><option value="">Todas as unidades</option><option value="NONE">Sem unidade atribuída</option>{unitId&&unitId!=='NONE'&&!units.some(unit=>unit.unitId===unitId)&&<option value={unitId}>Unidade selecionada</option>}{units.map(unit=><option key={unit.unitId} value={unit.unitId}>{unitLabel(unit,units)}{unit.lifecycle==='ARCHIVED'?' (arquivada)':''}</option>)}</select></label>
   {(q||status||opportunityId||unitId)&&<button className="btn btn-secondary" onClick={()=>filter({q:'',status:'',oportunidade:'',opportunityId:'',unitId:''})}>Limpar filtros</button>}
<div className="application-state-heading"><span>Estado</span><InfoTooltip label="Informação sobre as contagens">As contagens incluem todos os estados e respeitam os restantes filtros.</InfoTooltip></div><div className="state-legend">{primaryApplicationStatuses.map(stateButton)}</div>
   <details className="application-other-states" open={otherStates.includes(status)||undefined}><summary>Outros estados</summary><div className="state-legend">{otherStates.map(stateButton)}</div></details>
     <details className="application-mobile-sort filter-wide"><summary>Ordenação</summary><div><label>Ordenar por <select aria-label="Ordenar por" value={sort} onChange={e=>filter({sort:e.target.value})}>{columns.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Ordem <select aria-label="Ordem" value={direction} onChange={e=>filter({direction:e.target.value})}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></label></div></details></FilterBar>
  {(q||status||unitId||opportunityId)&&<section className="application-active-filters" aria-label="Filtros aplicados"><strong>Filtros aplicados:</strong>{q&&<button type="button" onClick={()=>filter({q:''})} aria-label="Remover filtro de pesquisa">Pesquisa: {q} ×</button>}{status&&<button type="button" onClick={()=>filter({status:''})} aria-label="Remover filtro de estado">Estado: {LABEL[status]||status} ×</button>}{unitId&&<button type="button" onClick={()=>filter({unitId:''})} aria-label="Remover filtro de unidade">Unidade: {unitId==='NONE'?'Sem unidade atribuída':units.find(u=>u.unitId===unitId)?unitLabel(units.find(u=>u.unitId===unitId),units):'Selecionada'} ×</button>}{opportunityId&&<button type="button" onClick={()=>filter({oportunidade:'',opportunityId:''})} aria-label="Remover filtro de oportunidade">Oportunidade selecionada ×</button>}</section>}


  {selection&&!pending&&<FormModal title={`Alterar estado: ${selection.row.title}`} onClose={()=>setSelection(null)} returnFocusRef={statusTrigger}>
   <form className="application-transition" onSubmit={transition}>
    <p>Estado atual: <strong>{LABEL[selection.row.status]}</strong></p>
    <label>Novo estado<select required value={selection.status} onChange={e=>setSelection({...selection,status:e.target.value})}>
     <option value="" disabled>Selecionar estado</option>
     {selection.row.allowedTransitions.map(status=><option key={status} value={status}>{LABEL[status]}</option>)}
    </select></label>
    {selection.status==='SUBMITTED'&&<p>Este registo não envia a candidatura ao financiador.</p>}
    <label>Motivo<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={()=>setSelection(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy||!selection.status||!reason.trim()}>Confirmar alteração</button></div>
   </form>
  </FormModal>}
  {error&&<div role="alert"><p>{error}</p><button className="btn btn-outline" onClick={()=>{setCursor(null);setRefresh(n=>n+1)}}>Recarregar primeira página</button></div>}
  <div className="table-meta" aria-live="polite">{loading?'A carregar candidaturas…':data?`${data.total} candidatura${data.total===1?'':'s'}`:''}</div>
  <ApplicationsTable scrollLabel="Tabela de candidaturas"><colgroup>{columns.map(([key])=><col key={key}/>)}<col/></colgroup><thead role="rowgroup"><tr role="row">{columns.map(([key,label])=><th role="columnheader" scope="col" key={key} aria-label={label} aria-sort={sort===key?(direction==='asc'?'ascending':'descending'):'none'}><button className="application-sort" onClick={()=>filter({sort:key,direction:sort===key&&direction==='asc'?'desc':'asc'})}>{label}<SortIcon active={sort===key} dir={direction}/></button></th>)}<th role="columnheader" scope="col">Ações</th></tr></thead>
   <tbody role="rowgroup">{loading&&!data&&<tr role="row"><td role="cell" colSpan={9} className="application-list-loading">A obter candidaturas e filtros…</td></tr>}{data?.items.map(row=><tr role="row" key={row.applicationId} className="application-state-row" data-status={row.status}>
    <td role="cell" data-label="Título" className="col-title"><div className="application-title-cell"><Link className="application-title-link" aria-label={row.title} to={applicationDetailTarget(row.applicationId,returnTo)}><strong>{row.title}</strong></Link>{row.units?.length>0&&<p>{row.units.map(unit=>unitLabel(unit,row.units)).join('; ')}</p>}<ApplicationListPriority row={row} target={applicationDetailTarget(row.applicationId,returnTo)}/></div></td>
    <td role="cell" data-label="Oportunidade"><Link to={`${row.origin==='CENTRAL'?'/catalogo':'/oportunidades'}/${row.opportunityId}`}>{row.opportunityTitle||'—'}</Link></td>
    <td role="cell" data-label="Estado">{row.allowedTransitions?.length?<button type="button" aria-haspopup="dialog" aria-label={`Estado de ${row.title}`} className={`status-select ${CHIP[row.status]||'chip-grey'}`} disabled={busy||Boolean(pending)} onClick={e=>{statusTrigger.current=e.currentTarget;setSelection({row,status:''});setReason('')}}>{stateDot(row.status)}{LABEL[row.status]}</button>:<span className={`chip ${CHIP[row.status]||'chip-grey'}`}>{stateDot(row.status)}{LABEL[row.status]}</span>}</td>
    <td role="cell" data-label="Data do estado">{dateLabel(row.statusChangedAt)}</td><td role="cell" data-label="Responsável">{row.responsibleName||'—'}</td><td role="cell" data-label="Orç. total" className="application-money">{budgetLabel(row.totalBudget)}</td><td role="cell" data-label="Orç. organização" className="application-money">{budgetLabel(row.organizationBudget)}</td><td role="cell" data-label="Prazo da oportunidade">{dateLabel(row.opportunityClosingDate)}</td>
    <td role="cell" data-label="Ações"><Link className="application-open-action" aria-label={`Abrir candidatura ${row.title}`} to={applicationDetailTarget(row.applicationId,returnTo)}>Abrir <ArrowRight size={16} aria-hidden="true"/></Link></td>
   </tr>)}</tbody></ApplicationsTable>
  {data&&!data.items.length&&<EmptyStatePanel title={q||status||opportunityId||unitId?'Nenhuma candidatura nesta seleção.':'Ainda não existem candidaturas registadas.'} description={q||status||opportunityId||unitId?'Altere a pesquisa ou remova os filtros para ver as candidaturas acessíveis.':'Consulte os interesses da organização para iniciar uma candidatura.'} actionLabel={q||status||opportunityId||unitId?'Ver todas as candidaturas':'Consultar interesses'} actionTo={q||status||opportunityId||unitId?'/candidaturas':'/candidaturas?ver=interesses'}/>}
  {data && (data.total > 0 || data.previousCursor) && <nav className="pagination" aria-label="Paginação de candidaturas"><button className="btn btn-secondary" disabled={!data.previousCursor||loading} onClick={()=>choosePage(data.previousCursor)}>Anterior</button><span>{data.total > 0 ? `Página ${data.page} de ${Math.ceil(data.total/data.pageSize)}` : 'Sem resultados nesta página'}</span><button className="btn btn-secondary" disabled={!data.nextCursor||loading} onClick={()=>choosePage(data.nextCursor)}>Seguinte</button></nav>}
 </main>
}
