import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'
import LoadingIndicator from '../../components/LoadingIndicator'
import {useEffect,useState} from 'react'
import {RefreshCw} from 'lucide-react'
import {platformDirectoryApi} from '../../api/api'
import {useAuth} from '../../contexts/AuthContext'
import InfoTooltip from '../../components/InfoTooltip'
import './platform-directory.css'
import './directory-workspace.css'

const date=value=>new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'medium',timeZone:'Europe/Lisbon'}).format(new Date(value))
export default function PlatformLogs(){const {user}=useAuth();return <LogsView key={user?.id}/>}
export function LogsView({api=platformDirectoryApi}){
 const [q,setQ]=useState(''),[type,setType]=useState(''),[query,setQuery]=useState({page:'1'}),[revision,setRevision]=useState(0)
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true)
 useEffect(()=>{
  let active=true;const controller=new AbortController();setBusy(true);setData(null);setError('')
  api.logs(query,controller.signal).then(r=>{if(active)setData(r.data)}).catch(e=>{if(active)setError(e.response?.status===403?'Esta área está reservada à administração C4G.':'Não foi possível consultar os logs. Tente novamente.')}).finally(()=>{if(active)setBusy(false)})
  return()=>{active=false;controller.abort()}
 },[api,query,revision])
 return <div className="page platform-directory directory-workspace platform-logs">
  <div className="directory-heading"><div className="heading-with-info"><h1>Logs</h1>{data&&<InfoTooltip label="Informação sobre os logs">{data.activatedAt&&`Registos desde ${date(data.activatedAt)}. `}Não inclui erros do serviço de autenticação.</InfoTooltip>}</div>
   <button className="btn btn-outline" disabled={busy} onClick={()=>setRevision(r=>r+1)}><RefreshCw size={16} aria-hidden="true"/> Atualizar</button></div>
  <section className="directory-register" aria-label="Registos da plataforma">
  <div className="directory-register-heading"><h2>Registos da plataforma</h2><p>Consulte entradas e erros registados.</p></div>
  <FilterBar as="form" variant="integrated" className="directory-filters" onSubmit={e=>{e.preventDefault();setQuery({q:q.trim(),type,page:'1'})}}>
   <label className="filter-search">Utilizador<SearchInput placeholder="Nome ou email" maxLength={150} value={q} onChange={e=>setQ(e.target.value)}/></label>
   <label>Tipo<select value={type} onChange={e=>setType(e.target.value)}><option value="">Todos</option><option value="LOGIN">Entradas</option><option value="ERROR">Erros</option></select></label>
   <button className="btn btn-primary" type="submit">Aplicar filtros</button><button className="btn btn-secondary" type="button" onClick={()=>{setQ('');setType('');setQuery({page:'1'})}}>Limpar filtros</button>
  </FilterBar>
  {busy&&<LoadingIndicator>A consultar os logs…</LoadingIndicator>}
  {error&&<div role="alert" className="alert alert-error">{error}</div>}
  {data&&<>
   {data.collection?.failedEvents>0&&<div role="alert" className="alert alert-error">A recolha encontrou uma falha. Podem faltar registos deste período; contacte o suporte C4G.</div>}
   <p className="directory-result" role="status">{data.total} {data.total===1?'registo encontrado':'registos encontrados'}</p>
   {data.items.length?<div className="table-wrap"><table role="table" className="data-table mobile-card-table directory-table"><caption className="sr-only">Entradas e erros da plataforma</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Utilizador</th><th role="columnheader" scope="col">Data e hora</th><th role="columnheader" scope="col">Tipo</th><th role="columnheader" scope="col">Descrição</th></tr></thead><tbody role="rowgroup">{data.items.map(row=><tr role="row" key={row.id}>
    <td role="cell" data-label="Utilizador"><div><strong>{row.name||row.email||'Não identificado'}</strong>{row.email&&<small>{row.email}</small>}</div></td>
    <td role="cell" data-label="Data e hora"><time dateTime={row.occurredAt}>{date(row.occurredAt)}</time></td>
    <td role="cell" data-label="Tipo"><span className={`directory-status directory-status-${row.type==='LOGIN'?'active':'suspended'}`}>{row.type==='LOGIN'?'Entrada':'Erro'}</span></td>
    <td role="cell" data-label="Descrição">{row.description}{row.httpStatus&&<small>HTTP {row.httpStatus}</small>}</td>
   </tr>)}</tbody></table></div>:<div className="directory-empty"><h2>Sem registos</h2><p>{query.q||query.type?'Altere a pesquisa ou limpe os filtros.':'As próximas entradas e erros aparecerão aqui.'}</p></div>}
   <nav className="directory-pagination" aria-label="Paginação"><button className="btn btn-secondary" disabled={data.page<=1} onClick={()=>setQuery({...query,page:String(data.page-1)})}>Anterior</button><span>Página {data.page}{data.total>0?` de ${Math.ceil(data.total/data.pageSize)}`:''}</span><button className="btn btn-secondary" disabled={data.page*data.pageSize>=data.total} onClick={()=>setQuery({...query,page:String(data.page+1)})}>Seguinte</button></nav>
  </>}
  </section>
 </div>
}
