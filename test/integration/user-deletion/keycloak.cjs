'use strict';
// Only for a disposable Keycloak container with --network none and no published ports.
// Run this process in that container's network namespace; no staging credentials are read.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createDeletionIdentity}=require('../../../backend/src/platformDirectory/deletionIdentity');
const origin='http://127.0.0.1:8080',realm='account-deletion-proof',issuer='https://identity.example.invalid/realms/'+realm;
async function main(){
 const password=process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
 if(!password||process.env.KC_BOOTSTRAP_ADMIN_USERNAME!=='deletion-proof')throw Error('ISOLATED_CONFIGURATION_REQUIRED');
 const tokenResponse=await fetch(origin+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'deletion-proof',password})});
 assert.equal(tokenResponse.status,200);const adminToken=(await tokenResponse.json()).access_token;
 async function request(path,method='GET',body,token=adminToken){
  const response=await fetch(origin+'/admin/realms'+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.ok(response.ok,'Isolated provider status '+response.status);
  return response.status===204||response.headers.get('content-length')==='0'?null:response.json();
 }
 await request('','POST',{realm,enabled:true,registrationAllowed:false});
 const api=(path,method,body)=>request('/'+realm+path,method,body);
 const secret=randomUUID()+randomUUID();
 await api('/clients','POST',{clientId:'deletion-worker',protocol:'openid-connect',enabled:true,publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false,directAccessGrantsEnabled:false,secret});
 const client=(await api('/clients?clientId=deletion-worker'))[0],serviceUser=await api('/clients/'+client.id+'/service-account-user');
 const management=(await api('/clients?clientId=realm-management'))[0];
 const roles=await Promise.all(['manage-users','view-users','query-users'].map(role=>api('/clients/'+management.id+'/roles/'+role)));
 await api('/users/'+serviceUser.id+'/role-mappings/clients/'+management.id,'POST',roles);
 for(const username of ['delete-me','preserve-me'])await api('/users','POST',{username,email:username+'@example.invalid',enabled:true});
 const target=(await api('/users?username=delete-me&exact=true'))[0],other=(await api('/users?username=preserve-me&exact=true'))[0];
 const response=await fetch(origin+'/realms/'+realm+'/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:'deletion-worker',client_secret:secret})});assert.equal(response.status,200);const token=(await response.json()).access_token;
 const port=createDeletionIdentity({issuer,adminOrigin:origin,accessToken:async()=>token});
 assert.equal((await port.remove({issuer,subject:target.id})).deleted,true);
 assert.equal((await port.remove({issuer,subject:target.id})).deleted,true);
 assert.equal((await api('/users/'+other.id)).id,other.id);
 console.log('ISOLATED_KEYCLOAK_DELETION_AND_RETRY_PASS');
}
main().catch(()=>{console.error('ISOLATED_KEYCLOAK_DELETION_FAILED');process.exitCode=1;});
