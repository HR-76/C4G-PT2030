 'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {PROFILE}=require('../../../backend/src/opportunities/catalogRead/dedicatedCredentials');
// Only called by the owned native-cluster acceptance gate. No CLI/env defaults.
async function prepareDedicatedCredentials({isolated,pool,target,dataDirectory,gateId}){
 if(isolated!==true||!['localhost','127.0.0.1'].includes(target?.host)||target.port===5432||!Number.isInteger(target.port)||target.port<=1024||!/^gcni_catalog_[a-f0-9]{12}$/.test(target.database)||!/^[a-f0-9]{32}$/.test(gateId))throw Error('OWNED_ISOLATED_TARGET_REQUIRED');
 const owner=JSON.parse(fs.readFileSync(path.join(path.dirname(dataDirectory),'owner.json'),'utf8'));
 if(owner.gateId!==gateId||path.resolve(owner.dataDirectory)!==path.resolve(dataDirectory))throw Error('OWNED_CLUSTER_REQUIRED');
 const c=await pool.connect();try{
  await c.query('BEGIN');
  const actual=(await c.query("SELECT current_database() AS database,current_setting('data_directory') AS directory,current_setting('port')::int AS port")).rows[0];
  if(actual?.database!==target.database||path.resolve(actual.directory)!==path.resolve(dataDirectory)||actual.port!==target.port)throw Error('OWNED_CLUSTER_REQUIRED');
  if((await c.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(PROFILE).map(p=>p.login)])).rows.length)throw Error('DEDICATED_CREDENTIALS_ALREADY_EXIST');
  await c.query("SET LOCAL password_encryption='scram-sha-256'");const credentials={};
  for(const [kind,profile] of Object.entries(PROFILE)){
   const password=randomBytes(32).toString('hex');
   await c.query(`CREATE ROLE ${profile.login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD '${password}'`);
   await c.query(`GRANT ${profile.role} TO ${profile.login} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);credentials[kind]=password;
  }
  await c.query('COMMIT');return Object.freeze(credentials);
 }catch(e){await c.query('ROLLBACK');throw Error(['OWNED_CLUSTER_REQUIRED','DEDICATED_CREDENTIALS_ALREADY_EXIST'].includes(e.message)?e.message:'DEDICATED_CREDENTIAL_PREPARATION_FAILED');}finally{c.release();}
}
module.exports={prepareDedicatedCredentials};
