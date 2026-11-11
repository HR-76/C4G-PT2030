import { Link } from 'react-router-dom'
import { dateLabel } from './lifecycle'
import { lisbonDay } from '../../api/organizationDashboard'

export default function ApplicationListPriority({ row, target }) {
 const summary=row.priorities
 if(!summary)return <p className="application-priority-muted">Pendências por consultar</p>
 const {tasks,documents}=summary
 const empty=tasks&&documents&&!documents.restricted&&tasks.open===0&&documents.pending===0&&documents.changes===0&&!tasks.next
 const overdue=tasks?.next && tasks.next<lisbonDay(new Date())
 const action=documents?.changes>0?['Rever alterações pedidas','#documentos-revisao']:
  tasks?.open>0?['Consultar tarefas','#equipa-tarefas']:
  documents?.pending>0?['Acompanhar revisão','#documentos-revisao']:null
 return <div className="application-list-priority">
  {!empty&&<div className="application-priority-tags">
   {tasks && <span className={overdue?'priority-overdue':''}>{tasks.open} tarefa{tasks.open===1?'':'s'} aberta{tasks.open===1?'':'s'}</span>}
   {documents && <><span>{documents.pending} documento{documents.pending===1?'':'s'} em revisão</span><span className={documents.changes?'priority-changes':''}>{documents.changes} com alterações pedidas</span></>}
  </div>}
  {tasks?.next && <p className={overdue?'priority-overdue-text':''}>Próximo prazo de tarefa: <strong>{dateLabel(tasks.next)}</strong>{overdue?' · Em atraso':''}</p>}
  {(!tasks||!documents||documents.restricted)&&<p className="application-priority-muted">Resumo limitado aos dados autorizados.</p>}
  {action?<Link className="application-priority-action" to={target+action[1]}>{action[0]} →</Link>:tasks&&documents&&!documents.restricted?<p className="application-priority-muted">Sem tarefas abertas ou revisões pendentes.</p>:null}
 </div>
}
