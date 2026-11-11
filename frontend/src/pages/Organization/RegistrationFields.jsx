import './registration.css'

export const registrationTypes={UNIVERSITY:'Universidade',COMPANY:'Empresa',MUNICIPALITY:'Município',ASSOCIATION:'Associação',PUBLIC_BODY:'Entidade pública',RESEARCH:'Entidade de investigação',CONSULTANCY:'Consultoria',OTHER:'Outra entidade'}
export const registrationSteps=['Identificação','Morada e contactos','Administrador e dimensão','Rever']
export const registrationFields=[
 [['legalName','Nome legal',200],['displayName','Nome apresentado',200],['typeCode','Tipo de entidade'],['nif','NIF',9],['acronym','Sigla',50,true]],
 [['address','Morada',250],['addressComplement','Complemento da morada',150,true],['postalCode','Código postal',8],['locality','Localidade',150],['institutionalEmail','Email institucional',254],['institutionalPhone','Telefone institucional',32],['website','Website',500,true]],
 [['administratorProfessionalPhone','Telefone profissional do administrador',32],['administratorJobTitle','Cargo do administrador',150,true],['workerCount','Número de trabalhadores'],['workerReferenceDate','Data de referência dos trabalhadores']]
]
export function RegistrationFields({step,fields,administrator,errors={},onChange,types=Object.keys(registrationTypes)}){
 return <>
  {step===0&&<p className="registration-fixed">País da entidade: <strong>Portugal</strong> · Moeda: <strong>EUR</strong></p>}
  {step===1&&<p className="registration-fixed">País da sede: <strong>Portugal</strong></p>}
  {step===2&&<div className="registration-identity"><strong>Administrador convidado</strong><p>{administrator.name}<br/>{administrator.email}</p><small>Identidade associada ao convite. Estes dados não alteram a sua conta.</small></div>}
  <div className="registration-fields">{registrationFields[step].map(([key,label,maxLength,optional])=>{
   const properties={id:`registration-${key}`,name:key,value:fields[key]??'',onChange:e=>onChange(key,e.target.value),maxLength,'aria-invalid':Boolean(errors[key]),'aria-describedby':errors[key]?`error-${key}`:undefined};
   return <div className={'registration-field '+(['address','addressComplement'].includes(key)?'registration-wide':'')} key={key}>
    <label htmlFor={properties.id}>{label}{!optional&&<span aria-label="obrigatório"> *</span>}{optional&&<small> (opcional)</small>}</label>
    {key==='typeCode'?<select {...properties}><option value="">Selecione…</option>{types.map(type=><option value={type} key={type}>{registrationTypes[type]||type}</option>)}</select>:
     <input {...properties} type={key==='workerCount'?'number':key==='workerReferenceDate'?'date':'text'} min={key==='workerCount'?0:undefined} step={key==='workerCount'?1:undefined} inputMode={key==='nif'?'numeric':key.endsWith('Phone')?'tel':key==='institutionalEmail'?'email':undefined} placeholder={key==='postalCode'?'0000-000':undefined} />}
    {errors[key]&&<span id={`error-${key}`} className="registration-field-error">{errors[key]}</span>}
    {key==='displayName'&&<button type="button" className="registration-copy" onClick={()=>onChange(key,fields.legalName||'')}>Usar o nome legal</button>}
    {key==='institutionalEmail'&&<button type="button" className="registration-copy" onClick={()=>onChange(key,administrator.email)}>Usar o email do administrador</button>}
    {key==='administratorProfessionalPhone'&&<button type="button" className="registration-copy" onClick={()=>onChange(key,fields.institutionalPhone||'')}>Usar o telefone institucional</button>}
    {key==='nif'&&<small>A validação do formato não comprova a existência fiscal da entidade.</small>}
    {key==='workerCount'&&<small>Pode indicar zero. Não corresponde ao número de utilizadores da plataforma.</small>}
   </div>
  })}</div>
 </>
}
// Same presentation for the admission review and the entity's administrative profile.
export function RegistrationSummary({fields,administrator,onEdit}){
 return <div className="registration-summary">{registrationFields.map((group,index)=><section key={index}>
  <div className="registration-section-heading"><h3>{registrationSteps[index]}</h3>{onEdit&&<button type="button" className="registration-copy" onClick={()=>onEdit(index)}>Editar {registrationSteps[index].toLowerCase()}</button>}</div>
  <dl>{index===2&&administrator&&<><div><dt>Administrador na adesão</dt><dd>{administrator.name}</dd></div><div><dt>Email de acesso</dt><dd>{administrator.email}</dd></div></>}
   {group.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{key==='typeCode'?registrationTypes[fields[key]]||'Por preencher':fields[key]===0?'0':fields[key]||'Por preencher'}</dd></div>)}
  </dl>
 </section>)}<p>País: Portugal · País da sede: Portugal · Moeda: EUR</p></div>
}
