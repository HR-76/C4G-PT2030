'use strict';
// Evidence only. Every database connection is read-only; no execution port is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('../backend/scripts/localPlatform/config'),{Pool}=require('../backend/node_modules/pg');
const execute=require('./eu-reconciliation-execute.cjs'),{quietSource}=require('./eu-reconciliation-approve.cjs');
const {readSafe}=require('../backend/src/opportunities/v2/euWriterWindowPlan'),plans=require('../backend/src/opportunities/v2/euRunReconciliationPlan');
const stateReader=require('../backend/src/opportunities/v2/euRunReconciliationState'),pkg=require('../backend/src/security/opportunityEuReconciliationMigrationPackage');
const installed=require('../backend/src/security/opportunityV2MigrationPackage'),{verifyEvents}=require('../backend/src/audit/verifier');
const SHA=/^[a-f0-9]{64}$/,IDENTIFIER=/^[a-z][a-z0-9_]{0,62}$/,sha=b=>createHash('sha256').update(b).digest('hex'),same=assert.deepEqual;
const quote=s=>{assert(IDENTIFIER.test(s));return '"'+s+'"';};
const OPTIONS='-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000';
function args(argv){assert(Array.isArray(argv)&&argv.length===2&&['--before','--after'].includes(argv[0]));return {before:argv[0]==='--before',relative:execute.args([argv[1]])};}
function assertTerminalRows(preview,after){
 const at=after?.run?.finished_at;assert(typeof at==='string'&&Number.isFinite(Date.parse(at)));
 const next=v=>{const n=Number(v);assert(Number.isSafeInteger(n)&&n>=0&&Number.isSafeInteger(n+1));return n+1;};
 const expected={run:{...preview.run,status:'ERROR',error_code:'FUNDING_EXECUTION_EXPIRED',finished_at:at,lease_until:null,fence:next(preview.run.fence)},
  cycle:{...preview.cycle,status:'ERROR',error_code:'FUNDING_EXECUTION_EXPIRED',finished_at:at},
  inbox:{...preview.inbox,state:'FAILED',result_code:'EXPIRED',lease_until:null,completed_at:at,fence:next(preview.inbox.fence)},
  execution:{...preview.execution,state:'EXPIRED',result_code:'EXPIRED',lease_until:null,updated_at:at,fence:next(preview.execution.fence)}};
 same(after,expected,'RECONCILIATION_VERIFICATION_TERMINAL_ROWS');return true;
}
function tableFilter(schema,table,plan){
 const value=(where,values)=>({where,values});
 if(schema==='opportunity_catalog'){
  if(table==='funding_run')return value(' WHERE run_id<>$1::uuid',[plan.runId]);
  if(table==='funding_cycle')return value(' WHERE cycle_id<>$1::uuid',[plan.cycleId]);
  if(['eu_expired_permit_v1','eu_expired_reconciliation_v1'].includes(table))return value(' WHERE plan_id<>$1::uuid',[plan.planId]);
 }
 if(schema==='async_exec'){
  if(table==='execution')return value(' WHERE execution_id<>$1::uuid',[plan.preview.execution.execution_id]);
  if(table==='inbox'){const i=plan.preview.inbox;return value(' WHERE NOT (organization_id IS NULL AND consumer=$1 AND job_type=$2 AND job_version=$3 AND idempotency_key=$4)',[i.consumer,i.job_type,i.job_version,i.idempotency_key]);}
 }
 return value('',[]);
}
async function inventory(client,plan){
 const tables=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('opportunity_catalog','async_exec') ORDER BY 1,2")).rows,result={};assert(tables.length);
 for(const t of tables){const name=quote(t.nspname)+'.'+quote(t.relname),filter=tableFilter(t.nspname,t.relname,plan);const row=(await client.query(`SELECT count(*)::int AS count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS digest FROM ${name} t${filter.where}`,filter.values)).rows[0];assert(Number.isSafeInteger(row.count)&&row.count>=0&&SHA.test(row.digest));result[t.nspname+'.'+t.relname]=row;}
 return result;
}
function assertHistoricalAudit(before,after){const current=new Map(after.map(e=>[e.eventId,e.eventHash]));assert.equal(current.size,after.length);for(const event of before)assert.equal(current.get(event.eventId),event.eventHash,'RECONCILIATION_HISTORICAL_AUDIT_CHANGED');return true;}
function auditBinding(event,plan,actorId,detail){
 assert(event);assert.equal(event.actor.type,'HUMAN');assert.equal(event.actor.id,actorId);assert.equal(event.eventCode,'SENSITIVE_ACTION_ALLOWED');assert.equal(event.auditClass,'CRITICAL_PRE_EFFECT');assert.equal(event.ledgerLocation,'CENTRAL');assert.equal(event.organizationId,null);assert.equal(event.tenantId,null);assert.equal(event.streamType,'OPERATIONS');assert.equal(event.streamId,'PLATFORM:OPERATIONS');assert.equal(event.source,'EU_EXPIRED_RECONCILIATION');assert.equal(event.decision,'ACCEPT');assert.equal(event.outcome,'SUCCESS');same(event.resource,{type:'EU_EXPIRED_RECONCILIATION',id:plan.planId});assert.equal(event.payload.detailCode,detail);assert.equal(event.payload.scopeDigest,plan.previewDigest);assert.equal(event.payload.semanticDigest,plans.hash(plan));
}
async function audit(client,input,before){
 const rows=(await client.query('SELECT event_data,event_hash FROM audit.event ORDER BY stream_id,sequence')).rows.map(r=>({...r.event_data,eventHash:r.event_hash})),streams=new Map(),proof={};
 for(const row of rows){const key=row.streamId;assert(typeof key==='string');if(!streams.has(key))streams.set(key,[]);streams.get(key).push(row);}
 for(const [key,events]of streams){const p=verifyEvents(events);assert.equal(p.valid,true,'RECONCILIATION_AUDIT_CHAIN');proof[key]={events:events.length,lastHash:p.lastHash};}
 const approval=input.approval.result.approval,matched=rows.filter(e=>e.eventId===approval.eventId);assert.equal(matched.length,1);assert.equal(matched[0].eventHash,approval.eventHash);auditBinding(matched[0],input.loaded.plan,approval.actorId,'EU_EXPIRED_RECONCILIATION_APPROVED');
 const events=rows.map(({eventId,eventHash})=>({eventId,eventHash}));if(!before){assertHistoricalAudit(input.baseline.central.audit.events,events);const applied=rows.filter(e=>e.eventId===input.executed.result.execution.requestId);assert.equal(applied.length,1);auditBinding(applied[0],input.loaded.plan,approval.actorId,'EU_EXPIRED_RECONCILIATION_APPLIED');assert.equal(applied[0].causationId,approval.eventId);assert.equal(applied[0].eventHash,input.receipt.effect_event_hash);
  const scoped=rows.filter(e=>e.resource?.type==='EU_EXPIRED_RECONCILIATION'&&e.resource.id===input.loaded.plan.planId);assert.equal(scoped.length,2,'RECONCILIATION_AUDIT_DUPLICATED');}
 return {streams:proof,events};
}
async function head11145(client){
 const ids=(await client.query("SELECT opportunity_id FROM opportunity_catalog.funding_identity WHERE external_identifier='CASCADE:11145' UNION SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace='EU_FUNDING_TENDERS' AND external_identifier='CASCADE:11145'")).rows;assert.equal(ids.length,1);
 const row=(await client.query('SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version,o.content_digest,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1',[ids[0].opportunity_id])).rows[0];assert.equal(row?.current_schema_version,2);
 const a=(await client.query('SELECT amount_canonical,amount::text AS amount,pg_typeof(amount)::text AS sql_type,currency_state,currency_code FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1 ORDER BY allocation_key',[row.current_revision_id])).rows;assert.equal(a.length,1);assert.equal(a[0].amount_canonical,'120000');assert.equal(a[0].sql_type,'numeric');assert(/^120000(?:\.0+)?$/.test(a[0].amount));assert.equal(a[0].currency_state,'NOT_FOUND');assert.equal(a[0].currency_code,null);
 const dates=(await client.query('SELECT payload FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1 ORDER BY ordinal',[row.current_revision_id])).rows.map(r=>r.payload);assert.equal(dates.length,7);same(dates,row.snapshot.schedule.deadlines.value);
 assert.equal(require('../backend/src/opportunities/v2/digests').contentDigestV2(row.snapshot),row.content_digest);
 return {opportunityId:row.opportunity_id,revisionId:row.current_revision_id,rowVersion:Number(row.row_version),contentDigest:row.content_digest,snapshotDigest:require('../backend/src/opportunities/v2/reconciliation').rawSnapshotDigest(row.snapshot),amount:120000,amountSqlType:'numeric',currencyState:'NOT_FOUND',deadlineCount:7};
}
async function receiptProof(client,input){
 const p=input.loaded.plan,read=async(sql,values)=>{const rows=(await client.query(sql,values)).rows;assert.equal(rows.length,1);return rows[0].value;};
 const receipt=await read('SELECT to_jsonb(t) AS value FROM opportunity_catalog.eu_expired_reconciliation_v1 t WHERE plan_id=$1',[p.planId]),permit=await read('SELECT to_jsonb(t) AS value FROM opportunity_catalog.eu_expired_permit_v1 t WHERE plan_id=$1',[p.planId]);
 const x=input.executed.result.execution,a=input.approval.result.approval;
 for(const r of [receipt,permit]){assert.equal(r.plan_id,p.planId);assert.equal(r.request_id,x.requestId);assert.equal(r.actor_id,a.actorId);assert.equal(r.run_id,p.runId);assert.equal(r.cycle_id,p.cycleId);assert.equal(r.source_fence,p.source.fence);assert.equal(r.preview_digest,p.previewDigest);assert.equal(r.plan_digest,plans.hash(p));assert.equal(r.approval_event_id,a.eventId);assert.equal(r.approval_event_hash,a.eventHash);assert.equal(r.effect_event_id,x.requestId);assert(SHA.test(r.effect_event_hash));}
 same(permit.before_state,p.preview);same(receipt.result,x.result);assert.equal(permit.effect_event_hash,receipt.effect_event_hash);assertTerminalRows(p.preview,permit.after_rows);
 const rows={run:await read('SELECT to_jsonb(t) AS value FROM opportunity_catalog.funding_run t WHERE run_id=$1',[p.runId]),cycle:await read('SELECT to_jsonb(t) AS value FROM opportunity_catalog.funding_cycle t WHERE cycle_id=$1',[p.cycleId]),inbox:await read("SELECT to_jsonb(t) AS value FROM async_exec.inbox t WHERE organization_id IS NULL AND consumer=$1 AND job_type=$2 AND job_version=$3 AND idempotency_key=$4",[p.preview.inbox.consumer,p.preview.inbox.job_type,p.preview.inbox.job_version,p.runId]),execution:await read('SELECT to_jsonb(t) AS value FROM async_exec.execution t WHERE execution_id=$1',[p.preview.execution.execution_id])};same(rows,permit.after_rows);
 same(await read('SELECT to_jsonb(t) AS value FROM async_exec.outbox t WHERE outbox_id=$1',[p.preview.outbox.outbox_id]),p.preview.outbox,'RECONCILIATION_OUTBOX_CHANGED');input.receipt=receipt;return {requestId:receipt.request_id,effectEventId:receipt.effect_event_id,effectEventHash:receipt.effect_event_hash,result:receipt.result,fourRowsExact:true,publishedOutboxUnchanged:true,originalExecutionLineageUnchanged:true};
}
async function transportEvidence(client,plan){
 const totals=(await client.query("SELECT state::text AS state,count(*)::int AS count FROM pgboss.job WHERE name='funding-tenders-refresh' GROUP BY state ORDER BY state")).rows;
 const target=(await client.query("SELECT count(*)::int AS count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex'),'' ORDER BY j.id),''),'UTF8')),'hex') AS digest FROM pgboss.job j WHERE data->>'executionId'=$1",[plan.preview.execution.execution_id])).rows[0];assert(Number.isSafeInteger(target?.count)&&target.count>=0&&SHA.test(target.digest));return {totals,target,executionId:plan.preview.execution.execution_id};
}
async function centralEvidence(client,input,before){
 const p=input.loaded.plan,observed=(await client.query(stateReader.PREVIEW_SQL,[p.cycleId])).rows[0];assert(observed?.preview);same(observed.preview.preservation,p.preview.preservation);assert.equal(p.preview.preservation.heads.count,538);assert.equal(p.preview.preservation.revisions.count,1502);assert.equal(p.preview.preservation.archives.count,138);
 const source=observed.preview.source;quietSource(source,p.source.fence,before?1:0);for(const k of ['expiredPendingRuns','unrecoverablePendingRuns'])assert.equal(source[k],before?1:0);assert.equal(source.incompatiblePendingRuns,0);
 let terminal;if(before){stateReader.assertPreview(observed.preview);same(observed.preview,p.preview);assert.equal(observed.preview_digest,p.previewDigest);for(const name of ['eu_expired_permit_v1','eu_expired_reconciliation_v1'])assert.equal((await client.query(`SELECT count(*)::int AS count FROM opportunity_catalog.${name} WHERE plan_id=$1`,[p.planId])).rows[0].count,0);}else terminal=await receiptProof(client,input);
 const coverage=(await client.query('SELECT state,count(*)::int AS count FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=$1 GROUP BY state ORDER BY state',[p.cycleId])).rows,decisions=(await client.query('SELECT decision,count(*)::int AS count FROM opportunity_catalog.eu_writer_decision_v2 d JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=$1 GROUP BY decision ORDER BY decision',[p.cycleId])).rows;
 const count=(rows,k,v)=>rows.find(r=>r[k]===v)?.count||0;assert.equal(count(coverage,'state','CONFLICT'),5);assert.equal(count(coverage,'state','PENDING')+count(coverage,'state','DISCOVERED'),393);assert.equal(count(decisions,'decision','REVIEW'),137);
 const preserved=await inventory(client,p),head=await head11145(client),transport=await transportEvidence(client,p);if(!before){same(preserved,input.baseline.central.inventory);same(head,input.baseline.central.head11145);same(coverage,input.baseline.central.coverage);same(decisions,input.baseline.central.decisions);same(transport,input.baseline.central.transport,'RECONCILIATION_TRANSPORT_CHANGED');}
 return {source,preservation:observed.preview.preservation,inventory:preserved,head11145:head,coverage,decisions,transport,...(terminal?{terminal}:{}),audit:await audit(client,input,before)};
}
function inputs(relative,before){
 const input=execute.loadExecution(relative),folder=path.posix.dirname(relative);input.folder=folder;
 if(before)assert(!fs.existsSync(path.join(cfg.root,folder,'execution.json')),'RECONCILIATION_EXECUTION_ALREADY_ATTEMPTED');
 else{const raw=readSafe(cfg.root,folder+'/execution.json'),e=JSON.parse(raw),b=readSafe(cfg.root,folder+'/before-reconciliation.json');input.executed=e;input.baseline=JSON.parse(b);input.evidence={execution:{path:folder+'/execution.json',sha256:sha(raw)},before:{path:folder+'/before-reconciliation.json',sha256:sha(b)}};
  assert.equal(e.kind,'eu-expired-reconciliation-authenticated-execution-v1');assert.equal(e.status,'PASS');assert.equal(e.planId,input.loaded.plan.planId);assert.equal(e.previewDigest,input.loaded.previewDigest);assert.equal(e.installation.sha256,input.executionDigest);assert.equal(e.installation.path,relative);same(e.approval,input.installation.approval);assert.equal(e.sessionFabricated,false);assert.equal(e.credentialsExported,false);assert.equal(e.newEnqueues,0);assert.equal(e.resumed,false);assert.equal(e.result.replayVerified,true);assert.equal(e.result.sourceControlUnchanged,true);assert.equal(e.result.newEnqueues,0);assert.equal(e.result.resumed,false);assert.equal(e.authentication.provider,'OIDC');assert.equal(e.authentication.actorId,input.installation.approval.actorId);
  execute.executionBinding(e.result.execution,{loaded:input.loaded,requestId:e.result.execution.requestId,actorId:input.installation.approval.actorId});
  assert.equal(input.baseline.kind,'eu-expired-reconciliation-before-verification-v1');assert.equal(input.baseline.status,'PASS');assert.equal(input.baseline.planId,input.loaded.plan.planId);assert.equal(input.baseline.installation.sha256,input.executionDigest);assert.equal(input.baseline.previewDigest,input.loaded.previewDigest);
 }return input;
}
async function readonly(pool,database,work){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal((await c.query('SELECT current_database() AS database')).rows[0].database,database);return await work(c);}finally{await c.query('ROLLBACK').catch(()=>{});c.release();}}
async function physicalBinding(central,state){
 const credentials={...state.credentials};delete credentials.workload;const runtime=require('../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:central,env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([credentials]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:state.snapshot.regionCode,policyVersion:state.snapshot.residencyPolicyVersion}])}}),pool=new Pool({host:credentials.host,port:credentials.port,database:credentials.database,user:credentials.login,password:credentials.password,ssl:credentials.ssl?{rejectUnauthorized:true}:false,max:1,options:OPTIONS,connectionTimeoutMillis:5000});
 try{await readonly(pool,credentials.database,client=>runtime.bindingVerifier.verify({client,snapshot:state.snapshot,requiredCapabilities:[installed.TENANT_CAPABILITY],correlationId:state.installationId,phase:'PREPARATION'}));return {physicalApiLogin:true,normalBindingVerifier:true};}finally{await Promise.all([pool.end(),runtime.poolManager.closeAll()]);}
}
async function main(argv=process.argv.slice(2)){
 const selected=args(argv),input=inputs(selected.relative,selected.before),filename=selected.before?'before-reconciliation.json':'after-reconciliation.json',file=path.join(cfg.root,input.folder,filename);assert(!fs.existsSync(file),'RECONCILIATION_VERIFICATION_ALREADY_EXISTS');
 const report={kind:`eu-expired-reconciliation-${selected.before?'before':'after'}-verification-v1`,status:'IN_PROGRESS',readOnly:true,planId:input.loaded.plan.planId,previewDigest:input.loaded.previewDigest,packageDigest:pkg.packageDigest,installation:{path:selected.relative,sha256:input.executionDigest},...(input.evidence?{evidence:input.evidence}:{}),startedAt:new Date().toISOString()},pools=[];
 try{const config=cfg.readConfig(),state=JSON.parse(readSafe(cfg.root,'.tmp/local-platform/runtime.json'));require('../backend/scripts/localPlatform/prepareOpportunityInterests').target(config,state);require('./eu-reconciliation-install.cjs').validateState(state);require('../backend/scripts/localPlatform/runtime').runtimeEnvironment(config,state);
  const central=new Pool({...cfg.connection(config,config.centralDatabase),max:2,options:OPTIONS}),tenant=new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options:OPTIONS});pools.push(central,tenant);
  const cp=await require('../backend/src/security/centralMigrationPreflight').preflightCentral(central);assert.equal(cp.currentVersion,pkg.entry.version);assert.equal(cp.fingerprint,pkg.entry.schemaFingerprint);assert.equal(cp.postgresMajor,18);report.centralAdmission={version:cp.currentVersion,fingerprint:cp.fingerprint};
  same(await require('../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central).resolveSnapshotByOrganization(state.organizationId,'API'),state.snapshot);report.binding=await physicalBinding(central,state);
  report.central=await readonly(central,config.centralDatabase,c=>centralEvidence(c,input,selected.before));report.tenant=await readonly(tenant,config.tenantDatabase,c=>require('../backend/scripts/localPlatform/prepareEuWriterWindow').readTenantEvidence(c,state));assert.equal(Object.keys(report.tenant.preservation).length,129);if(!selected.before)same(report.tenant,input.baseline.tenant,'RECONCILIATION_TENANT_CHANGED');
  same(execute.loadExecution(selected.relative),{loaded:input.loaded,installation:input.installation,approval:input.approval,executionDigest:input.executionDigest,relative:input.relative},'RECONCILIATION_CURRENT_INPUTS_CHANGED');
  report.health={ready:await require('./eu-reconciliation-window.cjs').health(),checkedAt:new Date().toISOString()};assert.equal(report.health.ready,true,'RECONCILIATION_HEALTH_NOT_READY');
  report.status='PASS';report.limitations=['Read-only per-database snapshots are not a distributed maintenance lock.','This proof verifies expiry reconciliation and preserved unresolved targets; it does not certify complete source coverage or authorize resume.','OIDC exchange is evidenced by the authenticated executor; persisted HUMAN audit events and receipts are checked independently here.','Only counts, identifiers and digests of private business data are exported.'];
 }catch(e){report.status='FAIL';report.failure=/^[A-Z0-9_]{3,120}$/.test(e.code||e.message||'')?e.code||e.message:'RECONCILIATION_VERIFICATION_FAILED';process.exitCode=1;}
 finally{await Promise.allSettled(pools.map(p=>p.end()));report.completedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,phase:selected.before?'BEFORE':'AFTER',planId:report.planId,evidence:path.relative(cfg.root,file).replaceAll('\\','/'),failure:report.failure||null}));}return report;
}
if(require.main===module)main().catch(()=>{console.error('RECONCILIATION_VERIFICATION_FAILED');process.exitCode=1;});
module.exports={args,assertTerminalRows,tableFilter,assertHistoricalAudit,auditBinding,inventory,head11145,centralEvidence,inputs,main};
