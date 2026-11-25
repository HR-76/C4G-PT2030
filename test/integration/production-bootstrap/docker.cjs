'use strict';
// Docker-only wrapper for the same integration probe used by the local PG gate.
// Inputs never include a host, URL, entity or real provider credential.
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const SECRET='/run/private/postgres-password',EVIDENCE='/evidence';
function safeEvidence(raw){
 if(!raw||!Array.isArray(raw.checks)||raw.checks.length!==raw.total||raw.checks.some(value=>value.pass!==true||typeof value.name!=='string'))throw Error('REHEARSAL_EVIDENCE_INVALID');
 const allowed=['installed','installationId','intentDigest','centralVersion','tenantVersion','organizationId','tenantId','administratorId','organizationProfile','mfa'];
 const receipt=Object.fromEntries(allowed.filter(key=>Object.hasOwn(raw.receipt||{},key)).map(key=>[key,raw.receipt[key]]));
 if(raw.receipt?.logins&&typeof raw.receipt.logins==='object')receipt.logins=Object.fromEntries(Object.entries(raw.receipt.logins).filter(([key,value])=>/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)&&/^[a-z][a-z0-9_]{0,62}$/.test(value)));
 return {postgres:raw.postgres,mode:raw.mode,total:raw.total,checks:raw.checks.map(({name,pass})=>({name,pass})),
  receipt,scope:'disposable PostgreSQL and candidate application modules',provesRealProviders:false,provesApplicationHttp:false,provesTransportTls:false};
}
async function main(action){
 if(action==='prepare'){
  if(process.getuid?.()!==0)throw Error('REHEARSAL_PREPARATION_IDENTITY_REQUIRED');
  // These are project-owned volumes, never mounted from a host directory.
  fs.mkdirSync('/run/private',{recursive:true});fs.mkdirSync(EVIDENCE,{recursive:true});
  fs.writeFileSync(SECRET,randomBytes(32).toString('hex'),{flag:'wx',mode:0o444});
  fs.chownSync(EVIDENCE,1000,1000);fs.chmodSync(EVIDENCE,0o700);
  process.stdout.write('REHEARSAL_VOLUMES_PREPARED\n');return;
 }
 if(action==='export'){
  process.stdout.write(JSON.stringify(safeEvidence(JSON.parse(fs.readFileSync(path.join(EVIDENCE,'results.json'),'utf8'))))+'\n');return;
 }
 if(action!=='run'||!['fresh','full'].includes(process.env.C4G_REHEARSAL_MODE))throw Error('REHEARSAL_MODE_INVALID');
 const {Pool}=require('../../../backend/node_modules/pg');
 const password=fs.readFileSync(SECRET,'utf8');
 if(!/^[a-f0-9]{64}$/.test(password))throw Error('REHEARSAL_CREDENTIAL_INVALID');
 const pool=new Pool({host:'127.0.0.1',port:5432,database:'postgres',user:'bootstrap_admin',password,max:5,connectionTimeoutMillis:10000});
 try{
  const version=Number((await pool.query("SELECT current_setting('server_version_num') AS version")).rows[0].version);
  if(Math.floor(version/10000)!==18)throw Error('REHEARSAL_POSTGRES18_REQUIRED');
  await require('./probe.cjs').run({pool,base:EVIDENCE,port:5432,password,mode:process.env.C4G_REHEARSAL_MODE});
  process.stdout.write('REHEARSAL_DATABASE_GATE_PASS\n');
 }finally{await pool.end();}
}
if(require.main===module)main(process.argv[2]).catch(()=>{process.stderr.write('REHEARSAL_GATE_FAILED\n');process.exitCode=1;});
module.exports={main,safeEvidence};
