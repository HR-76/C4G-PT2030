'use strict';
const {uuid,fail}=require('../platformOnboarding/contracts');
// Credentials stay in the private worker. Never locate a deletion target by email.
function createDeletionIdentity({issuer,adminOrigin=null,accessToken,fetchImpl=fetch}){
 const url=new URL(issuer);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^\/realms\/[a-zA-Z0-9_-]+$/.test(url.pathname)||typeof accessToken!=='function')fail('IDENTITY_DELETION_CONFIGURATION_INVALID');
 if(adminOrigin!==null){const admin=new URL(adminOrigin);if(!['https:','http:'].includes(admin.protocol)||admin.origin!==adminOrigin||admin.username||admin.password)fail('IDENTITY_DELETION_CONFIGURATION_INVALID');}
 const base=(adminOrigin||url.origin)+'/admin'+url.pathname+'/users/';
 async function request(subject,method){
  try{return await fetchImpl(base+subject,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+await accessToken()}});}
  catch{fail('IDENTITY_DELETION_UNCONFIRMED');}
 }
 return Object.freeze({async remove(value){
  if(!value||value.issuer!==issuer)fail('IDENTITY_DELETION_BINDING_INVALID');
  const subject=uuid(value.subject);
  const removed=await request(subject,'DELETE');
  if(![204,404].includes(removed.status))fail('IDENTITY_DELETION_UNCONFIRMED');
  if((await request(subject,'GET')).status!==404)fail('IDENTITY_DELETION_UNCONFIRMED');
  return {issuer,subject,deleted:true};
 }});
}
module.exports={createDeletionIdentity};
