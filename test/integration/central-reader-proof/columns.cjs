'use strict';
// Read SQL literals from the product source without executing its composition.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Pool}=require('../../../backend/node_modules/pg'),{databaseFixture}=require('../http-oidc/fixture');
const run=process.env.HTTP_PROOF_RUN,name=process.env.CIA_REPORT,container=process.env.CIA_CONTAINER;
assert.match(run,/^[a-f0-9]{32}$/);assert.equal(container,'c4g-cia-restore-'+run);assert.match(name,/^[a-z0-9-]+$/);
assert.equal(JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',container],{encoding:'utf8'}))['c4g.cia-restore'],run);
const dir=path.resolve(__dirname,'../../../context/reviews',name);fs.mkdirSync(dir);const report={status:'RUNNING',checks:[],limitations:['Column-level fixture proof for four queries only; not an HTTP authorization or complete production privilege proof.','Column grants do not enforce organization row isolation.']};
const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');
function literal(file,pattern){const source=fs.readFileSync(path.resolve(__dirname,'../../../backend/src',file),'utf8');const matches=[...source.matchAll(pattern)];assert.equal(matches.length,1,'Expected exactly one SQL literal');return matches[0][1];}
const directory=literal('organizationDirectory/centralOrganizationReader.js',/pool\.query\(`(SELECT m\.id AS "membershipId"[\s\S]*?LIMIT 1001)`/g);
const alerts=literal('applications/centralRecipientReaders.js',/pool\.query\(`(SELECT m\.id FROM public\.organization_membership[\s\S]*?clock_timestamp\(\)\))`/g);
const notices=literal('applications/centralRecipientReaders.js',/pool\.query\(`(SELECT m\.id,u\.display_name FROM public\.organization_membership[\s\S]*?LIMIT 1001)`/g);
async function main(){const admin=new Pool({connectionString:process.env.HTTP_PROOF_ADMIN_URL,max:1});let db;try{
 db=await databaseFixture(report);const identity={issuer:'https://synthetic.example.invalid',user:async username=>({username,subject:randomUUID()})};
 const a=await db.tenant(identity,0),b=await db.tenant(identity,1),suspended=await db.actor(identity,a.organizationId,'suspended');
 await require('../../../backend/src/security/membershipRepository').createMembershipRepository(db.central.pool,db.central.coordinator).changeStatus({membershipId:suspended.membershipId,status:'SUSPENDED',reason:'synthetic proof'});
 const future={membershipId:randomUUID(),id:randomUUID()};
 await db.central.pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'future','future@example.invalid','ACTIVE')",[future.id]);
 await db.central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at,valid_from) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 day')",[future.membershipId,future.id,a.organizationId]);
 await admin.query('REVOKE pg_read_all_data FROM c4g_http_reader');await db.central.pool.query('GRANT USAGE ON SCHEMA public TO c4g_http_reader');
 await db.central.pool.query('GRANT SELECT (id,legal_name,display_name,type_code,status) ON public.organization TO c4g_http_reader');
 await db.central.pool.query('GRANT SELECT (id,organization_id,global_user_id,status,membership_version,valid_from,valid_until) ON public.organization_membership TO c4g_http_reader');
 await db.central.pool.query('GRANT SELECT (id,display_name,primary_email,status) ON public.global_user TO c4g_http_reader');
 const organization='SELECT id,legal_name,display_name,type_code FROM public.organization WHERE id=$1 AND status=\'ACTIVE\'';
 assert(fs.readFileSync(path.resolve(__dirname,'../../../backend/src/organizationDirectory/centralOrganizationReader.js'),'utf8').includes("SELECT id,legal_name,display_name,type_code FROM public.organization WHERE id=$1 AND status=\\'ACTIVE\\'"));
 assert.equal((await db.reader.query(organization,[a.organizationId])).rows[0].id,a.organizationId);assert.equal((await db.reader.query(organization,[randomUUID()])).rowCount,0);report.checks.push('active organization query returns matching row and no missing row');
 let readerCalls=0;const scoped=require('../../../backend/src/organizationDirectory/centralOrganizationReader').createCentralOrganizationReader({organizationId:a.organizationId,pool:{query(...args){readerCalls++;return db.reader.query(...args)}}});
 assert.equal((await scoped(a.organizationId)).id,a.organizationId);await assert.rejects(scoped(b.organizationId),{code:'RESOURCE_NOT_AVAILABLE'});assert.equal(readerCalls,1);report.checks.push('production organization reader refuses another organization before issuing SQL');
 const list=await db.reader.query(directory,[a.organizationId]);assert.deepEqual(new Set(list.rows.map(x=>x.membershipId)),new Set([a.owner.membershipId,suspended.membershipId,future.membershipId]));assert(!list.rows.some(x=>x.membershipId===b.owner.membershipId));report.checks.push('directory query includes active and suspended, excludes foreign organization');
 const readMembers=require('../../../backend/src/organizationDirectory/centralOrganizationReader').createCentralMembershipReader({organizationId:a.organizationId,pool:db.reader});assert.deepEqual(await readMembers(),list.rows);report.checks.push('production membership reader returns scoped query rows');
 const candidates=[a.owner.membershipId,b.owner.membershipId,suspended.membershipId,future.membershipId];
 const selected=await db.reader.query(alerts,[a.organizationId,candidates,randomUUID()]);assert.deepEqual(selected.rows.map(x=>x.id),[a.owner.membershipId]);
 assert.equal((await db.reader.query(alerts,[a.organizationId,candidates,a.owner.id])).rowCount,0);report.checks.push('alerts query excludes foreign, suspended, future and actor');
 const readers=require('../../../backend/src/applications/centralRecipientReaders');assert.deepEqual(await readers.createAlertRecipientReader({pool:db.reader,organizationId:a.organizationId})(candidates,a.owner.id),[]);
 const result=await db.reader.query(notices,[a.organizationId,null]);assert.deepEqual(result.rows.map(x=>x.id),[a.owner.membershipId]);
 assert.equal((await db.reader.query(notices,[a.organizationId,[b.owner.membershipId]])).rowCount,0);report.checks.push('notices query filters foreign, suspended and future memberships');
 assert.deepEqual(await readers.createNoticeRecipientReader({pool:db.reader,organizationId:a.organizationId})([b.owner.membershipId]),[]);report.checks.push('production recipient readers use scoped SQL');
 await assert.rejects(db.reader.query('UPDATE public.organization SET display_name=$1',[ 'forbidden' ]),e=>e.code==='42501');await assert.rejects(db.reader.query('SELECT * FROM public.auth_identity_ref'),e=>e.code==='42501');report.checks.push('read-only role refuses write and unrelated identity table');
 await assert.rejects(db.reader.query('SELECT * FROM public.global_user'),e=>e.code==='42501');report.checks.push('ungranted columns and SELECT star denied');
 await db.central.pool.query('REVOKE SELECT (id,display_name,primary_email,status) ON public.global_user FROM c4g_http_reader');await assert.rejects(db.reader.query(directory,[a.organizationId]),e=>e.code==='42501');await db.central.pool.query('GRANT SELECT (id,display_name,primary_email,status) ON public.global_user TO c4g_http_reader');report.checks.push('directory query propagates a database privilege failure');
 await db.central.pool.query(`WITH u AS (INSERT INTO public.global_user(id,display_name,primary_email,status) SELECT gen_random_uuid(),'bulk '||n,'bulk'||n||'@example.invalid','ACTIVE' FROM generate_series(1,1002) n RETURNING id) INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) SELECT gen_random_uuid(),id,$1,'ORG_ADMIN','ACTIVE',clock_timestamp() FROM u`,[a.organizationId]);
 assert.equal((await db.reader.query(directory,[a.organizationId])).rowCount,1001);assert.equal((await db.reader.query(notices,[a.organizationId,null])).rowCount,1001);report.checks.push('directory and notices SQL bound results to 1001 under excess synthetic members');
 report.status='PASS';save();console.log('CENTRAL_READ_CONTRACTS_PASS');
 }finally{await db?.close();await admin.end();}}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};save();console.error('CENTRAL_READ_CONTRACTS_FAIL',e.code||e.name);process.exitCode=1;});
