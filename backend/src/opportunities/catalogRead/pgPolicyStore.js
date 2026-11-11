'use strict';
const {createExposureControl}=require('./exposureControl');
const SCHEMA='gcni_catalog_control_rehearsal';
// Only explicitly supplied, dedicated rehearsal pools. No environment defaults,
// connection ownership, DDL, cache or fallback to a new empty policy.
function createPgPolicyStore({isolated,controlledAdmission,pool,login,writable=false}) {
  if((isolated!==true&&!require('./controlledTarget').isControlledAdmission(controlledAdmission))||!pool?.connect||typeof login!=='string'||!login)throw TypeError('Dedicated isolated policy connection required');
  const role=writable?'gcni_control_operator':'gcni_control_reader';
  async function query(sql,args=[]) {
    let c;try{c=await pool.connect();}catch{throw Error('POLICY_STORAGE_UNAVAILABLE');}let discard=false;
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout='3s'");
      await c.query("SET LOCAL lock_timeout='2s'");
      const identity=(await c.query(`SELECT session_user AS name, session_user=current_user AS reset,
        NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS limited,
        NOT pg_is_in_recovery() AS primary FROM pg_roles WHERE rolname=session_user`)).rows[0];
      if(identity?.name!==login||!identity.reset||!identity.limited||!identity.primary)throw Error('POLICY_CONNECTION_REJECTED');
      await c.query(`SET LOCAL ROLE ${role}`);
      const result=await c.query(sql,args);
      await c.query('COMMIT');return result;
    } catch(e) {
      await c.query('ROLLBACK').catch(()=>{discard=true;});
      // Do not propagate database messages containing policy values or endpoints.
      const safe=Error(e.message==='POLICY_CONNECTION_REJECTED'?'POLICY_CONNECTION_REJECTED':e.code==='40001'?'POLICY_VERSION_CONFLICT':e.code==='23514'?'INVALID_EXPOSURE_POLICY':'POLICY_STORAGE_UNAVAILABLE');
      if(/^[0-9A-Z]{5}$/.test(e.code||''))safe.code=e.code;
      if(e.code==='42883'&&/^[a-zA-Z0-9_ .,:#><=?&|!~\[\]()-]+$/.test(e.message))safe.diagnostic=e.message;
      throw safe;
    } finally {c.release(discard?Error('POLICY_CLEANUP_FAILED'):undefined);}
  }
  return Object.freeze({durable:true,async read(){
    const result=await query(`SELECT CASE WHEN policy->>'mode'='COHORT'
      AND (policy->>'expiresAt')::bigint <= floor(extract(epoch FROM clock_timestamp())*1000)
      THEN jsonb_set(policy,'{expiresAt}','0'::jsonb) ELSE policy END AS policy FROM ${SCHEMA}.state WHERE singleton=true`);
    if(result.rows.length!==1)throw Error('POLICY_STATE_MISSING');
    return result.rows[0].policy;
  },async compareAndSet(expected,next){
    if(!writable)throw Error('POLICY_READ_ONLY');
    if(!Number.isSafeInteger(expected)||expected<0)throw Error('INVALID_EXPOSURE_POLICY');
    return (await query(`SELECT ${SCHEMA}.transition($1::bigint,$2::jsonb) AS policy`,[expected,JSON.stringify(next)])).rows[0].policy;
  }});
}

// A restarted process never inherits permission to serve merely by finding an
// open durable policy. Explicit local admission is separate from global CAS.
function createDurableExposureControl({store,healthy=()=>true,clock=()=>Date.now()}) {
  if(store?.durable!==true)throw TypeError('Durable policy adapter required');
  let admitted=false;
  const control=createExposureControl({store,clock,healthy:()=>admitted&&healthy()});
  const operator=Object.freeze({...control.operator,
    async enable(args){
      if(!healthy())throw Error('CONTROL_MONITOR_NOT_READY');
      const policy=await control.operator.enable(args);admitted=true;return policy;
    },
    async resume({expectedRevision}){
      if(!healthy())throw Error('CONTROL_MONITOR_NOT_READY');
      // status validates shape through the same domain validator used by reads.
      const status=await control.operator.status();
      if(status.revision!==expectedRevision)throw Error('POLICY_VERSION_CONFLICT');
      if(status.mode!=='COHORT'||status.expiresAt<=clock()||status.expiresAt>clock()+300000)throw Error('POLICY_NOT_OPEN');
      const policy=await store.read();
      if(policy.revision!==expectedRevision)throw Error('POLICY_VERSION_CONFLICT');
      admitted=true;return policy;
    }
  });
  return Object.freeze({reader:control.reader,operator});
}
module.exports={createPgPolicyStore,createDurableExposureControl};
