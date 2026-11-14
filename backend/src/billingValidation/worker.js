 'use strict';
const {uuid}=require('../platformBilling/contracts');
function createValidationTransport({apiKey,from,origin,fetchImpl=fetch}) {
 let url;try{url=new URL(origin)}catch{throw Error('BILLING_EMAIL_CONFIGURATION_REQUIRED')}
 if(!apiKey||typeof from!=='string'||!from.trim()||/[\r\n]/.test(from)||url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error('BILLING_EMAIL_CONFIGURATION_REQUIRED');
 return async delivery=>{
  uuid(delivery.id);uuid(delivery.organizationId);
  if(typeof delivery.to!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.to))return false;
  const link=origin+'/faturacao?validarEntidade='+encodeURIComponent(delivery.organizationId);
  const text='A C4G solicita a validação dos dados de faturação de '+delivery.organizationName+'.\n\nEntre na plataforma com a sua conta de administrador, selecione esta entidade e confirme os dados apresentados.\n\n'+link+'\n\nAbrir esta ligação não confirma os dados.';
  try {
   const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'billing-validation/'+delivery.id},
    body:JSON.stringify({from,to:[delivery.to],subject:'Confirme os dados de faturação da sua entidade',text})});
   if(!response.ok)return false;
   const value=await response.json();return typeof value.id==='string'&&value.id.length>0;
  }catch{return false}
 };
}
function createValidationWorker({pool,send}) {
 return {async tick(){
  const delivery=(await pool.query('SELECT public.billing_validation_email_claim() AS delivery')).rows[0].delivery;
  if(!delivery)return false;
  if(delivery.skipped)return true;
  let accepted=false;
  try{accepted=await send(delivery)===true}catch{ /* Retry the same persisted delivery identity. */ }
  await pool.query('SELECT public.billing_validation_email_finish($1,$2,$3)',[delivery.id,delivery.token,accepted]);
  return true;
 }};
}
module.exports={createValidationTransport,createValidationWorker};
