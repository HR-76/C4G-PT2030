'use strict';
const {createHmac}=require('node:crypto');
const {uuid}=require('./contracts');
const {insertActivationLink}=require('../emailTemplates/render');

// purpose: 'MEMBERSHIP' (a person joins an existing entity) or 'ADMISSION' (the first administrator of a new entity).
// Each has its own page, wording, secret derivation and idempotency namespace, so one can never stand in for the other.
const PURPOSES=Object.freeze({
 MEMBERSHIP:{path:'/api/activation',label:'c4g-member-activation-email-v1:',idempotency:'member-activation/',subject:'Ative o seu acesso à C4G',
  text:'Foi-lhe atribuído acesso à plataforma C4G.\n\nAbra a ligação para ativar o acesso e definir a sua palavra-passe. Se já tem conta, entre com a sua palavra-passe atual.'},
 ADMISSION:{path:'/api/admission-activation',label:'c4g-entity-admission-email-v1:',idempotency:'entity-admission/',subject:'Convite para aderir à plataforma C4G',
  text:'Foi convidado a registar a sua entidade na plataforma C4G.\n\nAbra a ligação para aceitar o convite, definir a sua palavra-passe e preencher a ficha da entidade. Se já tem conta, entre com a sua palavra-passe atual.'}
});
function createActivationEmail({key,apiKey,from,origin,fetchImpl=fetch,purpose='MEMBERSHIP'}){
 if(!Object.hasOwn(PURPOSES,purpose))throw new TypeError('ACTIVATION_EMAIL_PURPOSE_INVALID');
 const kind=PURPOSES[purpose];
 let publicOrigin;
 try {
  const url=new URL(origin);
  if(url.protocol==='https:'&&!url.username&&!url.password&&url.origin===origin)publicOrigin=url.origin;
 } catch {}
 const configured=Boolean(typeof key==='string'&&key.length>=32&&apiKey&&from&&publicOrigin&&!/[\r\n]/.test(from));
 return Object.freeze({
  async secret({invitationId}){
   if(!configured)return null;
   return createHmac('sha256',key).update(kind.label+uuid(invitationId)).digest('hex');
  },
  async send({invitationId,to,secret,expiresAt,message}){
   if(!configured)return {status:'NOT_CONFIGURED'};
   uuid(invitationId);
   if(typeof to!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||! /^[a-f0-9]{64}$/.test(secret))throw Error('INVALID_ACTIVATION_EMAIL');
   if(!Number.isFinite(new Date(expiresAt).getTime())||new Date(expiresAt)<=new Date())return {status:'EXPIRED'};
   const url=publicOrigin+kind.path+'#'+secret;
   const text=kind.text+'\n\n'+url+'\n\nEsta ligação é de uso único e expira em '+new Date(expiresAt).toISOString()+'.';
   try {
    const response=await fetchImpl('https://api.resend.com/emails',{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
     headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':kind.idempotency+invitationId},
     body:JSON.stringify({from,to:[to],...(message?insertActivationLink(message,url):{subject:kind.subject,text})}),
    });
    if(!response.ok)return {status:'UNCONFIRMED'};
    const result=await response.json();
    return {status:typeof result.id==='string'&&result.id?'ACCEPTED':'UNCONFIRMED'};
   }catch{return {status:'UNCONFIRMED'};}
  },
  async test({to,message,idempotencyKey}){
   if(!configured)return {status:'NOT_CONFIGURED'};
   uuid(idempotencyKey);
   if(typeof to!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw Error('INVALID_ACTIVATION_EMAIL');
   const content=insertActivationLink(message,'https://exemplo.invalid/ativacao-de-exemplo');
   try{
    const response=await fetchImpl('https://api.resend.com/emails',{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
     headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'member-invitation-test/'+idempotencyKey},
     body:JSON.stringify({from,to:[to],subject:'[TESTE] '+content.subject,html:content.html.replace(/(<body[^>]*>)/,'$1<p><strong>TESTE — ligação de exemplo sem efeito.</strong></p>'),text:'TESTE — ligação de exemplo sem efeito.\n\n'+content.text})
    });
    if(!response.ok)return {status:'UNCONFIRMED'};
    const result=await response.json();
    return {status:typeof result.id==='string'&&result.id?'ACCEPTED':'UNCONFIRMED'};
   }catch{return {status:'UNCONFIRMED'};}
  },
 });
}
module.exports={createActivationEmail};
