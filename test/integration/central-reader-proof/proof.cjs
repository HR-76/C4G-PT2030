'use strict';
// Fixture-only privilege experiment. Does not establish a production role contract.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Pool}=require('../../../backend/node_modules/pg'),{databaseFixture}=require('../http-oidc/fixture');
const run=process.env.HTTP_PROOF_RUN,name=process.env.CIA_REPORT,container=process.env.CIA_CONTAINER;
assert.match(run,/^[a-f0-9]{32}$/);assert.equal(container,'c4g-cia-restore-'+run);assert.match(name,/^[a-z0-9-]+$/);
const labels=JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',container],{encoding:'utf8'}));assert.equal(labels['c4g.cia-restore'],run);
const dir=path.resolve(__dirname,'../../../context/reviews',name);fs.mkdirSync(dir);const report={status:'RUNNING',checks:[],limitations:['Three public tables and one directory query only; not a complete central reader grant inventory.','Fixture identities are synthetic; no HTTP/OIDC or productive deployment parity claim.','Table-level grants permit reading both organizations; they do not enforce row-level isolation.']};
const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');
async function main(){let db;const admin=new Pool({connectionString:process.env.HTTP_PROOF_ADMIN_URL,max:1});try{
 db=await databaseFixture(report);
 const issuer='https://synthetic.example.invalid',identity={issuer,user:async username=>({username,subject:randomUUID()})};
 const a=await db.tenant(identity,0),b=await db.tenant(identity,1);
 await admin.query('REVOKE pg_read_all_data FROM c4g_http_reader');
 await db.central.pool.query('GRANT USAGE ON SCHEMA public TO c4g_http_reader');
 await db.central.pool.query('GRANT SELECT ON public.organization,public.organization_membership,public.global_user TO c4g_http_reader');
 const sql=`SELECT m.id AS "membershipId",u.display_name AS name,u.primary_email AS email,m.status,m.membership_version AS revision FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.organization_id=$1 AND m.status IN ('ACTIVE','SUSPENDED') ORDER BY u.display_name,m.id LIMIT 1001`;
 for(const t of [a,b]){const rows=(await db.reader.query(sql,[t.organizationId])).rows;assert.equal(rows.length,1);assert.equal(rows[0].membershipId,t.owner.membershipId);}
 report.checks.push('directory membership query reads both synthetic organizations with explicit three-table grants');
 await assert.rejects(db.reader.query('SELECT * FROM public.auth_identity_ref LIMIT 1'),e=>e.code==='42501');
 await assert.rejects(db.reader.query("UPDATE public.organization SET display_name='forbidden'"),e=>e.code==='42501');
 report.checks.push('identity table and organization write denied');
 const cross=await db.reader.query('SELECT count(*)::int AS n FROM public.organization_membership WHERE organization_id=ANY($1::uuid[])',[[a.organizationId,b.organizationId]]);assert.equal(cross.rows[0].n,2);
 report.checks.push('table grants alone expose both organizations to this reader');
 const flags=(await db.reader.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];assert(Object.values(flags).every(x=>x===false));
 report.checks.push('reader lacks superuser, create database, create role and bypass RLS');report.status='PASS';save();console.log('CENTRAL_READER_SCOPED_PROOF_PASS');
 }finally{await db?.close();await admin.end();}}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};save();console.error('CENTRAL_READER_SCOPED_PROOF_FAIL',e.code||e.name);process.exitCode=1;});
