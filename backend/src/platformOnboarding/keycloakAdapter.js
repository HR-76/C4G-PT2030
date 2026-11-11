'use strict';
const {createHmac}=require('node:crypto');
const {uuid,fail}=require('./contracts');
function createKeycloakAdapter({issuer,accessToken,ownershipKey,fetchImpl=fetch,usernameMode='generated',purpose='MEMBERSHIP'}){
 if(!['MEMBERSHIP','ADMISSION'].includes(purpose))fail('KEYCLOAK_CONFIGURATION_INVALID');
 if(!['generated','email'].includes(usernameMode))fail('KEYCLOAK_CONFIGURATION_INVALID');
 const url=new URL(issuer);if(url.protocol!=='https:'||!/^\/realms\/[a-zA-Z0-9_-]+$/.test(url.pathname)||typeof accessToken!=='function'||!ownershipKey||ownershipKey.length<32)fail('KEYCLOAK_CONFIGURATION_INVALID');
 const base=url.origin+'/admin'+url.pathname;
 async function request(path,method='GET',body){
  const response=await fetchImpl(base+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){if(response.status===409)fail('IDENTITY_RECONCILIATION_REQUIRED');fail('KEYCLOAK_UNAVAILABLE');}
  return response.status===204||response.headers.get('content-length')==='0'?null:response.json();
 }
 const marker=x=>createHmac('sha256',ownershipKey).update((purpose==='ADMISSION'?'ADMISSION:':'')+x.operationId+':'+x.globalUserId).digest('hex');
 const binding=x=>purpose==='ADMISSION'?{purpose,operationId:x.operationId,globalUserId:x.globalUserId}:{operationId:x.operationId,organizationId:x.organizationId,globalUserId:x.globalUserId,membershipId:x.membershipId};
 return Object.freeze({
  async ensure(x){
   if(purpose==='ADMISSION'&&(x.purpose!==purpose||x.organizationId||x.membershipId))fail('KEYCLOAK_CONFIGURATION_INVALID');
   for(const k of purpose==='ADMISSION'?['operationId','globalUserId']:['operationId','organizationId','globalUserId','membershipId'])uuid(x[k]);
   if(x.input.expectedSubject){
    const user=await request('/users/'+encodeURIComponent(x.input.expectedSubject));if(!user?.enabled||user.id!==x.input.expectedSubject)fail('IDENTITY_RECONCILIATION_REQUIRED');
    return {...binding(x),issuer,subject:user.id,mode:'EXISTING'};
   }
   const username=usernameMode==='email'?x.input.adminEmail:'c4g-'+x.globalUserId;
   const find=async()=>{const rows=await request('/users?username='+encodeURIComponent(username)+'&exact=true');if(rows.length>1)fail('IDENTITY_RECONCILIATION_REQUIRED');return rows[0];};
   let user=await find();
   if(!user){
    const names=x.input.adminName.trim().split(/\s+/),firstName=usernameMode==='email'?names.shift():x.input.adminName,lastName=usernameMode==='email'?names.join(' '):'';
    try{await request('/users','POST',{username,email:x.input.adminEmail,firstName,lastName,enabled:true,emailVerified:false,attributes:{c4g_onboarding_owner:[marker(x)]}});}
    catch(e){if(e.code!=='IDENTITY_RECONCILIATION_REQUIRED')throw e;}
    user=await find();
   }
   if(!user?.enabled||user.username!==username||user.email?.toLowerCase()!==x.input.adminEmail||user.attributes?.c4g_onboarding_owner?.[0]!==marker(x))fail('IDENTITY_RECONCILIATION_REQUIRED');
   return {...binding(x),issuer,subject:user.id,mode:'CREATED'};
  },
  async passwordReady(subject){uuid(subject);const user=await request('/users/'+subject);if(!user?.enabled)return false;const credentials=await request('/users/'+subject+'/credentials');return credentials.some(c=>c.type==='password')&&!user.requiredActions?.includes('UPDATE_PASSWORD');}
 });
}
module.exports={createKeycloakAdapter};
