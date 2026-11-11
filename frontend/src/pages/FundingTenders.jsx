import {useEffect, useRef, useState} from 'react'
import {Globe, BookOpen, GraduationCap, Network, Map, RefreshCw} from 'lucide-react'
import {fundingTendersApi as api} from '../api/api'
import {useAuth} from '../contexts/AuthContext'
import InfoTooltip from '../components/InfoTooltip'
import './FundingTenders.css'

const sources = [
  {code:'EU_FUNDING_TENDERS',label:'EU Funding & Tenders',icon:Globe,description:'Oportunidades abertas e previstas de vários programas europeus.'},
  {code:'CORDIS',label:'CORDIS — Horizon Europe',icon:BookOpen,description:'Oportunidades Horizon Europe e EURATOM.'},
  {code:'ERASMUS',label:'Erasmus+',icon:GraduationCap,description:'Oportunidades do programa europeu de educação, formação, juventude e desporto.'},
  {code:'INTERREG_EUROPE',label:'Interreg Europe',icon:Network,description:'Chamadas gerais de 2021–2027. Não inclui chamadas restritas ou ações-piloto.',official:true},
  {code:'POCTEP',label:'Interreg POCTEP',icon:Map,description:'Oportunidades de cooperação transfronteiriça entre Portugal e Espanha.',official:true},
]
const states = {QUEUED:'Em fila',RUNNING:'A atualizar',SUCCESS:'Concluída',PARTIAL:'Cobertura parcial',ERROR:'Terminou com erros'}
const HISTORY_PAGE_SIZE = 10
const errorText = e => e?.response?.data?.error?.message || 'Não foi possível consultar a atualização. Tente novamente.'
const date = value => value ? new Date(value).toLocaleString('pt-PT') : '—'
const duration = run => run.startedAt && run.finishedAt ? Math.max(0,Math.round((new Date(run.finishedAt)-new Date(run.startedAt))/1000))+'s' : '—'

