'use strict';
const assert=require('node:assert/strict');
const {admitReader}=require('../../../backend/src/opportunities/catalogRead/readSchema');
const {createIsolatedAdmission}=require('../../../backend/src/opportunities/catalogRead/isolatedAdmission');
function baseline(name){const path=require('node:path'),Module=require('node:module'),filename=path.resolve(__dirname,'../../../backend/src/opportunities/catalogRead',name+'.js');const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(require('../../../backend/test/support/c1c2Baseline.json')[name],filename);return m.exports;}
async function run(pool){
 const c=await pool.connect(),checks=[],samples=[];const reader='gcni_c1c2_reader',member='gcni_c1c2_member';let revoked=false;
 try{
  for(const [login,role] of [[reader,'c4g_catalog_projection_reader'],[member,'c4g_catalog_projection_membership']]){
   await c.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await c.query(`GRANT ${role} TO ${login} WITH INHERIT FALSE, SET TRUE`);
  }
  const database=(await c.query('SELECT current_database() name')).rows[0].name;
  await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');
  const admission=createIsolatedAdmission({isolated:true,databaseName:database,readerLogin:reader,authorityLogin:member});
  let versions=0;const observed={query(sql,args){if(sql.includes('server_version_num'))versions++;return c.query(sql,args);}};
  await admission.admit(observed);assert.equal(versions,1);await admission.admit(observed);assert.equal(versions,2);
  checks.push('C1_ONE_VERSION_OBSERVATION_PER_FRESH_ADMISSION');
  const oldAdmission=baseline('isolatedAdmission').createIsolatedAdmission({isolated:true,databaseName:database,readerLogin:reader,authorityLogin:member});
  for(let i=0;i<8;i++)for(const arm of i%2?['B','A']:['A','B']){const before=versions,t=performance.now();await (arm==='A'?oldAdmission:admission).admit(observed);samples.push({component:'C1',arm,ms:performance.now()-t,versionQueries:versions-before});assert.equal(versions-before,arm==='A'?2:1);}
  await c.query('RESET SESSION AUTHORIZATION');await c.query('SET SESSION AUTHORIZATION '+reader);
  let combined=0;const client={query(sql,args){if(sql.includes('admissionGuards'))combined++;return c.query(sql,args);}};
  async function read(){await c.query('BEGIN READ ONLY');try{await c.query('SELECT pg_advisory_xact_lock_shared($1)',[42420002]);await admitReader(client,{authorityLogin:member});}finally{await c.query('ROLLBACK');}}
  await read();assert.equal(combined,1);checks.push('C2_EXACT_PINNED_FINGERPRINT_AND_GUARDS');
  await pool.query('REVOKE c4g_catalog_projection_reader FROM '+reader);revoked=true;
  await assert.rejects(read(),/CATALOG_READER_MEMBERSHIP_INVALID/);assert.equal(combined,2);checks.push('C2_SAME_CONNECTION_REVOCATION_REFUSED');
  await pool.query('GRANT c4g_catalog_projection_reader TO '+reader+' WITH INHERIT FALSE, SET TRUE');revoked=false;
  await read();assert.equal(combined,3);checks.push('C2_RECOVERY_RECOLLECTS_ALL_METADATA');
  await pool.query('GRANT SELECT ON public.organization TO '+reader);
  try{await assert.rejects(read(),/CATALOG_READER_DIRECT_PRIVILEGES/);assert.equal(combined,4);checks.push('C2_DIRECT_PRIVILEGES_REFUSED');}
  finally{await pool.query('REVOKE SELECT ON public.organization FROM '+reader);}
  await read();assert.equal(combined,5);checks.push('C2_DIRECT_PRIVILEGE_RECOVERY_FRESH');
  const oldReader=baseline('readSchema').admitReader;
  for(let i=0;i<8;i++)for(const arm of i%2?['B','A']:['A','B']){
   let queries=0;await c.query('BEGIN READ ONLY');try{await c.query('SELECT pg_advisory_xact_lock_shared($1)',[42420002]);const t=performance.now();await (arm==='A'?oldReader:admitReader)({query:(...args)=>{queries++;return c.query(...args);}},{authorityLogin:member});samples.push({component:'C2',arm,ms:performance.now()-t,queries});}finally{await c.query('ROLLBACK');}
  }
  assert.equal(samples.find(s=>s.component==='C2'&&s.arm==='A').queries,samples.find(s=>s.component==='C2'&&s.arm==='B').queries+1);
  return {status:'PASS',checks,versionObservations:versions,readerAdmissions:combined,samples};
 }finally{
  await c.query('ROLLBACK');await c.query('RESET SESSION AUTHORIZATION');
  if(revoked)await c.query('GRANT c4g_catalog_projection_reader TO '+reader+' WITH INHERIT FALSE, SET TRUE');
  await c.query('DROP ROLE IF EXISTS '+reader);await c.query('DROP ROLE IF EXISTS '+member);c.release();
 }
}
module.exports={run};
