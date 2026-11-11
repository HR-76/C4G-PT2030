import {useEffect,useRef,useState} from 'react'
import {Building2,MapPin,UserRound,UsersRound} from 'lucide-react'
import {registrationTypes} from './RegistrationFields'
import './entity-profile.css'

const keys=['nif','acronym','address','addressComplement','postalCode','locality','institutionalEmail','institutionalPhone','website','responsibleName','responsibleEmail','responsiblePhone','responsibleJobTitle','workerCount','workerReferenceDate']
const optional=new Set(['acronym','addressComplement','website','responsibleJobTitle'])
const empty=Object.fromEntries(keys.map(key=>[key,'']))
const groups=[
 {title:'Morada e contactos',icon:MapPin,fields:[['address','Morada',250],['addressComplement','Complemento da morada',150],['postalCode','Código postal',8],['locality','Localidade',150],['institutionalEmail','Email institucional',254,'email'],['institutionalPhone','Telefone institucional',32,'tel'],['website','Website',500,'url']]},
 {title:'Contacto principal',icon:UserRound,fields:[['responsibleName','Nome do contacto principal',200],['responsibleEmail','Email profissional',254,'email'],['responsiblePhone','Telefone profissional',32,'tel'],['responsibleJobTitle','Cargo ou função',150]]},
 {title:'Dimensão',icon:UsersRound,fields:[['workerCount','Número de trabalhadores',null,'number'],['workerReferenceDate','Data de referência',null,'date']]}
]
const shown=(fields,key)=>fields?.[key]===0?'0':fields?.[key]||'Por preencher'

