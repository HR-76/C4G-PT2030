'use strict';
// IPC only. Identity service credentials are loaded here, outside the HTTP process.
const fs=require('node:fs'),tls=require('node:tls');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!require('../security/secretFormat').isSecretHex(config.ownershipKey))throw Error('OWNERSHIP_KEY_INVALID');
const issuer=new URL(config.issuer);if(issuer.protocol!=='https:'||issuer.hostname!=='localhost'||!['8443','8283'].includes(issuer.port))throw Error('LOCAL_IDENTITY_REQUIRED');
tls.setDefaultCACertificates([...tls.getCACertificates('default'),fs.readFileSync(config.certificate,'utf8')]);
let token,until=0;
async function accessToken(){if(token&&Date.now()<until)return token;const r=await fetch(config.issuer+'/protocol/openid-connect/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret})});if(!r.ok)throw Error('KEYCLOAK_UNAVAILABLE');const b=await r.json();token=b.access_token;until=Date.now()+Math.max(1,b.expires_in-20)*1000;return token;}
const purpose=config.purpose||'MEMBERSHIP';
const identity=require('./keycloakAdapter').createKeycloakAdapter({issuer:config.issuer,accessToken,ownershipKey:config.ownershipKey,usernameMode:'email',purpose});
const projection=purpose==='MEMBERSHIP'?require('./memberProjection').createMemberProjection({bindings:config.bindings}):null;
const methods={identity:x=>identity.ensure(x),...(projection?{projection:x=>projection.ensure(x)}:{}),passwordReady:x=>identity.passwordReady(x.subject)};
if(purpose==='MEMBERSHIP'){
 const email=require('./activationEmail').createActivationEmail({key:config.ownershipKey,apiKey:process.env.RESEND_API_KEY,from:process.env.ACTIVATION_EMAIL_FROM,origin:process.env.ACTIVATION_PUBLIC_URL});
 methods.activationSecret=x=>email.secret(x);
 methods.activationEmail=x=>email.send(x);
}
process.on('message',async m=>{try{if(!Object.hasOwn(methods,m.method))throw Error('WORKER_METHOD_DENIED');const result=await methods[m.method](m.value);process.send?.({id:m.id,result});}catch(e){process.send?.({id:m.id,error:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'ONBOARDING_STEP_UNCONFIRMED'});}});
process.on('disconnect',()=>process.exit(0));process.send({ready:true});
