import BillingPdf from './BillingPdf'
import SearchInput from '../../components/SearchInput'
import {useEffect,useMemo,useState} from 'react'
import {Link,useParams,useSearchParams} from 'react-router-dom'
import {ReceiptText,ArrowLeft} from 'lucide-react'
import {useAuth} from '../../contexts/AuthContext'
import {customerBillingApi} from '../../api/api'
import {formatMoney,formatDate,formatInstant,paymentStates,paymentMethods,documentStates,documentTypes} from '../Platform/billingPresentation'
import '../Platform/platform-billing.css'
import './customer-billing.css'

export default function CustomerBilling({history=false}){
  const {user,organization}=useAuth()
  if(!organization || user?.platformRoles?.includes('C4G_ADMIN')) return <p role="alert">Esta área está disponível para utilizadores autorizados da entidade.</p>
  return <CustomerBillingView key={`${user.id}:${organization.id}`} organizationId={organization.id} history={history}/>
}
function message(error){
  const status=error?.response?.status
  return status===403?'Não tem permissão para consultar a faturação desta entidade.':status===404?'Esta fatura não está disponível.':status===401||status===409?'A sessão ou o acesso mudou. Atualize a página.':'Não foi possível carregar a faturação. Tente novamente.'
}
export function CustomerBillingView({organizationId,api:providedApi,history=false}){
  const api=useMemo(()=>providedApi||customerBillingApi(organizationId),[providedApi,organizationId])
  const {id}=useParams(),[params,setParams]=useSearchParams(),query=params.toString()
  const [result,setResult]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0)
  const requestKey=`${organizationId}:${id||''}:${query}:${reload}`
  useEffect(()=>{
    const controller=new AbortController();setResult(null);setError('')
    const work=id?api.invoice(id,controller.signal):Promise.all([api.invoices(Object.fromEntries(new URLSearchParams(query)),controller.signal),api.summary(controller.signal)])
    Promise.resolve(work).then(value=>{if(!controller.signal.aborted)setResult({key:requestKey,data:id?value.data:{list:value[0].data,summary:value[1].data}})})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e))})
    return()=>controller.abort()
  },[api,id,query,requestKey])
  const data=result?.key===requestKey?result.data:null
  const page=delta=>{const next=new URLSearchParams(params);next.set('page',String(data.list.page+delta));setParams(next)}
  return <div className="platform-billing customer-billing">
    <header className="customer-billing-heading"><div><span className="customer-billing-eyebrow"><ReceiptText size={16}/> CONTA DA ENTIDADE</span><h1>{id?'Detalhe da fatura':history?'Histórico de faturação':'Faturação'}</h1><p>{history?'Consulte e filtre as faturas da entidade.':'Resumo financeiro e documentos da sua entidade.'}</p></div>{id?<Link className="btn btn-outline" to="/faturacao/historico"><ArrowLeft size={16}/>Todas as faturas</Link>:<Link className="btn btn-outline" to={history?"/faturacao":"/faturacao/historico"}>{history?"Faturação":"Histórico de faturação"}</Link>}</header>
    {error?<div className="billing-error" role="alert">{error} <button className="btn btn-outline" onClick={()=>setReload(n=>n+1)}>Tentar novamente</button></div>:!data?<p role="status">A carregar faturação…</p>:id?<InvoiceDetail data={data} organizationId={organizationId}/>:<>
      {!history&&<section className="billing-ledger" aria-label="Resumo da conta">{data.summary.currencies.length?data.summary.currencies.map(row=><article key={row.currency}><header><strong>{row.currency}</strong><span>Conta corrente · todos os períodos</span></header><dl>{[['Faturado',row.billedAmount],['Pago',row.paidAmount],['Por pagar',row.balanceAmount],['Em atraso',row.overdueAmount]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatMoney(value,row.currency)}</dd></div>)}</dl></article>):<p>Ainda não existem valores faturados.</p>}</section>}
      {!history&&<div className="billing-enterprise-panels"><section><h2>Fatura em destaque</h2>{data.list.items[0]?<><p>Primeiro resultado da lista</p><Link to={`/faturacao/${data.list.items[0].cycleId}`}>Ver detalhe da fatura</Link><p>{data.list.items[0].number} · {data.list.items[0].serviceDescription}</p></>:<p>Não existem faturas para apresentar.</p>}</section><section><h2>Histórico de faturação</h2><p>Consulte as faturas, os respetivos estados e documentos.</p><Link className="btn btn-outline" to="/faturacao/historico">Consultar histórico</Link></section></div>}
      <InvoiceFilters key={query} params={params} onApply={values=>setParams(values)}/>
      <p className="billing-result" role="status">{data.list.total} {data.list.total===1?'fatura encontrada':'faturas encontradas'}</p>
      {data.list.items.length?<div className="customer-billing-table" tabIndex={0} role="region" aria-label="Faturas"><table><thead><tr>{['Fatura / Serviço','Período','Emissão / Vencimento','Total','Pago','Por pagar','Estado'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.list.items.map(row=><tr key={row.cycleId}>
        <td><Link to={`/faturacao/${row.cycleId}`}>{row.number}</Link><small>{row.serviceDescription}</small></td><td>{formatDate(row.periodStart)}<small>até {formatDate(row.periodEnd)}</small></td><td>{formatDate(row.issueDate)}<small>Vence {formatDate(row.dueDate)}</small></td><td>{formatMoney(row.total,row.currency)}</td><td>{formatMoney(row.paidAmount,row.currency)}</td><td>{formatMoney(row.balanceAmount,row.currency)}</td><td><FinancialState value={row.paymentState} fiscal={row.documentState} overdue={row.overdue}/></td>
      </tr>)}</tbody></table></div>:<section className="billing-empty"><h2>{query?'Nenhuma fatura corresponde aos filtros':'Ainda não existem faturas'}</h2><p>{query?'Altere os critérios de pesquisa.':'As faturas registadas pela C4G ficarão disponíveis aqui.'}</p></section>}
      <nav className="billing-pagination" aria-label="Paginação de faturas"><button className="btn btn-secondary" disabled={data.list.page<=1} onClick={()=>page(-1)}>Anterior</button><span>Página {data.list.page}</span><button className="btn btn-secondary" disabled={data.list.page*data.list.pageSize>=data.list.total} onClick={()=>page(1)}>Seguinte</button></nav>
    </>}
    <p className="customer-billing-origin">Informação registada manualmente pela C4G.</p>
  </div>
}
function FinancialState({value,fiscal,overdue}){
  if(fiscal==='CANCELLED'||fiscal==='CREDITED')return <span className="billing-status">{documentStates[fiscal]}</span>
  return <><span className={`billing-status billing-status-${String(value).toLowerCase()}`}>{paymentStates[value]||value}</span>{overdue&&<span className="billing-status billing-status-overdue">Em atraso</span>}</>
}
function InvoiceFilters({params,onApply}){
  return <form className="customer-billing-filters" onSubmit={event=>{event.preventDefault();onApply(Object.fromEntries([...new FormData(event.currentTarget)].filter(([,value])=>value)))}}>
    <label>Fatura ou serviço<SearchInput name="q" maxLength={120} placeholder="Número da fatura ou serviço" defaultValue={params.get('q')||''}/></label>
    <label>Emissão desde<input name="from" type="date" defaultValue={params.get('from')||''}/></label>
    <label>Emissão até<input name="to" type="date" defaultValue={params.get('to')||''}/></label>
    <label>Pagamento<select name="paymentStatus" defaultValue={params.get('paymentStatus')||''}><option value="">Todos</option>{Object.entries(paymentStates).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Moeda<input name="currency" maxLength={3} pattern="[A-Z]{3}" placeholder="EUR" defaultValue={params.get('currency')||''}/></label>
    <div><button className="btn btn-primary" type="submit">Filtrar</button><button className="btn btn-secondary" type="button" onClick={()=>onApply({})}>Limpar</button></div>
  </form>
}
function InvoiceDetail({data,organizationId}){
  return <>
    <section className="billing-section"><header><h2>{data.serviceDescription}</h2><FinancialState value={data.paymentState} fiscal={data.documents.find(d=>['INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT'].includes(d.type))?.state} overdue={data.overdue}/></header>
      <p>{formatDate(data.periodStart)} — {formatDate(data.periodEnd)}</p><p><strong>{data.account.legalName}</strong> · NIF {data.account.taxIdentifier}</p>
      <dl className="customer-billing-totals">{[['Total após correções',data.adjustedTotal],['Pago',data.paidAmount],['Por pagar',data.balanceAmount]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatMoney(value,data.currency)}</dd></div>)}</dl>
    </section>
    <section className="billing-section"><header><h2>Documentos</h2></header><div className="billing-record-list">{data.documents.map(document=><article key={document.id}><div><strong>{documentTypes[document.type]} {document.number}</strong><span>{documentStates[document.state]} · Emissão {formatDate(document.issueDate)} · Vencimento {formatDate(document.dueDate)}</span><BillingPdf documentId={document.id} organizationId={organizationId}/></div><strong>{formatMoney(document.total,document.currency)}</strong></article>)}</div></section>
    <section className="billing-section"><header><h2>Pagamentos e estornos</h2></header>{data.payments.length?<div className="billing-record-list">{data.payments.map(payment=><article key={payment.id}><div><strong>{payment.recordType==='REVERSAL'?'Estorno':paymentMethods[payment.methodCode]||'Pagamento'}</strong><span>Data efetiva: {formatDate(payment.effectiveOn)}</span><small>Registado pela C4G em {formatInstant(payment.createdAt)}</small></div><strong>{payment.recordType==='REVERSAL'?'− ':''}{formatMoney(payment.amount,payment.currency)}</strong></article>)}</div>:<p>Ainda não existem pagamentos registados.</p>}</section>
  </>
}
