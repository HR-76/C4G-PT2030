'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {createApplicationDocumentTransport}=require('../src/documents/applicationTransport');
const {createApplicationDocumentsRepository}=require('../src/applications/documentsReview');
const {createApplicationDocumentAuthorizationAdapter}=require('../src/applications/documentAuthorizationAdapter');
const {createTaxonomySessionAuthority}=require('../src/security/authenticatedAuthority');
const {publicApplicationError,requireApplicationOrganizationContext}=require('../src/routes/applicationSliceRoutes');
const {createDocumentWorker}=require('../src/documents/worker');
const {isTrustedResult}=require('../src/async/jobResult');
const {candidate,read}=require('../src/documents/multipartMigration');
const {createF11ObjectStorageDouble}=require('./support/f11ObjectStorageDouble');
const {transaction}=require('../src/documents/postgresWorkerPorts');
const ORG='11111111-1111-4111-8111-111111111111',APP='22222222-2222-4222-8222-222222222222';
const ids=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
const bytes=Buffer.from('%PDF-1.7\nDOC-MVP-01');
for(const aborted of [true,false,null]){
 test(`multipart cleanup records only a confirmed provider abort (${aborted})`,async()=>{
  const providerUploadId='fixture-upload',uploadError=new Error('UPLOAD_PART_FAILED');
  const size=require('../src/documents/constants').LIMITS.multipartThreshold;
  const storage={...createF11ObjectStorageDouble(),
   async beginMultipart(){return {objectId:APP,multipartSessionId:providerUploadId};},
   async writePart(){throw uploadError;},
   async abort(){if(aborted===null)throw new Error('STORAGE_UNAVAILABLE');return {aborted};}
  };
  const closed=[];let capability;
  const repository={
   async createIntent(value){capability={...value,digest:value.capabilityDigest,expiresAt:value.capabilityExpiresAt};},
   async loadCapability(){return capability;},async consumeCapability(){return true;},
   async registerMultipart(){},async abortMultipart(input){closed.push(input.providerUploadId);}
  };
  const transport=createApplicationDocumentTransport({
   accessPort:{async authorize(){return {context:{actor:{id:'actor',organizationId:ORG},correlationId:APP}};}},
   repositoryFactory:()=>repository,storageFactory:()=>storage,
   auditFactory:()=>({async accept(){}}),reconciliationFactory:()=>({async record(){}}),
   jobs:{async enqueueScan(){assert.fail('failed upload must not enqueue');}},clock:()=>new Date('2026-10-24T10:00:00Z')
  });
  const input={expectedSize:size,declaredMime:'application/pdf',filename:'fixture.pdf',fileClass:'PDF',checksum:'a'.repeat(64),idempotencyKey:APP,versionNumber:1};
  const intent=await transport.createIntent({request:{},applicationId:APP,input});
  await assert.rejects(transport.upload({request:{},applicationId:APP,versionId:intent.versionId,token:intent.capability,source:Readable.from([Buffer.alloc(size)])}),error=>error===uploadError);
  assert.deepEqual(closed,aborted===true?[providerUploadId]:[]);
 });
}
test('DOC-MVP-01 transport keeps application authorization ahead of storage and confirms before enqueue',async()=>{
 const calls=[],storage=createF11ObjectStorageDouble(),records=new Map();let capability;
 const repository={async createIntent(value){calls.push('create');capability={digest:value.capabilityDigest,expiresAt:value.capabilityExpiresAt,consumedAt:null,revokedAt:null,organizationId:ORG,actorId:'actor',resourceId:APP,versionId:value.versionId,objectId:value.objectId,expectedSize:value.expectedSize,fileClass:value.fileClass,checksum:value.checksum,declaredMime:value.declaredMime,displayFilename:value.displayFilename};records.set(value.versionId,{...value,state:'PENDING',scanState:'NOT_REQUESTED'});},async loadCapability(){return capability},async consumeCapability(){calls.push('consume');return true},async transition(value){calls.push(value.toState);const current=records.get(value.versionId)||{};records.set(value.versionId,{...current,...value,state:value.toState,scanState:value.scanState,objectId:capability.objectId,displayFilename:capability.displayFilename});return value},async findConfirmation(){return null},async confirm(value){calls.push('confirm');return value},async findVersion({versionId}){return records.get(versionId)||null}};
 const transport=createApplicationDocumentTransport({accessPort:{async authorize(){calls.push('authorize');return {context:{actor:{id:'actor',organizationId:ORG},correlationId:APP}}}},repositoryFactory:()=>repository,storageFactory:()=>storage,auditFactory:()=>({accept:async()=>{},emit:async()=>{}}),reconciliationFactory:()=>({record:async()=>{}}),jobs:{async enqueueScan(){calls.push('enqueue')}},clock:()=>new Date('2026-10-24T10:00:00Z'),id:()=>ids.shift()});
 const checksum=crypto.createHash('sha256').update(bytes).digest('hex'),intent=await transport.createIntent({request:{},applicationId:APP,input:{expectedSize:bytes.length,declaredMime:'application/pdf',filename:'proposal.pdf',fileClass:'PDF',checksum,idempotencyKey:APP,versionNumber:1}});
 await transport.upload({request:{},applicationId:APP,versionId:intent.versionId,token:intent.capability,source:Readable.from([bytes])});
 assert.equal(calls[0],'authorize');assert.ok(calls.indexOf('confirm')<calls.indexOf('enqueue'));assert.equal(records.get(intent.versionId).state,'SCANNING');
});
test('DOC-MVP-01 multipart migration is admitted only against the measured canonical tenant baseline',()=>{const entry=candidate();assert.equal(entry.ordinal,31);assert.equal(entry.admitted,true);assert.equal(entry.evidence,'GROUP_B_POSTGRES_17_CANONICAL_2026_10_24');assert.equal(entry.schemaFingerprint,'11b8e09294f53d4acffc9a8be25075930554efb30f429e9df25c28edcada9674');for(const token of ['multipart_upload','provider_upload_id','claim_expired_multipart_uploads','ENABLE ROW LEVEL SECURITY','DOCUMENT_TENANT_CONTEXT_INVALID','REVOKE INSERT ON document_storage.multipart_part'])assert.ok(read('up').includes(token));});
test('DOC-MVP-01 worker is dedicated to the three closed F11 job types',()=>{const runtime=createDocumentWorker({portsForOrganization:()=>({repository:{},storage:{},scanService:{},audit:{}})});assert.deepEqual(runtime.registry.types,['document.scan','document.reconcile','document.expire_upload']);});
test('DOC-MVP-01 worker normalizes PostgreSQL bigint strings before scanner invocation',async()=>{
 let observed;const row={organization_id:ORG,version_id:APP,object_id:ids[0],lock_version:'4',observed_size:'40',expected_size:'40',sha256:'a'.repeat(64),expected_sha256:'a'.repeat(64),expected_file_class:'OOXML',declared_mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',display_filename:'evidence.docx',state:'SCANNING',scan_state:'PENDING'};
 const runtime=createDocumentWorker({portsForOrganization:()=>({repository:{async findVersion(){return row}},storage:{},scanService:{async scan({record}){observed=record;return record}},audit:{},reconciliation:{}})});
 await runtime.handlers['document.scan']({payload:{organizationId:ORG,versionId:APP},fencingToken:'fence'});
 assert.equal(observed.lockVersion,4);assert.equal(observed.observedSize,40);assert.equal(observed.expectedSize,40);assert.equal(observed.declaredMime,row.declared_mime);assert.equal(observed.displayFilename,row.display_filename);
});
test('DOC-MVP-01 worker propagates lifecycle cancellation and the trusted fence assertion outside payload',async()=>{
 const controller=new AbortController();let observed=null;
 const runtime=createDocumentWorker({portsForOrganization:()=>({repository:{async findVersion(){return {organization_id:ORG,version_id:APP,state:'SCANNING'}}},storage:{},scanService:{async scan(input){observed=input;return input.record}},audit:{}})});
 const assertFence=async()=>true;
 await runtime.handlers['document.scan']({payload:{organizationId:ORG,versionId:APP},fencingToken:7,signal:controller.signal,assertFence});
 assert.equal(observed.signal,controller.signal);assert.equal(observed.assertFence,assertFence);assert.equal(Object.hasOwn(observed.record,'signal'),false);
 controller.abort();
 await assert.rejects(()=>runtime.handlers['document.scan']({payload:{organizationId:ORG,versionId:APP},fencingToken:8,signal:controller.signal,assertFence}),error=>error.code==='WORKER_DRAINING');
});
test('DOC-MVP-01 API and document worker retain their capabilities with the additive chat schema',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.resolve(__dirname,'../src/applications/composition.js'),'utf8');
 const worker=require('../src/config/documentWorkerInfrastructure');
 const {manifest,applicationChatManifest}=require('../src/security/tenantMigrationManifest');
 assert.match(source,/compatibleSchemaVersions:[^\n]+031_application_document_transport[^\n]+032_document_worker_runtime/);
 assert.match(source,/compatibleSchemaVersions:[^\n]+033_organizational_opportunity_interests/);
 assert.equal(worker.SCHEMA_VERSION,'032_document_worker_runtime');
 assert.deepEqual(worker.SCHEMA_VERSIONS,['032_document_worker_runtime','033_organizational_opportunity_interests','034_application_snapshot_v2','036_application_team_chat']);
 for(const head of [manifest.at(-1),applicationChatManifest.at(-1)]){
  assert.ok(worker.SCHEMA_VERSIONS.includes(head.version));
  assert.ok(head.capabilities.includes('APPLICATION_DOCUMENT_TRANSPORT'));
  assert.ok(head.capabilities.includes('DOCUMENT_WORKER_RUNTIME'));
  assert.ok(worker.REQUIRED.every(capability=>head.capabilities.includes(capability)));
 }
});
test('DOC-MVP-01 reconciliation resumes a confirmed upload before scanning',async()=>{
 const calls=[],checksum=crypto.createHash('sha256').update(bytes).digest('hex'),row={organization_id:ORG,version_id:APP,object_id:ids[0],lock_version:3,observed_size:bytes.length,expected_size:bytes.length,sha256:checksum,expected_sha256:checksum,expected_file_class:'PDF',state:'UPLOADED',scan_state:'PENDING'};
 const repository={async claimExpiredMultipart(){return []},async claimTransportRecovery(){return [row]},async findConfirmation(){return null},async confirm(){calls.push('confirm');return row},async transition(){calls.push('scanning');return {...row,lock_version:4,state:'SCANNING'}}};
 const runtime=createDocumentWorker({portsForOrganization:()=>({repository,storage:{},scanService:{async scan({record}){calls.push(`scan:${record.state}`)}},audit:{async emit(){}},reconciliation:{async record(){}}})});
 const result=await runtime.handlers['document.reconcile']({payload:{organizationId:ORG},fencingToken:'fence'});
 assert.deepEqual(calls,['confirm','scanning','scan:SCANNING']);assert.deepEqual(result.recovered,[APP]);assert.equal(isTrustedResult(result.jobResult,'SUCCESS'),true);
});
test('DOC-MVP-01 Group C recovery fixture respects the five-minute recovery eligibility window',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const migration=read('up'),gate=fs.readFileSync(path.resolve(__dirname,'../../test/integration/doc-mvp-01/group-c-r2.js'),'utf8');
 assert.match(migration,/state='UPLOADING' AND v\.updated_at<=transaction_timestamp\(\)-interval '5 minutes'/);
 assert.match(gate,/SET updated_at=transaction_timestamp\(\)-interval '6 minutes'[\s\S]+state='UPLOADING'/);
});
test('DOC-MVP-01 intent input is closed after application authorization',async()=>{
 let authorized=0,created=0;
 const transport=createApplicationDocumentTransport({accessPort:{async authorize(){authorized+=1;return {context:{actor:{id:'actor',organizationId:ORG}}}}},repositoryFactory:()=>({async createIntent(){created+=1}}),storageFactory:()=>({}),auditFactory:()=>({}),reconciliationFactory:()=>({}),jobs:{},clock:()=>new Date(),id:crypto.randomUUID});
 await assert.rejects(()=>transport.createIntent({request:{},applicationId:APP,input:{expectedSize:1,declaredMime:'application/pdf',filename:'a.pdf',fileClass:'PDF',checksum:'0'.repeat(64),idempotencyKey:APP,versionNumber:1,organizationId:ORG}}),error=>error.code==='DOCUMENT_INTENT_INVALID');
 assert.equal(authorized,1);assert.equal(created,0);
});
test('DOC-MVP-01 application transport authorizes the opaque resource before lookup and preserves the guarded decision',async()=>{
 const calls=[],OPP='66666666-6666-4666-8666-666666666666';let allowed=false;
 const repository=createApplicationDocumentsRepository({organizationId:ORG,actor:{id:'actor',membershipId:APP},cursor:{},audit:async()=>{},
  authorize:async operation=>{calls.push(`authorize:${operation}`);return allowed},protect:async()=>calls.push('protect')});
 const client={async query(){calls.push('lookup');return {rows:[{opportunity_id:OPP,evaluation_id:null}]}}};
 await assert.rejects(()=>repository.documentTransportAccess(client,APP,{operationCode:'DOCUMENT_UPLOAD_INITIATE'}),error=>error.code==='NOT_AUTHORIZED');
 assert.deepEqual(calls,['authorize:APPLICATION_DOCUMENT_EDIT']);calls.length=0;allowed=true;
 await repository.documentTransportAccess(client,APP,{operationCode:'DOCUMENT_UPLOAD_INITIATE'});
 assert.deepEqual(calls,['authorize:APPLICATION_DOCUMENT_EDIT','authorize:DOCUMENT_UPLOAD_INITIATE','lookup','protect']);
});
test('DOC-MVP-01 document reads reject missing grants before protected lookup or signing',async()=>{
 const calls=[],repository=createApplicationDocumentsRepository({organizationId:ORG,actor:{id:'actor',membershipId:APP},cursor:{},audit:async()=>{},
  authorize:async operation=>{calls.push(`authorize:${operation}`);return false},protect:async()=>calls.push('protect')});
 const client={async query(){calls.push('lookup');return {rows:[]}}};
 await assert.rejects(()=>repository.documentDownload(client,APP,{versionId:ids[0]}),error=>error.code==='NOT_AUTHORIZED');
 assert.deepEqual(calls,['authorize:APPLICATION_DOCUMENT_READ']);
});
test('DOC-MVP-01 public HTTP errors distinguish session, membership, grants, hidden resources and authority outages',()=>{
 assert.deepEqual(publicApplicationError(Object.assign(new Error(),{code:'AUTHORITY_REQUIRED',authorityFailure:'SESSION_INVALID'})),{code:'SESSION_REQUIRED',status:401});
 assert.deepEqual(publicApplicationError(Object.assign(new Error(),{code:'AUTHORITY_REQUIRED',authorityFailure:'MEMBERSHIP_INVALID'})),{code:'NOT_AUTHORIZED',status:403});
 assert.deepEqual(publicApplicationError(Object.assign(new Error(),{code:'NOT_AUTHORIZED'})),{code:'NOT_AUTHORIZED',status:403});
 assert.deepEqual(publicApplicationError(Object.assign(new Error(),{code:'AUTHORITY_DENIED'})),{code:'RESOURCE_NOT_AVAILABLE',status:404});
 assert.deepEqual(publicApplicationError(Object.assign(new Error(),{code:'AUTHORITY_UNAVAILABLE'})),{code:'SERVICE_UNAVAILABLE',status:503});
 assert.deepEqual(publicApplicationError(Object.assign(new Error(),{code:'AUTHORITY_REQUIRED'})),{code:'SERVICE_UNAVAILABLE',status:503});
 assert.deepEqual(publicApplicationError(new Error('database offline')),{code:'SERVICE_UNAVAILABLE',status:503});
});
test('DOC-MVP-01 application organization middleware maps revoked membership to 403 without invoking the tenant route',()=>{
 let fallback=0,next=0,status=null,body=null;
 const middleware=requireApplicationOrganizationContext({requireOrganizationContext(){fallback+=1}});
 middleware({organizationContextState:'INVALID'},{status(value){status=value;return this},json(value){body=value}},()=>{next+=1});
 assert.equal(status,403);assert.deepEqual(body,{error:{code:'NOT_AUTHORIZED'}});assert.equal(fallback,0);assert.equal(next,0);
 middleware({organizationContextState:'NONE'},{},()=>{});
 assert.equal(fallback,1);
});
test('DOC-MVP-01 authenticated authority classifies revoked membership without disguising infrastructure failure',async()=>{
 const actor='77777777-7777-4777-8777-777777777777',membershipId='88888888-8888-4888-8888-888888888888',sid='synthetic-session';
 const context={organizationId:ORG,membershipId,membershipVersion:3},auth={user:{id:actor},evidence:{policyVersion:'policy-v1'},organizationContext:context,
  policyVersion:'policy-v1',revocationVersion:1,absoluteExpiresAt:Date.parse('2030-01-01T01:00:00Z')};
 const request={sessionID:sid,user:{id:actor},authContext:{sessionId:sid},organizationContext:context};
 const build=({stored=auth,membership={id:membershipId,organizationId:ORG,globalUserId:actor,membershipVersion:3,status:'ACTIVE',validUntil:null},membershipError=null}={})=>createTaxonomySessionAuthority({
  sessionStore:{get(_sid,callback){callback(null,{auth:stored})}},sessionRegistry:{validateSession:async()=>true,resolveOrganizationContext:async()=>({state:'VALID',context,expiresAt:Date.parse('2030-01-01T01:00:00Z')})},
  membershipPort:{async revalidate(){if(membershipError)throw membershipError;return membership}},authorizationDataPort:{async load(){return {organizationId:ORG,membershipVersion:3,authorizationVersion:7}}},
  policyVersion:'policy-v1',clock:{now:()=>new Date('2030-01-01T00:00:00Z')}});
 await assert.rejects(()=>build({stored:{...auth,absoluteExpiresAt:Date.parse('2029-12-31T23:59:59Z')}}).captureAuthenticatedRequest(request),error=>error.code==='AUTHORITY_REQUIRED'&&error.authorityFailure==='SESSION_INVALID');
 await assert.rejects(()=>build({membership:{id:membershipId,organizationId:ORG,globalUserId:actor,membershipVersion:3,status:'REVOKED',validUntil:null}}).captureAuthenticatedRequest(request),error=>error.code==='AUTHORITY_REQUIRED'&&error.authorityFailure==='MEMBERSHIP_INVALID');
 const unavailable=new Error('synthetic authority outage');
 await assert.rejects(()=>build({membershipError:unavailable}).captureAuthenticatedRequest(request),error=>error===unavailable);
});
test('DOC-MVP-01 application authorization adapter maps missing and foreign resources uniformly',async()=>{
 for(const failure of [Object.assign(new Error('foreign'),{code:'TENANT_OPERATION_UNAVAILABLE'}),Object.assign(new Error('missing'),{code:'RESOURCE_NOT_AVAILABLE'})]){
  const adapter=createApplicationDocumentAuthorizationAdapter({applicationService:{async execute(){throw failure}}});
  await assert.rejects(()=>adapter.authorize({request:{},applicationId:APP,operationCode:'DOCUMENT_UPLOAD_INITIATE'}),error=>error.code==='DOCUMENT_NOT_AVAILABLE');
 }
});
test('DOC-MVP-01 application authorization adapter preserves classified access refusal before storage',async()=>{
 for(const failure of [Object.assign(new Error(),{code:'AUTHORITY_REQUIRED',authorityFailure:'MEMBERSHIP_INVALID'}),Object.assign(new Error(),{code:'NOT_AUTHORIZED'}),Object.assign(new Error(),{code:'AUTHORITY_UNAVAILABLE'})]){
  const adapter=createApplicationDocumentAuthorizationAdapter({applicationService:{async execute(){throw failure}}});
  await assert.rejects(()=>adapter.authorize({request:{},applicationId:APP,operationCode:'DOCUMENT_UPLOAD_INITIATE'}),error=>error===failure);
 }
});
test('DOC-MVP-01 application authorization adapter creates a trusted UUIDv7 correlation for critical audit',async()=>{
 const generated='019a1a2b-3c4d-7e5f-8123-456789abcdef',requestCorrelation=crypto.randomUUID();
 const adapter=createApplicationDocumentAuthorizationAdapter({applicationService:{async execute(){return {organizationId:ORG,actor:{id:'actor',organizationId:ORG}}}},correlationId:()=>generated});
 const result=await adapter.authorize({request:{id:requestCorrelation,correlationId:requestCorrelation,signal:null},applicationId:APP,operationCode:'DOCUMENT_UPLOAD_INITIATE'});
 assert.equal(result.context.correlationId,generated);assert.equal(result.context.signal,null);assert.notEqual(result.context.correlationId,requestCorrelation);
});
test('DOC-MVP-01 lost intent responses reuse the stable operation without duplicating the document version',async()=>{
 const generated=['99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999992','99999999-9999-4999-8999-999999999993'];
 const correlations=['019a1a2b-3c4d-7e5f-8123-456789abc001','019a1a2b-3c4d-7e5f-8123-456789abc002'];
 const accepted=[];let existing=null,created=0,reissued=0;
 const repository={
  async findIntent(){return existing},
  async createIntent(value){created+=1;existing={version_id:value.versionId,document_id:value.documentId,organization_id:value.organizationId,version_number:value.versionNumber,object_id:value.objectId,expected_size:value.expectedSize,expected_file_class:value.fileClass,expected_sha256:value.checksum,declared_mime:value.declaredMime,display_filename:value.displayFilename,state:'PENDING',scan_state:'NOT_REQUESTED',idempotency_key:value.idempotencyKey,resource_id:value.resourceId,created_by_actor_id:value.actorId}},
  async addCapability(){reissued+=1}
 };
 const transport=createApplicationDocumentTransport({
  accessPort:{async authorize(){return {context:{actor:{id:'actor',organizationId:ORG},correlationId:correlations.shift()}}}},
  repositoryFactory:()=>repository,storageFactory:()=>createF11ObjectStorageDouble(),auditFactory:()=>({async accept(_event,input){accepted.push(input.context.correlationId)},async emit(){}}),reconciliationFactory:()=>({async record(){}}),jobs:{async enqueueScan(){}},clock:()=>new Date('2026-10-24T10:00:00Z'),id:()=>generated.shift()
 });
 const input={expectedSize:bytes.length,declaredMime:'application/pdf',filename:'proposal.pdf',fileClass:'PDF',checksum:crypto.createHash('sha256').update(bytes).digest('hex'),idempotencyKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',versionNumber:1};
 const first=await transport.createIntent({request:{},applicationId:APP,input});
 const replay=await transport.createIntent({request:{},applicationId:APP,input});
 assert.equal(created,1);assert.equal(reissued,1);assert.equal(replay.replayed,true);assert.equal(replay.documentId,first.documentId);assert.equal(replay.versionId,first.versionId);assert.notEqual(replay.capability,first.capability);assert.deepEqual(accepted,['019a1a2b-3c4d-7e5f-8123-456789abc001','019a1a2b-3c4d-7e5f-8123-456789abc002']);
 await assert.rejects(()=>transport.createIntent({request:{},applicationId:APP,input:{...input,checksum:'f'.repeat(64)}}),error=>error.code==='IDEMPOTENCY_CONFLICT');
 assert.equal(created,1);
});
test('DOC-MVP-01 audit role is transaction-local and rollback restores it on error',async()=>{
 async function run(fail){const queries=[];let released=0;const client={async query(sql,values){queries.push({sql,values});return {rows:[]}},release(){released+=1}};const pool={async connect(){return client}};const cause=new Error('synthetic audit failure');
  if(fail)await assert.rejects(()=>transaction(pool,'c4g_audit_writer',ORG,async()=>{throw cause}),error=>error===cause);else await transaction(pool,'c4g_audit_writer',ORG,async()=>Object.freeze({status:'APPENDED'}));return {queries,released};}
 const success=await run(false),failure=await run(true);
 assert.deepEqual(success.queries.map(item=>item.sql),['BEGIN','SET LOCAL ROLE "c4g_audit_writer"',"SELECT set_config('app.organization_id',$1,true)",'COMMIT']);
 assert.deepEqual(failure.queries.map(item=>item.sql),['BEGIN','SET LOCAL ROLE "c4g_audit_writer"',"SELECT set_config('app.organization_id',$1,true)",'ROLLBACK']);
 assert.equal(success.released,1);assert.equal(failure.released,1);assert.equal(success.queries.some(item=>item.sql.includes('c4g_document_runtime')),false);
});
