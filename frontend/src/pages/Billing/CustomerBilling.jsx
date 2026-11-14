import BillingValidationPanel from '../../components/BillingValidationPanel'
import BillingPdf from './BillingPdf'
import SearchInput from '../../components/SearchInput'
import {useEffect,useMemo,useState} from 'react'
import {Link,useParams,useSearchParams} from 'react-router-dom'
import {ReceiptText,ArrowLeft} from 'lucide-react'
import {useAuth} from '../../contexts/AuthContext'
import {customerBillingApi,organizationDirectoryApi} from '../../api/api'
import {readScope,startConfirmedRead} from '../../api/confirmedReads'
import {directoryCacheKey,readDirectoryCache} from '../Organization/directoryCache'
import {formatMoney,formatDate,formatInstant,paymentStates,paymentMethods,documentStates,documentTypes} from '../Platform/billingPresentation'
import {profileDifferences} from '../Platform/billingAccountPrefill'
import '../Platform/platform-billing.css'
import './customer-billing.css'

export default function CustomerBilling({history=false}){
  const {user,organization}=useAuth()
  if(!organization || user?.platformRoles?.includes('C4G_ADMIN')) return <p role="alert">Esta Ã¡rea estÃ¡ disponÃ­vel para utilizadores autorizados da entidade.</p>
  return <CustomerBillingView key={`${user.id}:${organization.id}`} organizationId={organization.id} history={history} scope={readScope(user.id,organization.id)} directoryKey={directoryCacheKey(user.id,organization.id)}/>
}
function message(error){
  const status=error?.response?.status
  return status===403?'NÃ£o tem permissÃ£o para consultar a faturaÃ§Ã£o desta entidade.':status===404?'Esta fatura nÃ£o estÃ¡ disponÃ­vel.':status===401||status===409?'A sessÃ£o ou o acesso mudou. Atualize a pÃ¡gina.':'NÃ£o foi possÃ­vel carregar a faturaÃ§Ã£o. Tente novamente.'
}
// Read-only. The entity profile is only compared; when it cannot be read there is no warning.
function BillingAccountSection({api,directoryApi,scope=null,directoryKey=null}){
  const [state,setState]=useState(()=>startConfirmedRead(scope,'billing-account').held)
  useEffect(()=>{
    const controller=new AbortController(),read=startConfirmedRead(scope,'billing-account');setState(read.held)
    // The entity profile the shell already confirmed is used for the comparison; it is asked for only when it is not in memory.
    const known=directoryKey?readDirectoryCache(directoryKey)?.context:null
    Promise.all([api.account(controller.signal).then(response=>({account:response.data.account}),()=>({failed:true})),known?Promise.resolve(known):directoryApi.context(controller.signal).then(response=>response.data,()=>null)])
      .then(([result,profile])=>{const value={...result,profile};if(result.failed)read.drop();else read.keep(value);if(!controller.signal.aborted)setState(value)})
    return()=>controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope and the directory key follow them.
  },[api,directoryApi])
  const account=state?.account,differences=account?profileDifferences(account,state.profile?.registration,state.profile?.organization?.legalName):[]
  const rows=account?[['DenominaÃ§Ã£o legal',account.legalName],['NIF / identificaÃ§Ã£o fiscal',account.taxIdentifier],['PaÃ­s fiscal',account.taxCountry],['Morada',[account.addressLine1,account.addressLine2].filter(Boolean).join(', ')],['CÃ³digo postal',account.postalCode],['Localidade',account.locality],['RegiÃ£o',account.region],['Email de faturaÃ§Ã£o',account.billingEmail],['Contacto',account.contactName]].filter(([,value])=>value):[]
  return <section className="billing-section customer-billing-account" aria-label="Dados de faturaÃ§Ã£o"><header><h2>Dados de faturaÃ§Ã£o</h2><span>SÃ³ consulta</span></header>
    {!state?<p className="billing-section-empty">A carregar dados de faturaÃ§Ã£oâ€¦</p>:state.failed?<p className="billing-section-empty">NÃ£o foi possÃ­vel carregar os dados de faturaÃ§Ã£o. As faturas continuam disponÃ­veis.</p>:!account?<p className="billing-section-empty">Os dados de faturaÃ§Ã£o ainda nÃ£o foram configurados pela C4G.</p>:<>
      <dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {differences.length>0&&<div className="alert alert-info" data-testid="billing-profile-difference"><strong>A ficha da entidade difere destes dados.</strong><ul>{differences.map(item=><li key={item.field}>{item.label}: ficha Â«{item.profile||'vazio'}Â»</li>)}</ul></div>}
      <p>A alteraÃ§Ã£o destes dados Ã© feita pela C4G.</p>
    </>}
  </section>
}
// With a `scope` the invoices, summary and account this user and organization last received are shown at once and read again.
export function CustomerBillingView({organizationId,api:providedApi,directoryApi:providedDirectoryApi,history=false,scope=null,directoryKey=null}){
  const api=useMemo(()=>providedApi||customerBillingApi(organizationId),[providedApi,organizationId])
  const directoryApi=useMemo(()=>providedDirectoryApi||organizationDirectoryApi(organizationId),[providedDirectoryApi,organizationId])
  const {id}=useParams(),[params,setParams]=useSearchParams(),validationOrganization=params.get('validarEntidade'),query=(() => { const filtered=new URLSearchParams(params);filtered.delete('validarEntidade');return filtered.toString() })()
  const [error,setError]=useState(''),[reload,setReload]=useState(0)
  const requestKey=`${organizationId}:${id||''}:${query}:${reload}`,readName=`billing:${id||''}:${query}`
  const [result,setResult]=useState(()=>{const held=startConfirmedRead(scope,readName).held;return held?{key:requestKey,data:held}:null})
  useEffect(()=>{
    const controller=new AbortController(),read=startConfirmedRead(scope,readName);setResult(read.held?{key:requestKey,data:read.held}:null);setError('')
    const work=id?api.invoice(id,controller.signal):Promise.all([api.invoices(Object.fromEntries(new URLSearchParams(query)),controller.signal),api.summary(controller.signal)])
    Promise.resolve(work).then(value=>{const data=id?value.data:{list:value[0].data,summary:value[1].data};read.keep(data);if(!controller.signal.aborted)setResult({key:requestKey,data})})
      .catch(e=>{if(!controller.signal.aborted){read.drop();setResult(null);setError(message(e))}})
    return()=>controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope and the read name follow them.
  },[api,id,query,requestKey])
  const data=result?.key===requestKey?result.data:null
  const page=delta=>{const next=new URLSearchParams(params);next.set('page',String(data.list.page+delta));setParams(next)}
  return <div className="platform-billing customer-billing">
    <header className="customer-billing-heading"><div><span className="customer-billing-eyebrow"><ReceiptText size={16}/> CONTA DA ENTIDADE</span><h1>{id?'Detalhe da fatura':history?'HistÃ³rico de faturaÃ§Ã£o':'FaturaÃ§Ã£o'}</h1><p>{history?'Consulte e filtre as faturas da entidade.':'Resumo financeiro e documentos da sua entidade.'}</p></div>{id?<Link className="btn btn-outline" to="/faturacao/historico"><ArrowLeft size={16}/>Todas as faturas</Link>:<Link className="btn btn-outline" to={history?"/faturacao":"/faturacao/historico"}>{history?"FaturaÃ§Ã£o":"HistÃ³rico de faturaÃ§Ã£o"}</Link>}</header>
    {error?<div className="billing-error" role="alert">{error} <button className="btn btn-outline" onClick={()=>setReload(n=>n+1)}>Tentar novamente</button></div>:!data?<p role="status">A carregar faturaÃ§Ã£oâ€¦</p>:id?<InvoiceDetail data={data} organizationId={organizationId}/>:<>
      {!history&&<section className="billing-ledger" aria-label="Resumo da conta">{data.summary.currencies.length?data.summary.currencies.map(row=><article key={row.currency}><header><strong>{row.currency}</strong><span>Conta corrente Â· todos os perÃ­odos</span></header><dl>{[['Faturado',row.billedAmount],['Pago',row.paidAmount],['Por pagar',row.balanceAmount],['Em atraso',row.overdueAmount]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatMoney(value,row.currency)}</dd></div>)}</dl></article>):<p>Ainda nÃ£o existem valores faturados.</p>}</section>}
      {!history&&<div className="billing-enterprise-panels"><section><h2>Fatura em destaque</h2>{data.list.items[0]?<><p>Primeiro resultado da lista</p><Link to={`/faturacao/${data.list.items[0].cycleId}`}>Ver detalhe da fatura</Link><p>{data.list.items[0].number} Â· {data.list.items[0].serviceDescription}</p></>:<p>NÃ£o existem faturas para apresentar.</p>}</section><section><h2>HistÃ³rico de faturaÃ§Ã£o</h2><p>Consulte as faturas, os respetivos estados e documentos.</p><Link className="btn btn-outline" to="/faturacao/historico">Consultar histÃ³rico</Link></section></div>}
      {!history&&<BillingValidationPanel key={organizationId} api={api} organizationId={organizationId} expectedOrganizationId={validationOrganization}/>}
      {!history&&<BillingAccountSection api={api} directoryApi={directoryApi} scope={scope} directoryKey={directoryKey}/>}
      <InvoiceFilters key={query} params={params} onApply={values=>setParams(values)}/>
      <p className="billing-result" role="status">{data.list.total} {data.list.total===1?'fatura encontrada':'faturas encontradas'}</p>
      {data.list.items.length?<div className="customer-billing-table" tabIndex={0} role="region" aria-label="Faturas"><table><thead><tr>{['Fatura / ServiÃ§o','PerÃ­odo','EmissÃ£o / Vencimento','Total','Pago','Por pagar','Estado'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.list.items.map(row=><tr key={row.cycleId}>
        <td><Link to={`/faturacao/${row.cycleId}`}>{row.number}</Link><small>{row.serviceDescription}</small></td><td>{formatDate(row.periodStart)}<small>atÃ© {formatDate(row.periodEnd)}</small></td><td>{formatDate(row.issueDate)}<small>Vence {formatDate(row.dueDate)}</small></td><td>{formatMoney(row.total,row.currency)}</td><td>{formatMoney(row.paidAmount,row.currency)}</td><td>{formatMoney(row.balanceAmount,row.currency)}</td><td><FinancialState value={row.paymentState} fiscal={row.documentState} overdue={row.overdue}/></td>
      </tr>)}</tbody></table></div>:<section className="billing-empty"><h2>{query?'Nenhuma fatura corresponde aos filtros':'Ainda nÃ£o existem faturas'}</h2><p>{query?'Altere os critÃ©rios de pesquisa.':'As faturas registadas pela C4G ficarÃ£o disponÃ­veis aqui.'}</p></section>}
      <nav className="billing-pagination" aria-label="PaginaÃ§Ã£o de faturas"><button className="btn btn-secondary" disabled={data.list.page<=1} onClick={()=>page(-1)}>Anterior</button><span>PÃ¡gina {data.list.page}</span><button className="btn btn-secondary" disabled={data.list.page*data.list.pageSize>=data.list.total} onClick={()=>page(1)}>Seguinte</button></nav>
    </>}
    <p className="customer-billing-origin">InformaÃ§Ã£o registada manualmente pela C4G.</p>
  </div>
}
function FinancialState({value,fiscal,overdue}){
  if(fiscal==='CANCELLED'||fiscal==='CREDITED')return <span className="billing-status">{documentStates[fiscal]}</span>
  return <><span className={`billing-status billing-status-${String(value).toLowerCase()}`}>{paymentStates[value]||value}</span>{overdue&&<span className="billing-status billing-status-overdue">Em atraso</span>}</>
}
function InvoiceFilters({params,onApply}){
  return <form className="customer-billing-filters" onSubmit={event=>{event.preventDefault();onApply(Object.fromEntries([...new FormData(event.currentTarget)].filter(([,value])=>value)))}}>
    <label>Fatura ou serviÃ§o<SearchInput name="q" maxLength={120} placeholder="NÃºmero da fatura ou serviÃ§o" defaultValue={params.get('q')||''}/></label>
    <label>EmissÃ£o desde<input name="from" type="date" defaultValue={params.get('from')||''}/></label>
    <label>EmissÃ£o atÃ©<input name="to" type="date" defaultValue={params.get('to')||''}/></label>
    <label>Pagamento<select name="paymentStatus" defaultValue={params.get('paymentStatus')||''}><option value="">Todos</option>{Object.entries(paymentStates).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Moeda<input name="currency" maxLength={3} pattern="[A-Z]{3}" placeholder="EUR" defaultValue={params.get('currency')||''}/></label>
    <div><button className="btn btn-primary" type="submit">Filtrar</button><button className="btn btn-secondary" type="button" onClick={()=>onApply({})}>Limpar</button></div>
  </form>
}
function InvoiceDetail({data,organizationId}){
  return <>
    <section className="billing-section"><header><h2>{data.serviceDescription}</h2><FinancialState value={data.paymentState} fiscal={data.documents.find(d=>['INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT'].includes(d.type))?.state} overdue={data.overdue}/></header>
      <p>{formatDate(data.periodStart)} â€” {formatDate(data.periodEnd)}</p><p><strong>{data.account.legalName}</strong> Â· NIF {data.account.taxIdentifier}</p>
      <dl className="customer-billing-totals">{[['Total apÃ³s correÃ§Ãµes',data.adjustedTotal],['Pago',data.paidAmount],['Por pagar',data.balanceAmount]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatMoney(value,data.currency)}</dd></div>)}</dl>
    </section>
    <section className="billing-section"><header><h2>Documentos</h2></header><div className="billing-record-list">{data.documents.map(document=><article key={document.id}><div><strong>{documentTypes[document.type]} {document.number}</strong><span>{documentStates[document.state]} Â· EmissÃ£o {formatDate(document.issueDate)} Â· Vencimento {formatDate(document.dueDate)}</span><BillingPdf documentId={document.id} organizationId={organizationId}/></div><strong>{formatMoney(document.total,document.currency)}</strong></article>)}</div></section>
    <section className="billing-section"><header><h2>Pagamentos e estornos</h2></header>{data.payments.length?<div className="billing-record-list">{data.payments.map(payment=><article key={payment.id}><div><strong>{payment.recordType==='REVERSAL'?'Estorno':paymentMethods[payment.methodCode]||'Pagamento'}</strong><span>Data efetiva: {formatDate(payment.effectiveOn)}</span><small>Registado pela C4G em {formatInstant(payment.createdAt)}</small></div><strong>{payment.recordType==='REVERSAL'?'âˆ’ ':''}{formatMoney(payment.amount,payment.currency)}</strong></article>)}</div>:<p>Ainda nÃ£o existem pagamentos registados.</p>}</section>
  </>
}
