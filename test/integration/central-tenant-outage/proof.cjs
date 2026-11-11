'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Pool}=require('../../../backend/node_modules/pg'),{databaseFixture}=require('../http-oidc/fixture');
const run=process.env.HTTP_PROOF_RUN,name=process.env.CIA_REPORT,container=process.env.CIA_CONTAINER,url=new URL(process.env.HTTP_PROOF_ADMIN_URL);
assert.match(run,/^[a-f0-9]{32}$/);assert.equal(container,'c4g-cia-restore-'+run);assert.match(name,/^[a-z0-9-]+$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert(!['5432','5433'].includes(url.port));
assert.equal(JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',container],{encoding:'utf8'}))['c4g.cia-restore'],run);
const dir=path.resolve(__dirname,'../../../context/reviews',name);fs.mkdirSync(dir);const report={status:'RUNNING',checks:[],limits:['Simulated login denial on a disposable PostgreSQL cluster, not network outage, existing connections, HTTP behavior, production database or Neon.','Central and tenants share one synthetic cluster; no independent physical failure domain or production privilege parity.']};
const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');
async function main(){const admin=new Pool({connectionString:url.toString(),max:2});let db;const pools=[];try{
 db=await databaseFixture(report);const identity={issuer:'https://synthetic.example.invalid',user:async username=>({username,subject:randomUUID()})},a=await db.tenant(identity,0),b=await db.tenant(identity,1);
 const poolFor=t=>{const c=t.credentials;const p=new Pool({host:c.host,port:c.port,database:c.database,user:c.login,password:c.password,max:1,connectionTimeoutMillis:3000});pools.push(p);return p;};
 const pa=poolFor(a),pb=poolFor(b);assert.equal((await pa.query('SELECT 1 AS n')).rows[0].n,1);assert.equal((await pb.query('SELECT 1 AS n')).rows[0].n,1);await pa.end();pools.splice(pools.indexOf(pa),1);
 assert.match(a.credentials.login,/^[a-z][a-z0-9_]{0,62}$/);await admin.query('ALTER ROLE '+a.credentials.login+' NOLOGIN');
 const blocked=poolFor(a);await assert.rejects(blocked.query('SELECT 1'),e=>e.code==='28000');assert.equal((await pb.query('SELECT 1 AS n')).rows[0].n,1);report.checks.push('tenant A rejects new login; tenant B remains reachable');
 await admin.query('ALTER ROLE '+a.credentials.login+' LOGIN');assert.equal((await blocked.query('SELECT 1 AS n')).rows[0].n,1);report.checks.push('tenant A login recovers after restoration');
 await admin.query('ALTER ROLE c4g_http_reader NOLOGIN');await assert.rejects(db.reader.query('SELECT 1'),e=>e.code==='28000');assert.equal((await pb.query('SELECT 1 AS n')).rows[0].n,1);report.checks.push('central reader rejects new login without corrupting tenant B connection');
 await admin.query('ALTER ROLE c4g_http_reader LOGIN');assert.equal((await db.reader.query('SELECT 1 AS n')).rows[0].n,1);report.checks.push('central reader login recovers after restoration');
 report.status='PASS';save();console.log('CENTRAL_TENANT_LOGIN_FAILURE_PASS');
 }finally{await Promise.allSettled(pools.map(p=>p.end()));await db?.close();await admin.end();}}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};save();console.error('CENTRAL_TENANT_LOGIN_FAILURE_FAIL',e.code||e.name);process.exitCode=1;});
