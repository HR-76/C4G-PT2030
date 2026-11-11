'use strict';
const {createReadRepository}=require('./readRepository');
const {createPgReadAuthority}=require('./readAuthority');
const {admitReader}=require('./readSchema');
const {createReadService}=require('./readService');
const {createReadRouter}=require('./readHttp');
// Pure composition: no environment reads, listening socket, source connector,
// global route registration, pool creation or pool ownership side effects.
function createReadRuntime({express,catalogPool,authorityPool,authorityLogin,policyVersion,key,clock=()=>Date.now(),exposure=null,observe=null,observePhase=null}){
 require('./ledgerContract');
 if(!authorityLogin||!authorityPool?.connect)throw new TypeError('Dedicated authority login and pool required');
 const timed=require('./phaseTiming').createPhaseTiming(observePhase);
 const authorityQueries={async query(sql,values){
  const c=await authorityPool.connect();let discard=false;
  try{await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");
   const identity=(await c.query('SELECT session_user AS name,session_user=current_user AS reset,NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS limited FROM pg_roles WHERE rolname=session_user')).rows[0];
   if(identity?.name!==authorityLogin||!identity.reset||!identity.limited)throw Error('CATALOG_AUTHORITY_LOGIN_INVALID');
   await c.query('SET LOCAL ROLE c4g_catalog_projection_membership');const result=await c.query(sql,values);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK').catch(()=>{discard=true;});throw e;}finally{c.release(discard?new Error('AUTHORITY_READ_CLEANUP_FAILED'):undefined);}
 }};
 const repository=createReadRepository({pool:catalogPool,admit:c=>admitReader(c,{authorityLogin})});
 const authorize=createPgReadAuthority({pool:authorityQueries,policyVersion});
 const observedRepository={load:(...args)=>timed('read',async()=>{const result=await repository.load(...args);if(typeof observePhase!=='function'||!result.verify)return result;return {...result,verify:(...values)=>timed('read',()=>result.verify(...values))};})};
 const observedExposure=exposure?{begin:(...args)=>timed('controls',()=>exposure.begin(...args)),check:(...args)=>timed('controls',()=>exposure.check(...args))}:null;
 const service=createReadService({repository:observedRepository,authorize:(...args)=>timed('membership',()=>authorize(...args)),key,clock,exposure:observedExposure,...require('./presentation').loadPresentation()});
 return Object.freeze({service,router:createReadRouter({express,service,observe})});
}
module.exports={createReadRuntime};
