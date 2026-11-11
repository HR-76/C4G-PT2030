import LoadingIndicator from '../../components/LoadingIndicator'
import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {RefreshCw,Building2,Users,Globe,Receipt,Database,ScrollText,Activity,AlertTriangle} from 'lucide-react'
import {useAuth} from '../../contexts/AuthContext'
import {platformDirectoryApi} from '../../api/api'
import InfoTooltip from '../../components/InfoTooltip'
import './platform-directory.css'
import './platform-dashboard.css'
import '../../dashboard-palette.css'

const number=v=>new Intl.NumberFormat('pt-PT').format(v)
const date=v=>new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Lisbon'}).format(new Date(v))
const states={ACTIVE:'Ativa',PROVISIONING:'Em preparação',SUSPENDED:'Suspensa',TERMINATING:'Em encerramento',ARCHIVED:'Arquivada'}
export default function PlatformDashboard(){const {user}=useAuth();return <DashboardView key={user?.id}/>}
export function DashboardView({api=platformDirectoryApi}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{let active=true;const controller=new AbortController();setBusy(true);setData(null);setError('')
  api.dashboard(controller.signal).then(r=>{if(active)setData(r.data)}).catch(e=>{if(active)setError(e.response?.status===403?'Esta área está reservada à administração C4G.':'Não foi possível carregar os indicadores. Tente atualizar o dashboard.')}).finally(()=>{if(active)setBusy(false)})
  return()=>{active=false;controller.abort()}
 },[api,revision])
 return <div className="page platform-directory platform-dashboard">
  <header className="directory-heading"><div className="heading-with-info"><h1>Dashboard C4G</h1>{data&&<InfoTooltip label="Informação sobre os indicadores">Atualizado em {date(data.observedAt)}.</InfoTooltip>}</div><button className="btn btn-outline" disabled={busy} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16} aria-hidden="true"/> Atualizar</button></header>
  {busy&&<LoadingIndicator className="admin-dashboard-message">A carregar os indicadores…</LoadingIndicator>}
  {error&&<div role="alert" className="alert alert-error">{error}</div>}
  {data&&<>
   <section className="admin-totals" aria-label="Totais da plataforma">
    <Metric title="Entidades" value={data.entities.total} detail={`${number(data.entities.active)} ${data.entities.active===1?'ativa':'ativas'}`} to="/administracao/entidades" Icon={Building2} tone="blue"/>
    <Metric title="Utilizadores" value={data.users.total} detail={`${number(data.users.active)} ${data.users.active===1?'conta ativa':'contas ativas'}`} to="/administracao/entidades/utilizadores" Icon={Users} tone="violet"/>
    <Metric title="Oportunidades" value={data.opportunities.total} detail="Catálogo central C4G" to="/catalogo" Icon={Globe} tone="sky"/>
   </section>
   <div className="admin-dashboard-grid">
    <OperationalStatus operational={data.operational}/>
    <section className="admin-panel admin-catalog"><div className="admin-panel-heading"><div className="heading-with-info"><h2>Estado do catálogo</h2><InfoTooltip label="Informação sobre o estado do catálogo">O estado do registo não indica se o prazo de candidatura está aberto.</InfoTooltip></div><Link to="/catalogo">Consultar catálogo</Link></div>
     <div className="admin-catalog-summary"><strong>{number(data.opportunities.total)}</strong><span>oportunidades no catálogo central</span></div>
     <div className="admin-catalog-distribution" aria-hidden="true">{[['active','Ativas'],['stale','Por atualizar'],['draft','Rascunhos'],['archived','Arquivadas']].map(([key])=><span key={key} className={`admin-bar-${key}`} style={{width:`${data.opportunities.total?100*data.opportunities[key]/data.opportunities.total:0}%`}}/>)}</div>
     <dl className="admin-catalog-legend">{[['active','Ativas'],['stale','Por atualizar'],['draft','Rascunhos'],['archived','Arquivadas']].map(([key,label])=><div key={key}><dt><span className={`admin-bar-${key}`} aria-hidden="true"/>{label}</dt><dd>{number(data.opportunities[key])}</dd></div>)}</dl>
     {data.opportunities.total===0&&<p>O catálogo ainda não tem oportunidades registadas.</p>}
    </section>
    <section className="admin-activity"><div className="heading-with-info"><h2>Atividade da plataforma</h2>{data.coverageStart&&<InfoTooltip label="Informação sobre a atividade">Histórico disponível desde {date(data.coverageStart)}.</InfoTooltip>}</div>
     {data.activity?<><dl><div><dt>Utilizadores com entrada <small>Últimos 30 dias</small></dt><dd>{number(data.activity.users30)}</dd></div><div><dt>Entradas na plataforma <small>Últimos 30 dias</small></dt><dd>{number(data.activity.logins30)}</dd></div><div className={data.activity.errors24>0?'admin-activity-errors':undefined}><dt>Erros registados <small>Últimas 24 horas</small></dt><dd>{number(data.activity.errors24)}</dd></div></dl>
      {data.collection?.failedEvents>0&&<p role="alert">A recolha teve falhas. Os indicadores de atividade podem estar incompletos.</p>}</>:<p>Os registos de atividade ainda não estão disponíveis.</p>}
     <Link to="/administracao/logs">Consultar logs</Link>
    </section>
    <section className="admin-panel admin-recent"><div className="admin-panel-heading"><h2>Entidades recentes</h2><Link to="/administracao/entidades">Gerir entidades</Link></div>
     {data.recentEntities.length?<div className="table-wrap"><table role="table" className="data-table mobile-card-table directory-table"><caption className="sr-only">Últimas cinco entidades criadas</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Entidade</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Criação</th></tr></thead><tbody role="rowgroup">{data.recentEntities.map(e=><tr role="row" key={e.id}><td role="cell" data-label="Entidade"><Link to={'/administracao/entidades/'+e.id}>{e.name}</Link></td><td role="cell" data-label="Estado"><span className={`directory-status directory-status-${e.status.toLowerCase()}`}>{states[e.status]||e.status}</span></td><td role="cell" data-label="Criação">{date(e.createdAt)}</td></tr>)}</tbody></table></div>:<p>Ainda não existem entidades. Comece por convidar o primeiro administrador em Entidades e utilizadores.</p>}
    </section>
    <section className="admin-shortcuts"><h2>Gestão da plataforma</h2>
     <Link to="/administracao/entidades"><Building2 aria-hidden="true" size={20} data-icon-tone="blue"/><div>Entidades e acessos <span>Criar convites e acompanhar a adesão</span></div></Link>
     <Link to="/administracao/faturacao"><Receipt aria-hidden="true" size={20} data-icon-tone="amber"/><div>Faturação <span>Acompanhar ciclos, documentos e pagamentos</span></div></Link>
     <Link to="/integracoes"><Database aria-hidden="true" size={20} data-icon-tone="violet"/><div>Fontes de oportunidades <span>Consultar recolhas e importações</span></div></Link>
     <Link to="/administracao/logs"><ScrollText aria-hidden="true" size={20} data-icon-tone="rose"/><div>Logs <span>Rever entradas e erros registados</span></div></Link>
    </section>
   </div>
  </>}
 </div>
}
function Metric({title,value,detail,to,Icon,tone}){return <Link className="admin-metric" to={to}><div><h2>{title}</h2><Icon size={21} aria-hidden="true" data-icon-tone={tone}/></div><strong>{number(value)}</strong><span>{detail}</span></Link>}
function OperationalStatus({operational}) {
 const d=operational?.dependencies,c=operational?.capacity
 const labels={READY:'disponível',DEGRADED:'degradado',UNAVAILABLE:'indisponível'}
 const status=labels[d?.status]||'dados indisponíveis'
 const tone=labels[d?.status]?d.status.toLowerCase():'unknown'
 const valid=c&&['total','idle','waiting','max'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)&&c.max>0
 return <section className="admin-panel operational-status" aria-labelledby="operational-title">
  <div className="operational-heading"><div className="operational-heading-icon" data-icon-tone="blue"><Activity size={20} aria-hidden="true"/></div><div><h2 id="operational-title">Estado operacional</h2><p>Visão do processo atual</p></div></div>
  <div className="operational-grid">
   <div className="operational-item"><span className="operational-label">Dependências</span><span className={`operational-badge operational-badge-${tone}`}><span aria-hidden="true"/>{status}</span></div>
   <div className="operational-item"><span className="operational-label">SLO</span><strong>Dados insuficientes</strong></div>
   <div className="operational-item operational-capacity"><span className="operational-label">Pool Central</span>{valid?<><strong>{number(c.total)} <span>de {number(c.max)} ligações</span></strong><p>{number(c.idle)} livres <span aria-hidden="true">·</span> {number(c.waiting)} em espera</p></>:<strong>Dados indisponíveis</strong>}</div>
  </div>
  {Array.isArray(d?.reasons)&&d.reasons.length>0&&<div className="operational-warning"><AlertTriangle size={16} aria-hidden="true"/><p><strong>Verificações com falhas</strong><span>{d.reasons.join(', ')}</span></p></div>}
  <p className="operational-footnote">Amostra pontual do processo; não cobre todos os serviços ou pools.</p>
 </section>
}
