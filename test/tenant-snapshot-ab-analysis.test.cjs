'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const analysis=require('./integration/tenant-snapshot-ab/analyze.cjs');
test('HTTP invariance includes both tenant snapshots at every restricted-function checkpoint',()=>{
  const row={scenario:'report-c1',completeMetrics:true,queryCount:1195,transactionCount:52,centralBaseQueryCount:25,authoritySecurityQueryCount:50,centralCheckpointCount:25,tenantMetadataCheckpointCount:3,tenantBaseQueryCount:6};
  assert.equal(analysis.checkpointCounts(row).valid,true);
  assert.equal(analysis.checkpointCounts({...row,tenantBaseQueryCount:3}).valid,false);
  assert.equal(analysis.checkpointCounts({...row,tenantBaseQueryCount:7}).valid,false);
});
test('new analysis cannot silently accept a historical continuation population',()=>{
  assert.throws(()=>analysis.main(['manifest','ready','M','H','continuation']),/Usage/);
});
function metadataFixture(){
  const {createHash}=require('node:crypto');
  const hashes=arm=>Array.from({length:25},(_,i)=>createHash('sha256').update(i===0?arm:'shared-'+i).digest('hex'));
  const fingerprints=['f'.repeat(64),'e'.repeat(64)],proof={tenantBaselines:{'043':fingerprints},tenantSqlHashes:{'043':[{A:hashes('A'),B:hashes('B')},{A:hashes('A'),B:hashes('B')}]}};
  const populations=[0,1].map(tenantIndex=>{
    const m={status:'PASS',mode:'measure',revision:'034_application_snapshot_v2',tenantIndex,clock:'MONOTONIC',quantiles:'NEAREST_RANK',comparison:'BASELINE_TENANT_VS_CANONICAL_NOT_NULL_WITH_IDENTICAL_SECURITY_READS',fingerprint:fingerprints[tenantIndex],checks:{exactJsonBytes:true,exactFingerprint:true,freshReadsPerCall:true,securityReadsPreserved:true},samples:[],blocks:[],pairs:[],connections:[{label:'functional',callerOwned:false,acquisitionMs:1}],summary:{}};
    function sample(arm,phase,sampleIndex,pairIndex=null,blockIndex=null){
      const startedMs=m.samples.length*50,durationMs=arm==='A'?30:20;
      m.samples.push({arm,phase,sampleIndex,pairIndex,blockIndex,startedMs,durationMs,status:'PASS',fingerprint:m.fingerprint,queryCounts:{base:1,security:24},driverObservedWorkMs:6.25,
        queries:hashes(arm).map((hash,index)=>({hash,kind:index?'security':'base',startedMs:startedMs+index*.25,durationMs:.25,status:'PASS'}))});
    }
    for(const arm of ['A','B'])for(const phase of ['equivalence','validation'])for(let i=0;i<2;i++)sample(arm,phase,i);
    for(let pairIndex=0;pairIndex<6;pairIndex++){
      const order=pairIndex%2?['B','A']:['A','B'];
      for(const arm of order){const blockIndex=m.blocks.length,ms=arm==='A'?30:20;
        for(const [phase,n]of [['warmup',10],['measured',100]])for(let i=0;i<n;i++)sample(arm,phase,i,pairIndex,blockIndex);
        m.blocks.push({blockIndex,pairIndex,arm,status:'PASS',controlBudgetMs:300000,controlElapsedMs:110*ms,count:100,warmups:10,p50Ms:ms,p95Ms:ms,maximumMs:ms});
        m.connections.push({label:'block-'+blockIndex,callerOwned:false,acquisitionMs:1});
      }
      m.pairs.push({pairIndex,order,bMinusA:{p50Ms:-10,p95Ms:-10,maximumMs:-10}});
    }
    for(const arm of ['A','B']){const ms=arm==='A'?30:20;m.summary[arm]={count:600,p50Ms:ms,p95Ms:ms,maximumMs:ms};}
    return m;
  });
  return {report:{stages:[{revision:'043',result:{metadata:{status:'PASS',mode:'measure',populations}}}]},proof};
}
test('tenant M validates complete populations and refuses lost security reads, SQL substitution and tenant mixing',()=>{
  const fixture=metadataFixture(),valid=analysis.inspectTenantMetadata(fixture.report,fixture.proof);
  assert.equal(valid.validation.status,'VALID');assert.equal(valid.result.samples.filter(x=>x.phase==='measured').length,2400);
  assert.deepEqual(valid.result.revisions.map(x=>x.tenantIndex),[0,1]);
  for(const mutate of [p=>p.populations.pop(),p=>p.populations[1].tenantIndex=0,p=>p.populations[0].samples[8].queries.pop(),p=>p.populations[0].samples[8].queries[2].hash='d'.repeat(64),p=>p.populations[0].samples[8].fingerprint='c'.repeat(64)]){
    const bad=structuredClone(fixture.report);mutate(bad.stages[0].result.metadata);
    assert.notEqual(analysis.inspectTenantMetadata(bad,fixture.proof).validation.status,'VALID');
  }
});
test('tenant readiness requires restored drift coverage and both real snapshots after the restricted function',()=>{
  const equal={equal:true,sha256:'f'.repeat(64),bytes:100};
  const cases=['not-null-canonical','not-null-quoted','not-null-no-inherit','not-null-not-valid','not-null-partition','not-null-inherited','conventional-constraints','public-table-acl','public-column-acl','runtime-role','table-owner','rls-disabled','rls-not-forced','policy-change','metadata-executor-role'];
  const unsupported=new Set(['not-null-quoted','not-null-no-inherit','not-null-not-valid','not-null-inherited']);
  const proof={status:'PASS',tenants:[0,1].map(tenantIndex=>({tenantIndex,baseline:equal,finalBaseline:equal,
    sqlHashes:{A:['a'.repeat(64),...Array(24).fill('c'.repeat(64))],B:['b'.repeat(64),...Array(24).fill('c'.repeat(64))]},
    transactional:cases.map(name=>({case:name,status:'PASS',restored:true,...(unsupported.has(name)?{schemaRefusal:'UNSUPPORTED_NOT_NULL_CONSTRAINT',guard:'UNSUPPORTED_NOT_NULL_CONSTRAINT'}:{schema:equal,guard:'F4_METADATA_DRIFT'})})),
    postFunctionProofs:['A','B'].map(arm=>({arm,tenantIndex,mutationAfterFunction:true,snapshotCount:2,functionalCallbackExecuted:false,rejected:'TENANT_SCHEMA_FINGERPRINT_MISMATCH',restored:true})),
    plans:['A','B'].map(arm=>({arm,sqlSha256:(arm==='A'?'a':'b').repeat(64),plan:[{'Execution Time':1,'Planning Time':1}]}))
  }))};
  assert.equal(analysis.inspectTenantReadiness(proof).validation.status,'VALID');
  for(const mutate of [p=>p.tenants[0].transactional.pop(),p=>p.tenants[1].postFunctionProofs[0].snapshotCount=1,p=>p.tenants[0].postFunctionProofs[1].functionalCallbackExecuted=true,p=>p.tenants[1].postFunctionProofs[0].restored=false,p=>p.tenants[0].sqlHashes.B[1]='d'.repeat(64)]){
    const bad=structuredClone(proof);mutate(bad);assert.notEqual(analysis.inspectTenantReadiness(bad).validation.status,'VALID');
  }
});

test('offline readiness validation rejects missing or failed observed attempts and suppressed observer failures',()=>{
 const value={schemaVersion:1,observerErrors:[],attempts:Array.from({length:17},(_,index)=>({index,resolved:true,status:index<=6||index===8?200:index===7||index===9?400:index<14?403:401,ms:1})),drains:Array.from({length:9},(_,index)=>({index,resolved:true,limitMs:30000,ms:1}))};
 assert.equal(typeof analysis.inspectHttpObservation,'function');assert.equal(analysis.inspectHttpObservation(value).issues.length,0);
 for(const mutate of [x=>x.attempts.pop(),x=>x.attempts[5].status=503,x=>x.drains[0].resolved=false,x=>x.observerErrors.push({code:'OBSERVED_ERROR'})]){const bad=structuredClone(value);mutate(bad);assert(analysis.inspectHttpObservation(bad).issues.length>0);}
});
