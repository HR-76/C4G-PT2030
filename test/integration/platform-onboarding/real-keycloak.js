'use strict';
const {randomUUID}=require('node:crypto');
async function configure({origin,password}){
 const issuer='https://localhost:8283/realms/c4g-manual-proof',realm='c4g-manual-proof';
 let token,until=0;
 async function accessToken(){if(token&&Date.now()<until)return token;const r=await fetch('https://localhost:8283/realms/master/protocol/openid-connect/token',{method:'POST',signal:AbortSignal.timeout(15000),body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'proof-admin',password:process.env.KC_BOOTSTRAP_ADMIN_PASSWORD})});if(!r.ok)throw Error('ISOLATED_KEYCLOAK_LOGIN_FAILED');const result=await r.json();token=result.access_token;until=Date.now()+Math.max(1,result.expires_in-10)*1000;return token;}
 const admin=async(p,method='GET',body)=>{const response=await fetch('https://localhost:8283/admin/realms'+p,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('ISOLATED_KEYCLOAK_CONFIGURATION_'+response.status);return response.status===204||response.headers.get('content-length')==='0'?null:response.json();};
 await admin('','POST',{realm,enabled:true,sslRequired:'all',registrationAllowed:false,loginWithEmailAllowed:true,resetPasswordAllowed:false,passwordPolicy:'length(12)',attributes:{'acr.loa.map':JSON.stringify({'c4g-loa1':1,'c4g-loa2':2})}});
 const kc=(p,m,b)=>admin('/'+realm+'/'+p,m,b),profile=await kc('users/profile');
 await kc('users/profile','PUT',{...profile,attributes:profile.attributes.map(a=>a.name==='lastName'?{...a,required:undefined}:a).concat([{name:'c4g_onboarding_owner',multivalued:false,permissions:{view:['admin'],edit:['admin']}}])});
 const flowId=await require('../../../backend/scripts/localPlatform/identityFlow').configureOptionalFlow(kc,{installationId:randomUUID()},'integrated-proof');
 await kc('authentication/flows','POST',{alias:'manual-proof',providerId:'basic-flow',topLevel:true,builtIn:false});
 await kc('authentication/flows/manual-proof/executions/execution','POST',{provider:'c4g-proof-manual'});
 const execution=(await kc('authentication/flows/manual-proof/executions'))[0];await kc('authentication/flows/manual-proof/executions','PUT',{...execution,requirement:'REQUIRED'});
 await kc('authentication/register-required-action','POST',{name:'Manual password',providerId:'c4g-proof-password'});await kc('authentication/required-actions/c4g-proof-password','PUT',{alias:'c4g-proof-password',name:'Manual password',providerId:'c4g-proof-password',enabled:true,defaultAction:false,priority:10});
 const manualFlow=(await kc('authentication/flows')).find(f=>f.alias==='manual-proof');
 for(const clientId of ['integrated-app','integrated-existing','integrated-manual'])await kc('clients','POST',{clientId,enabled:true,publicClient:true,protocol:'openid-connect',standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[origin+(clientId==='integrated-app'?'/api/auth/oidc/callback':'/activation/callback')],webOrigins:[origin],attributes:{'pkce.code.challenge.method':'S256','default.acr.values':'c4g-loa1','minimum.acr.value':'c4g-loa1'},authenticationFlowBindingOverrides:{browser:clientId==='integrated-manual'?manualFlow.id:flowId},protocolMappers:[{name:'amr',protocol:'openid-connect',protocolMapper:'oidc-amr-mapper',config:{'id.token.claim':'true','access.token.claim':'true'}}]});
 await kc('users','POST',{username:'platform-admin',firstName:'C4G',lastName:'Isolated',email:'platform@example.invalid',enabled:true,emailVerified:false,credentials:[{type:'password',value:password,temporary:false}]});
 const subject=(await kc('users?username=platform-admin&exact=true'))[0].id;
 return {issuer,subject,kc};
}
module.exports={configure};
