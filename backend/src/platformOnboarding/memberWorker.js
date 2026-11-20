'use strict';
// IPC only. Identity service credentials are loaded here, outside the HTTP process.
const fs=require('node:fs'),tls=require('node:tls');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!require('../security/secretFormat').isSecretHex(config.ownershipKey))throw Error('OWNERSHIP_KEY_INVALID');
const issuer=new URL(config.issuer),local=issuer.hostname==='localhost'&&['8443','8283'].includes(issuer.port);
// Outside the local installation the worker only serves the identity provider the API itself signs in with (inherited OIDC_ISSUER).
if(issuer.protocol!=='https:'||(!local&&(!process.env.OIDC_ISSUER||config.issuer!==process.env.OIDC_ISSUER)))throw Error('LOCAL_IDENTITY_REQUIRED');
// The local identity provider uses a private CA; a public one needs no extra certificate.
if(local||config.certificate)tls.setDefaultCACertificates([...tls.getCACertificates('default'),fs.readFileSync(config.certificate,'utf8')]);
let token,until=0;
async function accessToken(){if(token&&Date.now()<until)return token;const r=await fetch(config.issuer+'/protocol/openid-connect/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret})});if(!r.ok)throw Error('KEYCLOAK_UNAVAILABLE');const b=await r.json();token=b.access_token;until=Date.now()+Math.max(1,b.expires_in-20)*1000;return token;}
const purpose=config.purpose||'MEMBERSHIP';
// The local identity provider answers its administration API on the issuer itself; elsewhere it may be private (adminOrigin).
if(local&&config.adminOrigin)throw Error('LOCAL_IDENTITY_REQUIRED');
const identity=require('./keycloakAdapter').createKeycloakAdapter({issuer:config.issuer,accessToken,ownershipKey:config.ownershipKey,usernameMode:'email',purpose,adminOrigin:config.adminOrigin||null});
const projection=purpose==='MEMBERSHIP'?require('./memberProjection').createMemberProjection({bindings:config.bindings,allowedResidency:config.allowedResidency,tenantApiProfile:config.tenantApiProfile}):null;
const methods={identity:x=>identity.ensure(x),...(projection?{projection:x=>projection.ensure(x)}:{}),passwordReady:x=>identity.passwordReady(x.subject)};
if(purpose==='MEMBERSHIP'&&process.env.USER_DELETION_RUNTIME==='central'){
 const deletionIdentity=require('../platformDirectory/deletionIdentity').createDeletionIdentity({issuer:config.issuer,accessToken,adminOrigin:config.adminOrigin||null});
 const deletionProjection=require('../platformDirectory/deletionProjection').createDeletionProjection({bindings:config.bindings,allowedResidency:config.allowedResidency,tenantApiProfile:config.tenantApiProfile});
 methods.deleteIdentity=x=>deletionIdentity.remove(x);
 methods.erasePerson=x=>deletionProjection.anonymize(x);
 methods.deletionReady=()=>deletionProjection.ready();
}
if(purpose==='MEMBERSHIP'){
 const email=require('./activationEmail').createActivationEmail({key:config.ownershipKey,...require('./memberWorkerEmail').memberWorkerEmailConfiguration(config,process.env)});
 methods.activationSecret=x=>email.secret(x);
 methods.activationEmail=x=>email.send(x);
 methods.testInvitationEmail=x=>email.test(x);
}
process.on('message',async m=>{try{if(!Object.hasOwn(methods,m.method))throw Error('WORKER_METHOD_DENIED');const result=await methods[m.method](m.value);process.send?.({id:m.id,result});}catch(e){process.send?.({id:m.id,error:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'ONBOARDING_STEP_UNCONFIRMED'});}});
process.on('disconnect',()=>process.exit(0));process.send({ready:true});
