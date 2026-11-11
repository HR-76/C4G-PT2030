'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createOfficialSource, SOURCES } = require('../src/fundingTenders/officialSources');
const { createCandidateArchiveV2 } = require('../src/fundingTenders/candidateRepositoryV2');
const { createFundingRepository } = require('../src/fundingTenders/repository');
const observedAt = '2026-10-18T12:00:00.000Z';
const dir = path.join(__dirname, 'fixtures/official-programmes');
const bodies = new Map([[SOURCES.INTERREG_EUROPE.url, fs.readFileSync(path.join(dir,'interreg.xlsx'))],
  [SOURCES.POCTEP.url, fs.readFileSync(path.join(dir,'calendar.json'))],
  [SOURCES.POCTEP.details, fs.readFileSync(path.join(dir,'open.json'))]]);
function source(enabled = true) { return createOfficialSource({ canonicalV2Enabled: enabled, clock: () => Date.parse(observedAt),
  fetchImpl: async url => new Response(bodies.get(url), { headers: { 'content-type': url.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json' } }) }); }

test('official opt-in retains exact fetched bytes and one canonical candidate per eligible identity', async () => {
  const batch = await source().collect({source:'POCTEP'});
  assert.equal(batch.canonicalCandidates.length, batch.records.length);
  assert.equal(batch.canonicalEvidence.observedAt, batch.observedAt);
  for (const document of batch.canonicalEvidence.documents) assert.deepEqual(Buffer.from(document.bodyBase64,'base64'), bodies.get(document.url));
  assert.deepEqual(batch.canonicalCandidates.map(r=>r.externalIdentifier), batch.records.map(r=>r.externalIdentifier));
  assert.equal(batch.canonicalCandidates.find(r=>r.externalIdentifier.endsWith(':10')).canonicalSnapshot.financing.allocations.value[0].money.amount,'21000000');
});

test('official v1 contract remains unchanged by default and closed known calls stay eligible', async () => {
  const plain = await source(false).collect({source:'POCTEP'});
  assert.equal(plain.canonicalCandidates, undefined);
  const batch = await source().collect({source:'INTERREG_EUROPE',knownIdentifiers:['INTERREG_EUROPE:2021-2027:CALL:1']});
  assert.equal(batch.canonicalCandidates.length,1);
  assert.equal(batch.canonicalCandidates[0].externalIdentifier,'INTERREG_EUROPE:2021-2027:CALL:1');
  assert.deepEqual(batch.records[0], (await source(false).collect({source:'INTERREG_EUROPE',knownIdentifiers:['INTERREG_EUROPE:2021-2027:CALL:1']})).records[0]);
});

test('official canonical option rejects truthy configuration coercion', () => {
  assert.throws(()=>createOfficialSource({fetchImpl:async()=>{},canonicalV2Enabled:'true'}),TypeError);
});

function database(sourceCode='POCTEP') {
  const run={run_id:randomUUID(),fence:1,source_code:sourceCode,requested_by:randomUUID(),collected:false,observed_at:observedAt};
  const state={run,archives:new Map(),items:new Map(),commands:[],queries:[],revoked:false,stale:false};
  const client={release(){},async query(sql,p=[]){
    state.queries.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK','RESET ROLE'].includes(sql)||sql.startsWith('SET LOCAL'))return {rows:[],rowCount:0};
    if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:state.revoked?[]:[{id:run.requested_by}]};
    if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run WHERE'))return {rows:state.stale?[]:[run]};
    if(sql.startsWith('INSERT INTO opportunity_catalog.funding_candidate_v2')){
      if(state.archives.has(p[1]))return {rows:[],rowCount:0};
      state.archives.set(p[1],{run_id:p[0],external_identifier:p[1],source_selection:p[2],observed_at:new Date(p[3]),snapshot_schema_version:2,mapping_version:p[4],content_digest:p[5],payload_digest:p[6],canonical_snapshot:JSON.parse(p[7]),source_evidence:JSON.parse(p[8]),evidence_fingerprint:p[9],evidence_sha256:p[10]});
      return {rows:[{payload_digest:p[6]}],rowCount:1};
    }
    if(sql.startsWith('SELECT payload_digest FROM opportunity_catalog.funding_candidate_v2')||sql.startsWith('SELECT run_id,external_identifier,source_selection'))return {rows:state.archives.has(p[1])?[state.archives.get(p[1])]:[]};
    if(sql.startsWith('UPDATE opportunity_catalog.funding_run SET canonical_v2_required')){run.canonical_v2_required=true;return {rows:[{run_id:run.run_id}],rowCount:1};}
    if(sql.startsWith('INSERT INTO opportunity_catalog.funding_run_item')){state.items.set(p[1],{external_identifier:p[1],source_fields:structuredClone(p[2])});return {rows:[],rowCount:1};}
    if(sql.startsWith('UPDATE opportunity_catalog.funding_run SET collected=')){Object.assign(run,{collected:true,observed_at:p[1]});return {rows:[],rowCount:1};}
    if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run_item'))return {rows:[state.items.get(p[1])].filter(Boolean)};
    if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_identity'))return {rows:[]};
    if(sql.startsWith('INSERT INTO opportunity_catalog.funding_identity')||sql.startsWith('INSERT INTO opportunity_catalog.funding_observation'))return {rows:[],rowCount:1};
    if(sql.startsWith('UPDATE opportunity_catalog.funding_identity SET source_review='))return {rows:[],rowCount:1};
    if(sql.startsWith('UPDATE opportunity_catalog.funding_run_item SET result=')){state.items.get(p[1]).result=p[2];return {rows:[],rowCount:1};}
    if(/^UPDATE opportunity_catalog.funding_run SET (created|updated|unchanged)_count=/.test(sql))return {rows:[],rowCount:1};
    throw Error('Unexpected query '+sql);
  }};
  const catalog={withTransactionClient:async(_,work)=>work(),async create(command){state.commands.push(command);return {opportunityId:randomUUID(),revisionId:randomUUID()};}};
  const repository=(archive=true)=>createFundingRepository({pool:{connect:async()=>client},catalog,audit:async()=>{},coverageEnabled:true,refreshEnabled:true,enrichmentEnabled:true,candidateArchive:archive?createCandidateArchiveV2():null});
  return {run,state,client,repository};
}

test('official bulk archives each candidate before legacy application and revalidates after restart', async()=>{
  const db=database(),batch=await source().collect({source:'POCTEP'});
  await db.repository().stage(db.run,batch);
  assert.equal(db.state.archives.size,2);assert.equal(db.run.canonical_v2_required,true);assert.equal(db.state.commands.length,0);
  const id=batch.records[0].externalIdentifier;
  const verified=await createCandidateArchiveV2().verify(db.client,{run:db.run,externalIdentifier:id});
  assert.deepEqual(verified.sourceFields,batch.records[0].fields);
  await db.repository().apply(db.run,db.state.items.get(id));
  assert.equal(db.state.commands.length,1);assert.equal(db.state.commands[0].snapshot.schemaVersion,1);
  assert.equal(db.state.commands[0].snapshot.canonicalSnapshot,undefined);
});

test('official restart cannot downgrade archive requirement or apply altered legacy fields', async()=>{
  for(const mode of ['no-port','missing','fields','money','hash','time']){
    const db=database(),batch=await source().collect({source:'POCTEP'});
    await db.repository().stage(db.run,batch);
    const id=batch.records[0].externalIdentifier,item=db.state.items.get(id),row=db.state.archives.get(id);
    if(mode==='missing')db.state.archives.delete(id);
    if(mode==='fields')item.source_fields.title='Tampered';
    if(mode==='money')row.canonical_snapshot.financing.allocations.value[0].money.amount='1';
    if(mode==='hash')row.evidence_sha256='a'.repeat(64);
    if(mode==='time')db.run.observed_at='2026-10-19T12:00:00.000Z';
    await assert.rejects(db.repository(mode!=='no-port').apply(db.run,item),{code:mode==='no-port'?'FUNDING_V2_ARCHIVE_REQUIRED':'FUNDING_V2_CANDIDATE_INVALID'},mode);
    assert.equal(db.state.commands.length,0,mode);
  }
});

test('official packet completeness and current authority are checked before staging',async()=>{
  for(const mode of ['no-port','missing','duplicate','fields','source','revoked','stale']){
    const db=database(),batch=structuredClone(await source().collect({source:'POCTEP'}));
    if(mode==='missing')delete batch.canonicalCandidates;
    if(mode==='duplicate')batch.canonicalCandidates[1]=batch.canonicalCandidates[0];
    if(mode==='fields')batch.records[0].fields.title='Tampered';
    if(mode==='source')db.run.source_code='INTERREG_EUROPE';
    if(mode==='revoked')db.state.revoked=true;
    if(mode==='stale')db.state.stale=true;
    await assert.rejects(db.repository(mode!=='no-port').stage(db.run,batch));
    assert.equal(db.state.items.size,0,mode);assert.equal(db.state.commands.length,0,mode);
  }
});

test('official archive replay is exact and refuses a different snapshot for the same run',async()=>{
  const db=database(),batch=await source().collect({source:'POCTEP'});
  await db.repository().stage(db.run,batch);
  const id=batch.records[0].externalIdentifier,row=db.state.archives.get(id),archive=createCandidateArchiveV2();
  const packet={outcome:'FOUND',observedAt,received:row.source_evidence.sourceEvidence.documents.length,
    record:batch.records[0],evidence:row.source_evidence,canonicalSnapshot:row.canonical_snapshot};
  assert.equal((await archive.stage(db.client,{run:db.run,batch:packet})).stored,false);
  row.payload_digest='f'.repeat(64);
  await assert.rejects(archive.stage(db.client,{run:db.run,batch:packet}),{code:'FUNDING_V2_CANDIDATE_REPLAY_CONFLICT'});
});

test('empty official selection still validates evidence, source binding and aggregate counts',async()=>{
  for(const mode of ['valid','empty-evidence','source','time','count']){
    const db=database('INTERREG_EUROPE'),batch=structuredClone(await source().collect({source:'INTERREG_EUROPE'}));
    assert.equal(batch.records.length,0);
    if(mode==='empty-evidence')batch.canonicalEvidence={};
    if(mode==='source')db.run.source_code='POCTEP';
    if(mode==='time')batch.observedAt='2026-10-19T12:00:00.000Z';
    if(mode==='count')batch.received=0;
    if(mode==='valid'){await db.repository().stage(db.run,batch);assert.equal(db.run.canonical_v2_required,true);}
    else {await assert.rejects(db.repository().stage(db.run,batch),{code:'FUNDING_V2_CANDIDATE_INVALID'},mode);assert.equal(db.run.collected,false);}
  }
});

test('official batch cannot conceal eligible or known calls by forging excluded counts',async()=>{
  for(const sourceCode of ['POCTEP','INTERREG_EUROPE']){
    const db=database(sourceCode);
    db.run.knownIdentifiers=sourceCode==='INTERREG_EUROPE'?['INTERREG_EUROPE:2021-2027:CALL:1']:[];
    const batch=structuredClone(await source().collect({source:sourceCode,knownIdentifiers:db.run.knownIdentifiers}));
    assert.ok(batch.records.length>0);
    batch.records=[];batch.canonicalCandidates=[];batch.excluded=batch.received;
    await assert.rejects(db.repository().stage(db.run,batch),{code:'FUNDING_V2_CANDIDATE_INVALID'});
    assert.equal(db.run.collected,false);assert.equal(db.state.commands.length,0);
  }
});