export default function FundingTenders() {
  const {user} = useAuth()
  const [historyPage,setHistoryPage] = useState(1)
  const [snapshot,setSnapshot] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false)
  const [fresh,setFresh] = useState(false), [refresh,setRefresh] = useState(0), [pending,setPending] = useState(false)
  const session = useRef({userId:user?.id,alive:true,intention:null,sending:false})
  if (session.current.userId !== user?.id) session.current = {userId:user?.id,alive:true,intention:null,sending:false}
  useEffect(() => {
    const owner=session.current; owner.alive=true
    setSnapshot(null);setError('');setBusy(false);setPending(false);setFresh(false);setHistoryPage(1)
    return () => {owner.alive=false}
  },[user?.id])
  useEffect(() => {
    const owner=session.current; let active=true,timer
    setFresh(false)
    async function load() {
      try {
        const response=await api.status()
        if (!active || !owner.alive || owner!==session.current) return
        setSnapshot({owner,value:response.data});setFresh(true);setError('')
        if (['QUEUED','RUNNING'].includes(response.data.lastRun?.status)) timer=setTimeout(load,1500)
        else if(response.data.worker) timer=setTimeout(load,15000)
      } catch(e) {if(active && owner.alive && owner===session.current){setFresh(false);setError(errorText(e))}}
    }
    load();return () => {active=false;clearTimeout(timer)}
  },[user?.id,refresh])
  const data=snapshot?.owner===session.current ? snapshot.value : null
  const historyPages=Math.max(1,Math.ceil((data?.runs?.length||0)/HISTORY_PAGE_SIZE))
  const currentHistoryPage=Math.min(historyPage,historyPages)
  useEffect(()=>{setHistoryPage(page=>Math.min(page,historyPages))},[historyPages])
  const visibleRuns=(data?.runs||[]).slice((currentHistoryPage-1)*HISTORY_PAGE_SIZE,currentHistoryPage*HISTORY_PAGE_SIZE)
  const workerUnavailable=Boolean(data?.worker&&!data.worker.ready)
  const run=data?.lastRun, running=['QUEUED','RUNNING'].includes(run?.status)
  const configured=['fixture','live-demo','live-local','live-rehearsal'].includes(data?.sourceMode)
  const enabled=data?.collection?.sources || ['EU_FUNDING_TENDERS']
  async function update(source) {
    const owner=session.current
    if(owner.sending || !fresh || !configured || (workerUnavailable&&!owner.intention) || !enabled.includes(source) || (owner.intention && owner.intention.source!==source) || (running && !owner.intention)) return
    owner.sending=true;owner.intention ||= {requestId:crypto.randomUUID(),source};setBusy(true);setError('')
    try {
      await api.update(owner.intention.requestId, owner.intention.source)
      if(!owner.alive || owner!==session.current) return
      owner.intention=null;setPending(false);setFresh(false);setRefresh(value=>value+1)
    } catch(e) {
      if(!owner.alive || owner!==session.current) return
      if([400,401,403,409].includes(e?.response?.status)||['FUNDING_WORKER_UNAVAILABLE','FUNDING_WORKER_UPGRADE_REQUIRED'].includes(e?.response?.data?.error?.code)) {owner.intention=null;setPending(false);setFresh(false)}
      else setPending(true)
      setError(errorText(e))
    } finally {owner.sending=false;if(owner.alive && owner===session.current)setBusy(false)}
  }
  return <div className="page funding-sources"><div className="funding-heading"><h1>Fontes de oportunidades</h1><button className="btn btn-outline" type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={14} aria-hidden="true"/>Consultar estado</button></div>
    {data?.worker&&<section className="funding-health" data-ready={data.worker.ready} aria-label="Saúde da recolha">
      <p role="status"><strong>{({PROCESSING:'Serviço de recolha operacional',OFFLINE:'Serviço de recolha indisponível',STANDBY:'Serviço de recolha em espera',STALLED:'Serviço de recolha sem progresso',DEGRADED:'Serviço de recolha com falhas',UNKNOWN:'Estado do serviço de recolha por confirmar',UPGRADE_REQUIRED:'O serviço de recolha precisa de atualização'})[data.worker.state]||'Estado do serviço de recolha por confirmar'}</strong></p>
      {workerUnavailable&&<p>As novas atualizações estão suspensas. Os pedidos já registados e as oportunidades anteriores estão preservados.</p>}
      <details><summary>Detalhes do serviço</summary><p>Último sinal do serviço: {date(data.worker.lastHeartbeatAt)}</p><p>Última verificação da fila: {date(data.worker.lastPollAt)}</p></details>
    </section>}
    {error && <div className="alert alert-error" role="alert">{error}{data && <p>Os dados abaixo correspondem à última consulta válida.</p>}</div>}
    {data?.sourceMode==='fixture' && <p role="status">Modo de teste: dados sintéticos, sem oportunidades reais.</p>}
    <div className="funding-source-grid">{sources.map(source => {
      const available=enabled.includes(source.code)
      const run=data?.lastRuns?.find(item=>item.source===source.code) || data?.runs?.find(item=>(item.source||'EU_FUNDING_TENDERS')===source.code)
      const complete=data?.lastCompleteRuns?.find(item=>(item.source||'EU_FUNDING_TENDERS')===source.code)
      const confirming=pending && session.current.intention?.source===source.code
      const status=!fresh ? 'Por confirmar' : !available ? 'Atualização indisponível' : !configured ? 'Configuração indisponível' : workerUnavailable ? 'Serviço indisponível' : confirming ? 'Pedido por confirmar' : running && (data.lastRun.source || 'EU_FUNDING_TENDERS') === source.code ? 'Atualização em curso' : 'Disponível'
      return <section key={source.code} className="funding-source-card" aria-label={source.label}>
        <div className="funding-card-body"><div className="funding-card-top"><span className="funding-card-icon"><source.icon size={21} aria-hidden="true"/></span><span className="funding-card-status" data-available={status === 'Disponível'}>{status}</span></div>
        <h3>{source.label}</h3><p className="funding-card-description">{source.description}</p>
        <dl className="funding-dates"><div><dt>Última execução</dt><dd>{date(run?.createdAt)}</dd></div><div><dt>Última recolha completa</dt><dd>{complete ? date(complete.finishedAt) : 'Por confirmar'}</dd></div></dl>
        </div><div className="funding-card-footer">
      {!available ? <button type="button" className="btn btn-outline" disabled>Atualização indisponível</button> : <>
        <div className="catalog-actions">
          <button className="btn btn-primary" type="button" disabled={!fresh||!configured||busy||(workerUnavailable&&!confirming)||(pending&&!confirming)||(running&&!confirming)} onClick={()=>update(source.code)}><RefreshCw size={14} aria-hidden="true"/>{busy ? 'A enviar…' : confirming ? 'Confirmar pedido anterior' : running ? 'Atualização em curso' : 'Atualizar agora'}</button>
        </div>
      </>}
    </div></section>})}</div>
    <section className="detail-section" aria-label="Histórico de sincronizações"><div className="heading-with-info"><h3>Histórico de sincronizações</h3>{data?.runsLimited&&<InfoTooltip label="Informação sobre o histórico">São mostradas apenas as 100 atualizações mais recentes.</InfoTooltip>}</div>
      <div className="table-wrap"><table role="table" className="data-table mobile-card-table" style={{tableLayout:'auto'}}>
        <thead role="rowgroup"><tr role="row">{['Data','Fonte','Estado','Registos','Criados','Atualizados','Sem alterações','Falhados','Duração'].map(label=><th role="columnheader" scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody role="rowgroup">{visibleRuns.map(item=><tr role="row" key={item.runId}>
          <td role="cell" className="td-notrunc" data-label="Data">{date(item.startedAt||item.createdAt)}</td><td role="cell" className="td-notrunc" data-label="Fonte">{sources.find(source=>source.code===(item.source||'EU_FUNDING_TENDERS'))?.label || 'Fonte indisponível'}</td>
          <td role="cell" className="td-notrunc" data-label="Estado">{states[item.status]||'Estado indisponível'}{item.limited&&!item.coverage && ' · recolha limitada'}{item.reviewed>0&&<small className="opportunity-source">{item.reviewed} {item.reviewed===1?'aguarda revisão':'aguardam revisão'}</small>}</td>
          <td role="cell" data-label="Registos">{item.received??'—'}{item.knownRefresh && <small className="opportunity-source">+ {['UPDATED','UNCHANGED','CONFLICT','ABSENT','ERROR','REVIEW'].reduce((sum,key)=>sum+(item.knownRefresh[key]||0),0)} conhecidos consultados</small>}</td><td role="cell" data-label="Criados">{item.created??'—'}</td><td role="cell" data-label="Atualizados">{item.updated == null ? '—' : item.updated+(item.knownRefresh?.UPDATED||0)}</td>
          <td role="cell" data-label="Sem alterações">{item.unchanged == null ? '—' : item.unchanged+(item.knownRefresh?.UNCHANGED||0)}</td><td role="cell" data-label="Falhados">{item.failed??'—'}{item.knownRefresh && <small className="opportunity-source">{['CONFLICT','ABSENT','ERROR'].reduce((sum,key)=>sum+(item.knownRefresh[key]||0),0)} por rever</small>}</td><td role="cell" data-label="Duração">{duration(item)}</td>
        </tr>)}</tbody>
      </table></div>
      {data?.runs?.length>0 && <nav className="pagination" aria-label="Paginação do histórico de sincronizações">
        <button type="button" className="btn btn-secondary" disabled={currentHistoryPage===1} onClick={()=>setHistoryPage(currentHistoryPage-1)}>Anterior</button>
        <span aria-live="polite">Página {currentHistoryPage} de {historyPages}</span>
        <button type="button" className="btn btn-secondary" disabled={currentHistoryPage===historyPages} onClick={()=>setHistoryPage(currentHistoryPage+1)}>Seguinte</button>
      </nav>}
      {!data && <p>{error?'Não foi possível carregar o histórico. Consulte novamente o estado.':'A carregar histórico…'}</p>}
      {data && !data.runs?.length && <p>Sem atualizações registadas.</p>}
    </section>
  </div>
}
