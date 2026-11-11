'use strict';
// No HTTP listener. Privileged adapter ports live in this worker; the parent
// test orchestrator separately bootstraps and inspects disposable infrastructure.
const {Pool}=require('../../../backend/node_modules/pg'),{createKeycloakAdapter}=require('../../../backend/src/platformOnboarding/keycloakAdapter');
const {createPostgresProvisioner}=require('../../../backend/src/platformOnboarding/postgresProvisioner'),{createEncryptedJournal}=require('../../../backend/src/platformOnboarding/encryptedJournal');
const url=new URL(process.env.ONBOARDING_ADMIN_URL);if(url.hostname!=='127.0.0.1'||url.port!=='5598')throw Error('ISOLATED_WORKER_REQUIRED');
const connection={host:url.hostname,port:Number(url.port),user:url.username,password:decodeURIComponent(url.password)},adminPool=new Pool({...connection,database:'postgres',max:4}),centralPool=new Pool({...connection,database:'c4g_f13_authority_synthetic_central',max:4});
let cached,until=0;
async function accessToken(){if(cached&&Date.now()<until)return cached;const r=await fetch('https://localhost:8283/realms/master/protocol/openid-connect/token',{method:'POST',signal:AbortSignal.timeout(15000),body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'proof-admin',password:process.env.KC_BOOTSTRAP_ADMIN_PASSWORD})});if(!r.ok)throw Error('KEYCLOAK_UNAVAILABLE');const body=await r.json();cached=body.access_token;until=Date.now()+30000;return cached;}
const identity=createKeycloakAdapter({issuer:'https://localhost:8283/realms/c4g-manual-proof',accessToken,ownershipKey:process.env.ONBOARDING_JOURNAL_KEY});
const tenant=createPostgresProvisioner({adminPool,centralPool,connection,journal:createEncryptedJournal({directory:process.env.ONBOARDING_JOURNAL_DIR,key:process.env.ONBOARDING_JOURNAL_KEY}),ownershipKey:process.env.ONBOARDING_JOURNAL_KEY});
const methods={identity:x=>identity.ensure(x),tenant:x=>tenant.ensure(x),projection:x=>tenant.project(x),passwordReady:x=>identity.passwordReady(x.subject),apiCredentials:x=>tenant.apiCredentials(x),workerCredentials:x=>tenant.workerCredentials(x)};
process.on('message',async({id,method,value})=>{try{if(!methods[method])throw Error('WORKER_METHOD_DENIED');const result=await methods[method](value);process.send({id,result});}catch(e){process.send({id,detail:{code:e.internalCode||e.code||e.name,reason:/^[A-Z0-9_]+$/.test(e.message||'')?e.message:null,location:e.stack?.split('\n').slice(1,3).join(' ')},error:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'PROVISIONING_UNAVAILABLE'});}});
process.on('disconnect',async()=>{await Promise.all([adminPool.end(),centralPool.end()]);process.exit(0);});
process.send({ready:true});