export default function EntityProfileCard({profile,organization,canEdit,onSave,defaults={}}){
 const initial={...empty,...defaults,...(profile?.fields||{})},[current,setCurrent]=useState(profile),[editing,setEditing]=useState(false),[fields,setFields]=useState(initial),[errors,setErrors]=useState({}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),pending=useRef(null)
 useEffect(()=>{setCurrent(profile);if(!editing)setFields({...empty,...defaults,...(profile?.fields||{})})},[profile,organization?.id])
 const registration=current||profile,values={...empty,...defaults,...(registration?.fields||{})},complete=Boolean(registration?.complete||registration?.fields?.nif),revision=Number(registration?.revision||0)
 function begin(){setFields(values);setErrors({});setMessage('');pending.current=null;setEditing(true)}
 async function submit(event,intent){event?.preventDefault();if(busy)return;setBusy(true);setErrors({});setMessage('')
  const body=intent||{expectedRevision:revision,requestId:crypto.randomUUID(),fields:Object.fromEntries(keys.map(key=>[key,key==='workerCount'&&fields[key]!==''?Number(fields[key]):fields[key]]))};pending.current=body
  try{const saved=await onSave(body);setCurrent(saved);setFields({...empty,...saved.fields});setEditing(false);pending.current=null;setMessage('Ficha guardada.')}
  catch(error){const code=error.response?.data?.error?.code;setErrors(error.response?.data?.error?.fields||{});if(error.response?.status&&error.response.status<500)pending.current=null
   setMessage(code==='FISCAL_IDENTITY_REVIEW_REQUIRED'?'Não foi possível confirmar este NIF. Contacte a C4G para verificar a associação.':code==='FISCAL_IDENTITY_LOCKED'?'O NIF confirmado não pode ser alterado neste formulário.':code==='ONBOARDING_STALE'?'A ficha foi alterada. Consulte a versão atual antes de voltar a guardar.':code==='REGISTRATION_FIELDS_INVALID'?'Verifique os campos assinalados.':'O resultado da gravação não foi confirmado. Pode repetir exatamente o mesmo envio.')
  }finally{setBusy(false)}
 }
 const set=(key,next)=>setFields(old=>({...old,[key]:next}))
 return <section className="entity-profile-sheet" aria-labelledby="entity-profile-title">
  <header className="entity-profile-header"><div className="entity-profile-title-line"><Building2 size={21} aria-hidden="true"/><h2 id="entity-profile-title">Ficha da entidade</h2><span className={complete?'entity-profile-state complete':'entity-profile-state incomplete'}>{complete?'Completa':'Por completar'}</span></div>
   {canEdit&&!editing&&<button className="btn btn-outline" type="button" onClick={begin}>{complete?'Editar ficha':'Preencher ficha'}</button>}
  </header>
  {message&&<p className={editing?'entity-profile-message error':'entity-profile-message'} role={editing?'alert':'status'}>{message}</p>}
  {(!editing||!canEdit)?<div className="entity-profile-document">
   <section><h3>Identificação</h3><dl><div><dt>Denominação legal</dt><dd>{organization.legalName}</dd></div><div><dt>Nome apresentado</dt><dd>{organization.name}</dd></div><div><dt>Tipo</dt><dd>{registrationTypes[organization.typeCode]||organization.typeCode||'Por preencher'}</dd></div><div><dt>NIF</dt><dd>{shown(values,'nif')}</dd></div><div><dt>Sigla</dt><dd>{shown(values,'acronym')}</dd></div><div><dt>País e moeda</dt><dd>Portugal · EUR</dd></div></dl></section>
   {groups.map(group=><section key={group.title}><h3><group.icon size={17} aria-hidden="true"/>{group.title}</h3><dl>{group.fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{shown(values,key)}</dd></div>)}</dl>{group.title==='Contacto principal'&&<p className="entity-profile-note">Contacto operacional; não representa acesso nem representação legal.</p>}</section>)}
  </div>:<form className="entity-profile-form" onSubmit={submit} noValidate>
   <fieldset disabled={busy}><legend>Identificação</legend><div className="entity-profile-identity"><div><span>Denominação legal</span><strong>{organization.legalName}</strong></div><div><span>Nome apresentado</span><strong>{organization.name}</strong></div><div><span>Tipo</span><strong>{registrationTypes[organization.typeCode]||organization.typeCode}</strong></div><div><span>País e moeda</span><strong>Portugal · EUR</strong></div></div>
    <div className="entity-profile-fields"><Field name="nif" hint={complete ? "NIF confirmado · apenas consulta" : null} label="NIF" maxLength={9} required value={fields.nif} error={errors.nif} readOnly={complete} set={set}/><Field name="acronym" label="Sigla" maxLength={50} value={fields.acronym} error={errors.acronym} set={set}/></div></fieldset>
   {groups.map(group=><fieldset disabled={busy} key={group.title}><legend><group.icon size={17} aria-hidden="true"/>{group.title}</legend><div className="entity-profile-fields">{group.fields.map(([key,label,maxLength,type])=><Field key={key} name={key} label={label} maxLength={maxLength} type={type} required={!optional.has(key)} value={fields[key]} error={errors[key]} set={set}/>)}</div>{group.title==='Contacto principal'&&<p className="entity-profile-note">Use a pessoa que deve receber comunicações operacionais da C4G. Este registo não cria acesso.</p>}</fieldset>)}
   <div className="entity-profile-actions"><button className="btn btn-primary" disabled={busy}>{busy?'A guardar…':'Guardar ficha'}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={()=>{setEditing(false);pending.current=null;setMessage('')}}>Cancelar</button>{pending.current&&!busy&&<button className="btn btn-primary" type="button" onClick={()=>submit(null,pending.current)}>Repetir o mesmo envio</button>}</div>
  </form>}
 </section>
}

function Field({name,label,value,error,set,hint,required=false,type='text',maxLength,readOnly=false}){return <label className={['address','addressComplement'].includes(name)?'entity-profile-wide':''}>{label}{required&&<span aria-label="obrigatório"> *</span>}{!required&&<small> (opcional)</small>}<input name={name} type={type} value={value??''} maxLength={maxLength} min={type==='number'?0:undefined} step={type==='number'?1:undefined} placeholder={name==='postalCode'?'0000-000':undefined} readOnly={readOnly} required={required} aria-invalid={Boolean(error)} aria-describedby={[hint && `profile-hint-${name}`,error && `profile-error-${name}`].filter(Boolean).join(' ') || undefined} onChange={event=>set(name,event.target.value)}/>{hint&&<small id={`profile-hint-${name}`}>{hint}</small>}{error&&<span id={`profile-error-${name}`} className="entity-profile-field-error">{error}</span>}</label>}
