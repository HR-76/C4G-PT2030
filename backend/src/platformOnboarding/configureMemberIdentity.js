'use strict';
// Explicit installer only; never called by an HTTP request.
async function configureMemberIdentity({kc,origin,installationId,browserFlowId}){
 const marker={'c4g.member.installation':installationId};
 const profile=await kc('users/profile');
 if(!profile.attributes.some(a=>a.name==='c4g_onboarding_owner'))await kc('users/profile','PUT',{...profile,attributes:[...profile.attributes,{name:'c4g_onboarding_owner',multivalued:false,permissions:{view:['admin'],edit:['admin']}}]});
 let flow=(await kc('authentication/flows')).find(f=>f.alias==='c4g-member-activation');
 if(!flow){await kc('authentication/flows','POST',{alias:'c4g-member-activation',providerId:'basic-flow',topLevel:true,builtIn:false});await kc('authentication/flows/c4g-member-activation/executions/execution','POST',{provider:'c4g-manual-manual'});flow=(await kc('authentication/flows')).find(f=>f.alias==='c4g-member-activation');}
 const executions=await kc('authentication/flows/c4g-member-activation/executions');
 if(executions.length!==1||executions[0].providerId!=='c4g-manual-manual')throw Error('ACTIVATION_FLOW_DRIFT');
 if(executions[0].requirement!=='REQUIRED')await kc('authentication/flows/c4g-member-activation/executions','PUT',{...executions[0],requirement:'REQUIRED'});
 const actions=await kc('authentication/required-actions');
 if(!actions.some(a=>a.alias==='c4g-manual-password'))await kc('authentication/register-required-action','POST',{name:'Definir password C4G',providerId:'c4g-manual-password'});
 await kc('authentication/required-actions/c4g-manual-password','PUT',{alias:'c4g-manual-password',name:'Definir password C4G',providerId:'c4g-manual-password',enabled:true,defaultAction:false,priority:10});
 async function client(clientId,body){const found=await kc('clients?clientId='+clientId);if(found.length>1||found.length===1&&found[0].attributes?.['c4g.member.installation']!==installationId)throw Error('MEMBER_CLIENT_OWNERSHIP_CONFLICT');if(!found.length)await kc('clients','POST',{clientId,enabled:true,protocol:'openid-connect',attributes:marker,...body});return (await kc('clients?clientId='+clientId))[0];}
 for(const [clientId,id] of [['c4g-member-activation',flow.id],['c4g-member-existing',browserFlowId]]){
  const c=await client(clientId,{publicClient:true,standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[origin+'/api/activation/callback'],webOrigins:[origin],attributes:{...marker,'pkce.code.challenge.method':'S256'},authenticationFlowBindingOverrides:{browser:id}});
  if(!c.publicClient||c.directAccessGrantsEnabled||c.redirectUris?.length!==1||c.redirectUris[0]!==origin+'/api/activation/callback'||c.authenticationFlowBindingOverrides?.browser!==id||c.attributes?.['pkce.code.challenge.method']!=='S256')throw Error('MEMBER_CLIENT_DRIFT');
 }
 const worker=await client('c4g-member-worker',{publicClient:false,standardFlowEnabled:false,directAccessGrantsEnabled:false,serviceAccountsEnabled:true});
 if(worker.publicClient||worker.standardFlowEnabled||worker.directAccessGrantsEnabled||!worker.serviceAccountsEnabled)throw Error('MEMBER_CLIENT_DRIFT');
 const serviceUser=await kc('clients/'+worker.id+'/service-account-user'),management=(await kc('clients?clientId=realm-management'))[0];
 const roles=await Promise.all(['manage-users','view-users','query-users'].map(r=>kc('clients/'+management.id+'/roles/'+r)));
 await kc('users/'+serviceUser.id+'/role-mappings/clients/'+management.id,'POST',roles);
 return {clientId:worker.clientId,clientSecret:(await kc('clients/'+worker.id+'/client-secret')).value,manualClientId:'c4g-member-activation',existingClientId:'c4g-member-existing'};
}
module.exports={configureMemberIdentity};
