 'use strict';
const {PROFILE,assertDedicatedSession}=require('./dedicatedCredentials');
const {createPgPolicyStore}=require('./pgPolicyStore');
const {createReadRuntime}=require('./readRuntime');
const {admitReader}=require('./readSchema');
// Preparation only: no operator, activation command, environment fallback or DDL.
function createIsolatedDurableReaderProvider({isolated,controlledAdmission,target,credentials,Pool,express,key,policyVersion,control=null}){
 if(!require('./controlledTarget').matchesTarget(controlledAdmission,target)&&(isolated!==true||!target||!['localhost','127.0.0.1'].includes(target.host)||!Number.isInteger(target.port)||target.port<=1024||target.port>65535||target.port===5432||!(/^(gcni_catalog_[a-f0-9]{12}|c4g_f13_authority_synthetic_central)$/.test(target.database))))throw Error('CATALOG_ISOLATED_TARGET_REQUIRED');
 if(typeof Pool!=='function'||!express?.Router||!Buffer.isBuffer(key)||key.length<32||typeof policyVersion!=='string'||!policyVersion)throw Error('CATALOG_PROVIDER_CONFIGURATION_INVALID');
 if(!credentials||Object.keys(credentials).length!==3||new Set(Object.values(credentials)).size!==3||Object.keys(PROFILE).some(k=>typeof credentials[k]!=='string'||!/^[a-f0-9]{64}$/.test(credentials[k])))throw Error('CATALOG_DEDICATED_CREDENTIALS_REQUIRED');
 const connection=Object.freeze({host:target.host,port:target.port,database:target.database});
 const secrets=Object.freeze({...credentials}),signingKey=Buffer.from(key);
 return function createRuntime(){
  if(control)require('./adminOnlyRehearsalControl').claimAdminOnlyRehearsalControl(control);
  const pools={};let closed=false,closing;
  try{for(const [kind,profile] of Object.entries(PROFILE)){
   pools[kind]=new Pool({...connection,user:profile.login,password:secrets[kind],max:2,connectionTimeoutMillis:3000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=2000'});
   if(typeof pools[kind].connect!=='function'||typeof pools[kind].end!=='function')throw Error('INVALID_POOL');
   pools[kind].on('error',()=>{});
  }}catch{for(const p of Object.values(pools))Promise.resolve().then(()=>p.end()).catch(()=>{});throw Error('CATALOG_PROVIDER_INITIALIZATION_FAILED');}
  async function withSession(kind,operation){
   const client=await pools[kind].connect();let discard=false;
   try{await client.query('BEGIN READ ONLY');await assertDedicatedSession(client,kind,connection.database);const result=await operation(client);await client.query('COMMIT');return result;}
   catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw e;}
   finally{client.release(discard?Error('CATALOG_PROVIDER_CLEANUP_FAILED'):undefined);}
  }
  const policyStore=createPgPolicyStore({isolated,controlledAdmission,pool:pools.policy,login:PROFILE.policy.login});
  // The provider has no transition/resume capability. OFF is mandatory even if
  // an outside actor replaces the persisted policy with an open cohort.
  async function requireOff(){
   await withSession('policy',async c=>{
    await c.query('SET LOCAL ROLE gcni_control_reader');
    const role=(await c.query("SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL AS limited,NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS standalone,has_table_privilege(r.oid,'gcni_catalog_control_rehearsal.state','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_function_privilege(r.oid,'gcni_catalog_control_rehearsal.transition(bigint,jsonb)','EXECUTE') AS writable FROM pg_roles r WHERE rolname='gcni_control_reader'")).rows[0];
    if(!role?.limited||!role.standalone||role.writable)throw Error('CATALOG_POLICY_PRIVILEGES_REJECTED');
   });
   const p=await policyStore.read();
   if(control){control.validatePolicy(p);return p;}
   if(p?.mode!=='OFF'||!Number.isSafeInteger(p.revision)||p.revision<0||p.expiresAt!==null||!Array.isArray(p.organizations)||p.organizations.length||!Array.isArray(p.roles)||p.roles.length||!Array.isArray(p.blockedGenerations))throw Error('CATALOG_POLICY_NOT_OFF');
   return p;
  }
  const exposure=Object.freeze({async begin(){await requireOff();throw Object.assign(Error('CATALOG_UNAVAILABLE'),{code:'CATALOG_UNAVAILABLE',status:503});},async check(){throw Object.assign(Error('CATALOG_UNAVAILABLE'),{code:'CATALOG_UNAVAILABLE',status:503});}});
  let runtime;try{runtime=createReadRuntime({express,catalogPool:pools.catalog,authorityPool:pools.authority,authorityLogin:PROFILE.authority.login,key:signingKey,policyVersion,exposure:control?.reader||exposure,observe:control?.monitor.observe});}
  catch{for(const pool of Object.values(pools))Promise.resolve().then(()=>pool.end()).catch(()=>{});throw Error('CATALOG_PROVIDER_INITIALIZATION_FAILED');}
  const unavailable=(_req,res)=>res.status(503).set('Cache-Control','private, no-store').json({error:{code:'CATALOG_UNAVAILABLE'}});
  return Object.freeze({policyKind:'durable',mode:control?'controlled':'disabled',
   // Runtime is fully composed, but preparation never publishes its data routes.
   router(req,res,next){if(closed||!control)return unavailable(req,res);if(!req.session?.auth)return runtime.router(req,res,next);if(!control.matchesPrincipal(req.session?.auth))return res.status(403).set('Cache-Control','private, no-store').json({error:{code:'ACCESS_DENIED'}});return runtime.router(req,res,next);},
   async ready(){if(closed)throw Error('CATALOG_PROVIDER_CLOSED');try{
    await withSession('catalog',c=>admitReader(c,{authorityLogin:PROFILE.authority.login}));
    await withSession('authority',async()=>{});await requireOff();if(closed)throw Error('CATALOG_PROVIDER_CLOSED');return true;
   }catch(e){const reason=/^CATALOG_[A-Z_]+$/.test(e.message||'')?e.message:'CATALOG_DATABASE_VALIDATION_FAILED';throw Object.assign(Error('CATALOG_PROVIDER_NOT_READY'),{reason,...(/^[0-9A-Z]{5}$/.test(e.code||'')?{databaseCode:e.code}:{})});}},
   close(){if(!closing){closed=true;closing=Promise.allSettled(Object.values(pools).map(p=>Promise.resolve().then(()=>p.end()))).then(results=>{if(results.some(r=>r.status==='rejected'))throw Error('CATALOG_PROVIDER_CLOSE_FAILED');});}return closing;}
  });
 };
}
module.exports={createIsolatedDurableReaderProvider};
