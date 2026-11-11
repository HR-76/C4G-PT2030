'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {createPgPolicyStore}=require('../../../backend/src/opportunities/catalogRead/pgPolicyStore');
async function prepare(db){
 await db.central.pool.query(fs.readFileSync(path.join(__dirname,'../catalog-controls/schema.sql'),'utf8'));
 const pools=[];
 try{
  for(const [name,role] of [['gcni_oidc_policy_reader','gcni_control_reader'],['gcni_oidc_policy_operator','gcni_control_operator']]){
   const password=randomBytes(32).toString('hex');await db.central.pool.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'; GRANT ${role} TO ${name}`);
   const url=new URL(db.central.connectionString);url.username=name;url.password=password;
   const pool=new Pool({connectionString:url.toString(),max:2,connectionTimeoutMillis:3000,query_timeout:4000});pool.on('error',()=>{});pools.push(pool);
  }
  const reader=createPgPolicyStore({isolated:true,pool:pools[0],login:'gcni_oidc_policy_reader'});
  const writer=createPgPolicyStore({isolated:true,pool:pools[1],login:'gcni_oidc_policy_operator',writable:true});
  // Test-only composition: reader SQL always uses the SELECT-only login;
  // mutation capability remains in the local operator, never an HTTP route.
  return {store:Object.freeze({durable:true,read:reader.read,compareAndSet:writer.compareAndSet}),async close(){await Promise.all(pools.map(p=>p.end()))}};
 }catch(e){await Promise.allSettled(pools.map(p=>p.end()));throw e;}
}
module.exports={prepare};
