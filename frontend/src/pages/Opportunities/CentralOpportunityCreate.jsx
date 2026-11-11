import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { platformCentralOpportunitiesApi as opportunitiesApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ToastProvider'
import './CentralOpportunityCreate.css'
import {readManualIntention,saveManualIntention,removeManualIntention} from './manualIntentions'
function errorMessage(error) {
  const status=error.response?.status
  if(status===400)return 'Verifique os campos, datas e montantes.'
  if(status===401)return 'Sessão expirada. Inicie sessão novamente.'
  if(status===403)return 'A criação exige acesso de Administração C4G e autenticação recente.'
  if(status===409)return 'Este pedido já foi usado com outro conteúdo.'
  if(status===404)return 'Oportunidade indisponível para consulta.'
  return 'Confirmação pendente. Repita o mesmo pedido, sem alterar os campos.'
}
export default function CentralOpportunityCreate() {
  const {user}=useAuth(),navigate=useNavigate()
  if(!user?.platformRoles?.includes('C4G_ADMIN'))return <Navigate to="/catalogo" replace />
  return <section className="page central-manual"><div className="page-header"><h1>Criar oportunidade</h1></div>
    <CentralOpportunityForm key={user.id} onCreated={receipt=>navigate(`/catalogo/${receipt.opportunityId}`)} onCancel={()=>navigate('/catalogo')} />
  </section>
}
// Keep the original command order so pending requests retain their identity.
const FIELDS = ['title','funderName','programmeName','summary','callReference','officialUrl','openingDate','closingDate','fundingAmountMin','fundingAmountMax','currencyCode','geographySummary','eligibleGroups','eligibilitySummary','opportunityType','interventionArea']
const LABELS = {opportunityType:'Tipo de oportunidade',interventionArea:'Área de intervenção',title:'Título',funderName:'Financiador',programmeName:'Programa',summary:'Resumo',callReference:'Referência',officialUrl:'URL oficial',openingDate:'Abertura',closingDate:'Fecho',fundingAmountMin:'Montante mínimo',fundingAmountMax:'Montante máximo',currencyCode:'Moeda',geographySummary:'Geografia/Local',eligibleGroups:'Grupos elegíveis',eligibilitySummary:'Requisitos aplicáveis à call'}
const TEXT_FIELDS = {
  summary:{maxLength:4000},
  geographySummary:{maxLength:2000,placeholder:'Ex.: Portugal continental; atividades realizadas na região Centro.'},
  eligibleGroups:{maxLength:4000,placeholder:'Ex.: PME, instituições de ensino superior e entidades de investigação.'},
  eligibilitySummary:{maxLength:4000,placeholder:'Ex.: Consórcio com pelo menos duas entidades. Apresentar plano de trabalhos e orçamento.'}
}
const FIELD_GROUPS = [
  {title:'Informações gerais',fields:['title','funderName','callReference','officialUrl','summary']},
  {title:'Classificação',fields:['programmeName','opportunityType','interventionArea']},
  {title:'Destinatários e requisitos',fields:['geographySummary','eligibleGroups','eligibilitySummary']},
  {title:'Datas e financiamento',fields:['openingDate','closingDate','fundingAmountMin','fundingAmountMax','currencyCode']}
]
function OpportunityFields({fields,form,setForm,disabled,options}){
  return fields.map(key=>{
    const props={name:key,value:form[key]||'',disabled,onChange:event=>setForm(previous=>({...previous,[key]:event.target.value}))}
    if(['programmeName','opportunityType','interventionArea'].includes(key)){
      const choices=options[key]||[]
      return <label key={key}>{LABELS[key]} <select {...props} aria-label={LABELS[key]}>
        <option value="">Selecionar quando conhecido</option>
        {form[key]&&!choices.some(item=>item.value===form[key])&&<option value={form[key]}>{form[key]}</option>}
        {choices.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
    }
    return <label key={key}>{LABELS[key]} {TEXT_FIELDS[key]?<textarea {...props} {...TEXT_FIELDS[key]} rows={3}/>:<input {...props} required={['title','funderName'].includes(key)} type={key.endsWith('Date')?'date':key==='officialUrl'?'url':'text'}/>}</label>
  })
}
const STORAGE_ERROR = 'Não foi possível guardar ou recuperar o pedido neste navegador. O envio foi interrompido; mantenha esta página aberta.'
function recover(userId) {
  try {return {value:readManualIntention(userId)}}
  catch {return {value:null,blocked:true}}
}
export function CentralOpportunityForm({onCreated,onCancel}){
  const {user}=useAuth(),userId=user?.id
  const [initial]=useState(()=>recover(userId))
  const restored=initial.value
  const [form,setForm]=useState(restored?.fields||{}),[saving,setSaving]=useState(false),[pending,setPending]=useState(Boolean(restored)),[error,setError]=useState(initial.blocked?STORAGE_ERROR:restored?'Confirmação pendente. Repita o mesmo pedido, sem alterar os campos.':'')
  const request=useRef(restored?{intention:JSON.stringify(restored.fields),requestId:restored.requestId}:null),active=useRef(true),receipt=useRef(restored?.receipt||null),uncertain=useRef(Boolean(restored)),toast=useToast()
  const [options,setOptions]=useState({}),[optionsError,setOptionsError]=useState(false)
  const [optionsAttempt,setOptionsAttempt]=useState(0)
  useEffect(()=>{
    let mounted=true
    setOptionsError(false)
    Promise.resolve().then(()=>opportunitiesApi.list({})).then(({data})=>{
      if(!mounted)return
      const meta=data.meta||data
      setOptions({programmeName:(meta.programmes||[]).map(value=>({value,label:value})),opportunityType:(meta.opportunityTypes||[]).map(value=>({value,label:value})),interventionArea:(meta.interventionAreas||[]).map(a=>({value:a.code,label:a.label}))})
    }).catch(()=>{if(mounted)setOptionsError(true)})
    return()=>{mounted=false}
  },[optionsAttempt])
  const busy=useRef(false)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  const submit=async event=>{
    event.preventDefault();if(busy.current||initial.blocked)return
    const fields=Object.fromEntries(FIELDS.filter(key=>form[key]).map(key=>[key,form[key]])),intention=JSON.stringify(fields)
    if(!request.current||request.current.intention!==intention)request.current={intention,requestId:crypto.randomUUID()}
    const persist=()=>saveManualIntention({userId,requestId:request.current.requestId,fields,...(receipt.current?{receipt:{opportunityId:receipt.current.opportunityId}}:{})})
    // Persist before transmission, so navigation during the POST also retains its identity.
    try{persist()}catch{setError(STORAGE_ERROR);return}
    busy.current=true;setSaving(true);setError('')
    try{
      if(!receipt.current){
        receipt.current=(await opportunitiesApi.create({requestId:request.current.requestId,fields})).data
        if(!active.current)return
        // If this write fails, the original stored command still permits a safe replay.
        try{persist()}catch{setPending(true);setError(STORAGE_ERROR);return}
      }
      // Never display mutation content: only this independently authorized GET supplies it.
      await opportunitiesApi.get(receipt.current.opportunityId)
      if(!active.current)return
      try{removeManualIntention(userId)}catch{setPending(true);setError(STORAGE_ERROR);return}
      toast.success('Oportunidade criada','Disponível no catálogo C4G.');onCreated(receipt.current)
    }catch(e){if(active.current){
      const definitive=[400,401,403,404,409,422].includes(e.response?.status)
      uncertain.current=uncertain.current||!definitive
      if(!receipt.current&&!uncertain.current){
        try{removeManualIntention(userId)}catch{uncertain.current=true}
      }
      setError(`${receipt.current?'Criação confirmada; releitura indisponível. ':''}${errorMessage(e)}`);setPending(Boolean(receipt.current)||uncertain.current)
    }}
    finally{busy.current=false;if(active.current)setSaving(false)}
  }
  return <form className="central-manual-form card" onSubmit={submit}>
    {error&&<p role="alert">{error}</p>}
    <p>Escolha o programa, o tipo e a área de intervenção. Pode deixar por preencher a informação ainda desconhecida. Consulte e indique a ligação oficial sempre que disponível.</p>
    {optionsError&&<p role="status">Não foi possível carregar as classificações. <button type="button" onClick={()=>setOptionsAttempt(value=>value+1)}>Tentar novamente</button></p>}
    {FIELD_GROUPS.map(group=><fieldset className="central-manual-group" key={group.title}>
      <legend>{group.title}</legend>
      <div className="central-manual-fields"><OpportunityFields options={options} fields={group.fields} form={form} setForm={setForm} disabled={saving||pending||initial.blocked}/></div>
    </fieldset>)}
    <div className="form-actions">
    <button className="btn btn-primary" type="submit" disabled={saving||initial.blocked}>{saving?'A criar…':pending?'Repetir confirmação':'Criar'}</button>
    <button className="btn btn-secondary" type="button" disabled={saving||(pending&&!receipt.current)} onClick={onCancel}>{receipt.current?'Fechar':'Cancelar'}</button>
  </div></form>
}
