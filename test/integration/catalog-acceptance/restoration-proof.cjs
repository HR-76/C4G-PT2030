'use strict';
const assert=require('node:assert/strict');
const {admitReader}=require('../../../backend/src/opportunities/catalogRead/readSchema');
const {createIsolatedAdmission}=require('../../../backend/src/opportunities/catalogRead/isolatedAdmission');
async function run(pool){
 const c=await pool.connect(),checks=[];const reader='gcni_restore_reader',member='gcni_restore_member';let revoked=false;
 try{
  for(const [login,role] of [[reader,'c4g_catalog_projection_reader'],[member,'c4g_catalog_projection_membership']]){
   await c.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await c.query(`GRANT ${role} TO ${login} WITH INHERIT FALSE, SET TRUE`);
  }
  const database=(await c.query('SELECT current_database() name')).rows[0].name;
  await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');
  const admission=createIsolatedAdmission({isolated:true,databaseName:database,readerLogin:reader,authorityLogin:member});
  let versions=0;const observed={query(sql,args){if(sql.includes('server_version_num'))versions++;return c.query(sql,args);}};
  await admission.admit(observed);assert.equal(versions,2);await admission.admit(observed);assert.equal(versions,4);checks.push('REFERENCE_VERSION_OBSERVATIONS_RESTORED_EACH_ADMISSION');
  await pool.query('GRANT SELECT ON public.organization TO PUBLIC');
  try{await assert.rejects(admission.admit(observed),/CATALOG_READ_CORE_DRIFT/);checks.push('SAME_CONNECTION_CORE_DRIFT_REFUSED');}finally{await pool.query('REVOKE SELECT ON public.organization FROM PUBLIC');}
  await admission.admit(observed);checks.push('CORE_RECOVERY_REQUIRES_FRESH_ADMISSION');
  await c.query('RESET SESSION AUTHORIZATION');await c.query('SET SESSION AUTHORIZATION '+reader);
  let guards=0,projections=0;const client={query(sql,args){assert(!sql.includes('admissionGuards'));if(sql.startsWith('SELECT session_user AS name'))guards++;if(sql.includes('AS "relations"'))projections++;return c.query(sql,args);}};
  async function read(){await c.query('BEGIN READ ONLY');try{await c.query('SELECT pg_advisory_xact_lock_shared($1)',[42420002]);await admitReader(client,{authorityLogin:member});}finally{await c.query('ROLLBACK');}}
  await read();assert.equal(guards,1);assert.equal(projections,1);checks.push('REFERENCE_SEPARATE_GUARDS_AND_PINNED_FINGERPRINT');
  await pool.query('REVOKE c4g_catalog_projection_reader FROM '+reader);revoked=true;
  await assert.rejects(read(),/CATALOG_READER_MEMBERSHIP_INVALID/);assert.equal(guards,2);assert.equal(projections,1);checks.push('SAME_CONNECTION_REVOCATION_REFUSED_BEFORE_PROJECTION');
  await pool.query('GRANT c4g_catalog_projection_reader TO '+reader+' WITH INHERIT FALSE, SET TRUE');revoked=false;
  await read();assert.equal(guards,3);assert.equal(projections,2);checks.push('MEMBERSHIP_RECOVERY_FRESH');
  await pool.query('GRANT SELECT ON public.organization TO '+reader);
  try{await assert.rejects(read(),/CATALOG_READER_DIRECT_PRIVILEGES/);assert.equal(guards,4);assert.equal(projections,2);checks.push('DIRECT_PRIVILEGE_REFUSED_BEFORE_PROJECTION');}finally{await pool.query('REVOKE SELECT ON public.organization FROM '+reader);}
  await read();assert.equal(guards,5);assert.equal(projections,3);checks.push('DIRECT_PRIVILEGE_RECOVERY_FRESH');
  return {status:'PASS',checks,versions,guards,projections};
 }finally{await c.query('ROLLBACK');await c.query('RESET SESSION AUTHORIZATION');if(revoked)await c.query('GRANT c4g_catalog_projection_reader TO '+reader+' WITH INHERIT FALSE, SET TRUE');await c.query('DROP ROLE IF EXISTS '+reader);await c.query('DROP ROLE IF EXISTS '+member);c.release();}
}
module.exports={run};
