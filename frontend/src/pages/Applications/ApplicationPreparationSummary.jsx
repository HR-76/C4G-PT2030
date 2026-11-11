import { dateLabel } from './lifecycle'
import InfoTooltip from '../../components/InfoTooltip'
import './application-preparation.css'
const sourceMessage={loading:'A consultar…',unavailable:'Consulta indisponível. Consulte a secção para recuperar o acesso ou repetir.',pending:'Existe um envio por confirmar. Resolva-o na secção correspondente.',updating:'A atualizar os dados…'}
const localDay=()=>{const day=new Date();return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`}
function SourceState({source}){return <p className="text-muted">{sourceMessage[source?.state]||sourceMessage.loading}</p>}

function AttentionItem({kind,label,detail,href,children}){
 return <li className="preparation-item" data-kind={kind}>
  <div>
   <strong className="preparation-item-label">{label}</strong>
   {detail&&<span className="preparation-item-detail">{detail}</span>}
  </div>
  <a href={href}>{children}</a>
 </li>
}

export default function ApplicationPreparationSummary({work,documents,responsibles=[],today=localDay()}){
 const team=work?.state==='ready'?work.data:null,docs=documents?.state==='ready'?documents.data:null
 const participants=team?.participants.filter(item=>item.active)||[]
 const tasks=(team?.tasks||[]).filter(item=>item.status==='OPEN').slice().sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999')||a.taskId.localeCompare(b.taskId))
 const unavailable=docs?.documents.filter(item=>!item.usable)||[]
 const reviews=docs?.reviews||[],current=reviews.filter(item=>!item.stale&&!item.documentsRestricted)
 const changes=current.filter(item=>item.decision==='CHANGES_REQUESTED'),waiting=current.filter(item=>!item.decision)
 const stale=reviews.filter(item=>item.stale).length,restricted=reviews.filter(item=>item.documentsRestricted).length
 const overdue=tasks.filter(task=>task.deadline&&task.deadline<today)
 const upcoming=tasks.filter(task=>!task.deadline||task.deadline>=today)
 const hasAttention=overdue.length+changes.length+unavailable.length+waiting.length>0
 const incomplete=!team||!docs||Boolean(team.taskNextCursor||docs.reviewsNextCursor||restricted)
 return <section className="detail-section preparation-summary" aria-label="Resumo de preparação">
  <div className="preparation-heading"><h2>Resumo de preparação</h2><InfoTooltip label="Sobre o resumo de preparação">Preparação interna; não confirma elegibilidade ou prontidão para submissão.</InfoTooltip></div>
  <section className="preparation-priorities" aria-labelledby="preparation-priorities-title">
   <h3 id="preparation-priorities-title">A tratar</h3>
   {hasAttention&&<ul className="preparation-items" role="list">
    {overdue.slice(0,3).map(task=>{
     const responsible=[...(work?.data?.members||[]),...responsibles].find(person=>person.membershipId===task.responsibleMembershipId)?.name
     const detail=[responsible,`Prazo: ${dateLabel(task.deadline)}`].filter(Boolean).join(' · ')
     return <AttentionItem key={task.taskId} kind="overdue" label="Prazo ultrapassado" detail={detail} href={`#tarefa-${task.taskId}`}>{task.title}</AttentionItem>
    })}
    {changes.slice(0,3).map(review=>{
     const [version]=review.documents||[]
     const document=review.documents?.length===1&&docs.documents.find(item=>item.documentId===version.documentId&&item.versionId===version.versionId)
     return <AttentionItem key={review.requestId} kind="changes" label="Alterações solicitadas" detail={document?.filename} href={`#revisao-${review.requestId}`}>Rever alterações solicitadas</AttentionItem>
    })}
    {unavailable.slice(0,3).map(item=><AttentionItem key={item.documentId} kind="document" label="Versão indisponível" href={`#documento-${item.documentId}`}>{item.filename||'Consultar documento'}</AttentionItem>)}
    {waiting.slice(0,3).map(review=><AttentionItem key={review.requestId} kind="review" label="Revisão pendente" detail={review.requestedAt&&dateLabel(review.requestedAt)} href={`#revisao-${review.requestId}`}>Consultar pedido de revisão</AttentionItem>)}
   </ul>}
   {overdue.length>3&&<p><a href="#equipa-tarefas">Ver todas as tarefas em atraso</a></p>}
   {(changes.length>3||unavailable.length>3||waiting.length>3)&&<p><a href="#documentos-revisao">Ver todas as pendências documentais</a></p>}
   {incomplete&&<p className="preparation-incomplete" role="status">A lista de pendências pode estar incompleta. Consulte o estado das secções abaixo.</p>}
   {!hasAttention&&!incomplete&&<p className="preparation-clear" role="status">Sem pendências de preparação a tratar.</p>}
  </section>
  <div className="preparation-grid">
   <section className="preparation-card" aria-label="Preparação da equipa"><h3>Equipa</h3>
    {team?<><p>Participantes ativos: {participants.length}.</p>{team.participantNextCursor&&<p>Há mais participantes por carregar.</p>}{!participants.length&&!team.participantNextCursor&&<p>Sem participantes associados.</p>}</>:<SourceState source={work}/>}
    <a href="#equipa-tarefas">Consultar equipa</a>
   </section>
   <section className="preparation-card" aria-label="Preparação das tarefas"><h3>Tarefas</h3>
    {team?<><p>Tarefas abertas: {tasks.length}.</p>{team.taskNextCursor&&<p>Há mais tarefas por carregar.</p>}
     {upcoming.length>0&&<ul>{upcoming.slice(0,3).map(task=><li key={task.taskId}><a href={`#tarefa-${task.taskId}`}>{task.title}</a><span>Prazo: {dateLabel(task.deadline)}</span></li>)}</ul>}
     {upcoming.length>3&&<p>Mais {upcoming.length-3} tarefas abertas na secção.</p>}
     {!tasks.length&&<p>Sem tarefas abertas nos dados carregados.</p>}
    </>:<SourceState source={work}/>}
    <a href="#equipa-tarefas">Consultar tarefas e responsáveis</a>
   </section>
   <section className="preparation-card" aria-label="Preparação dos documentos"><h3>Documentos e revisão</h3>
    {docs?<><p>Versões associadas: {docs.documents.length} · Indisponíveis: {unavailable.length}.</p>
     {!docs.documents.length&&<p>Sem documentos associados.</p>}
     <p>Revisões: {waiting.length} pendentes · {changes.length} com alterações solicitadas.</p>
     {stale>0&&<p>{stale} pedido(s) desatualizado(s); consultar as versões atuais.</p>}
     {restricted>0&&<p>{restricted} pedido(s) com acesso limitado; confirmar na secção documental.</p>}
     {docs.reviewsNextCursor&&<p>Há mais pedidos de revisão por carregar.</p>}
    </>:<SourceState source={documents}/>}
    <a href="#documentos-revisao">Consultar documentos e revisão</a>
   </section>
  </div>
 </section>
}
