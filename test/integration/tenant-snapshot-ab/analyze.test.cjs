'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stats, union, effects, requestCost, httpPopulation, checkpointCounts, matchScenarioPairs, validationStatus, expectedInterruptedWarmup } = require('./analyze.cjs');

test('nearest-rank quantiles preserve all finite values and report missing observations', () => {
  const value = stats([8, 1, 4, 2, null, undefined, NaN]);
  assert.deepEqual(value, { n: 4, missing: 3, minimum: 1, p50: 2, p95: 8, maximum: 8, mean: 3.75 });
  assert.equal(stats(Array.from({length:100}, (_, index) => index + 1)).p95, 95);
  assert.deepEqual(stats([]), { n: 0, missing: 0, minimum: null, p50: null, p95: null, maximum: null, mean: null });
});
test('interval union removes nested and partial overlaps and refuses malformed intervals', () => {
  assert.equal(union([[5,15],[0,10],[18,22],[6,7],[15,15]]), 19);
  assert.equal(union([]), 0);
  assert.equal(union([[2,1]]), null);
  assert.equal(union([[NaN,1]]), null);
});
test('paired effects use B minus A and A as the percentage denominator', () => {
  const actual = effects({p50:100,p95:200,maximum:250,mean:0}, {p50:80,p95:220,maximum:250,mean:10});
  assert.equal(actual.bMinusAMs.p50, -20);
  assert(Math.abs(actual.bRelativeChangePercent.p50 + 20) < 1e-10);
  assert.equal(actual.bMinusAMs.p95, 20);
  assert(Math.abs(actual.bRelativeChangePercent.p95 - 10) < 1e-10);
  assert.equal(actual.bRelativeChangePercent.maximum, 0);
  assert.equal(actual.bRelativeChangePercent.mean, null);
});
function attempt() {
  return { scenario:'report-c1',attempt:0,tenant:0,status:200,ms:20,code:null,responseDigest:'a'.repeat(64),functionalPass:true,normalizedResponsePass:true,instrumentationPass:true,
    metrics:{start:100,responseAt:120,queryCount:3,pendingQueries:0,transactionCount:1,sqlErrors:[],failures:[],
      queryEvents:[{startMs:0,endMs:10,category:'metadata',role:'central',hash:'b'.repeat(64),afterResponse:false},
        {startMs:5,endMs:15,category:'metadata',role:'tenant',hash:'c'.repeat(64),afterResponse:false},
        {startMs:18,endMs:22,category:'authority-lock',role:'authority',hash:'d'.repeat(64),afterResponse:true}],
      spans:[{name:'assertCentralSchema',startMs:0,endMs:12},{name:'observeTenantRuntimeMetadata',startMs:5,endMs:15}],
      checkouts:[{role:'tenant',waitMs:1,holdMs:15,max:4}],admissions:[{ms:3,before:{active:0,queued:0},after:{active:1,queued:0}}],
      lockEvents:[{startMs:19,endMs:22}]}};
}
test('request fractions use interval unions and separate work before and after the response', () => {
  const row = requestCost(attempt(), 0);
  assert.equal(row.completeMetrics, true);
  assert.equal(row.queryObservedWorkMs, 24);
  assert.equal(row.queryUnionMs, 19);
  assert.equal(row.metadataUnionMs, 15);
  assert.equal(row.centralMetadataMs, 10);
  assert.equal(row.tenantMetadataMs, 10);
  assert.equal(row.metadataUnionToHttpRatio, .75);
  assert.equal(row.queryBeforeResponseMs, 17);
  assert.equal(row.queryAfterResponseUnionMs, 2);
  assert.equal(row.queryCompletedAfterResponse, 1);
  assert.equal(row.authorityLockAcquisitionObservedMs, 4);
  assert.equal(row.authorityLockHeldUnionMs, 3);
  assert.equal(row.managerAcquireSumMs, 3);
  assert.equal(row.checkoutHoldSumMs, 15);
});
test('failed and incomplete attempts remain in the population and are not successful latencies', () => {
  const good = requestCost(attempt(), 0), raw = attempt();
  raw.status = 503; raw.ms = 25; raw.functionalPass = false; delete raw.metrics;
  const failed = requestCost(raw, 0), result = httpPopulation([good,failed]);
  assert.equal(result.n, 2); assert.equal(result.successes, 1); assert.equal(result.errors, 1);
  assert.equal(result.http503, 1); assert.equal(result.incompleteMetrics, 1);
  assert.equal(result.successLatencyMs.n, 1); assert.equal(result.allAttemptLatencyMs.n, 2);
  assert.equal(result.perRequest.queryUnionMs.missing, 1);
});
test('A/B query and checkpoint count invariance refuses any removed or extra security read', () => {
  for (const [scenario, values] of [
    ['report-c4', {queryCount:1195,transactionCount:52,centralBaseQueryCount:25,authoritySecurityQueryCount:50,centralCheckpointCount:25,tenantMetadataCheckpointCount:3,tenantBaseQueryCount:6}],
    ['dashboard-c4-two-tenants', {queryCount:2841,transactionCount:113,centralBaseQueryCount:53,authoritySecurityQueryCount:106,centralCheckpointCount:53,tenantMetadataCheckpointCount:9,tenantBaseQueryCount:18}]
  ]) for (const arm of ['A','B']) {
    const row = {scenario,arm,completeMetrics:true,...values};
    assert.equal(checkpointCounts(row).valid, true);
    for (const field of Object.keys(values)) for (const difference of [-1,1]) assert.equal(checkpointCounts({...row,[field]:row[field]+difference}).valid, false);
    assert.equal(checkpointCounts({...row,completeMetrics:false}).valid, false);
  }
});
function pairedRows(attempts=8) {
  return Array.from({length:4},(_,pair)=>['A','B'].flatMap(arm=>Array.from({length:attempts},(_,attempt)=>({pair,arm,attempt,
    status:200,functionalPass:true,normalizedResponsePass:true,completeMetrics:true,checkpointCountsPass:true,ms:arm==='A'?100:80})))).flat();
}
test('an interrupted A scenario leaves three matched pairs and eight explicitly unpaired B observations', () => {
  const rows=pairedRows().filter(row=>!(row.pair===2&&row.arm==='A'));
  for(const row of rows)if(row.pair===2)row.ms=10000;
  const result=matchScenarioPairs(rows,{attempts:8});
  assert.equal(rows.length,56);assert.equal(result.matched.length,48);assert.equal(result.unpaired.length,8);
  assert.equal(result.pairs.filter(pair=>pair.complete).length,3);
  assert.equal(result.pairs[2].missingA,8);assert.equal(result.pairs[2].recordedB,8);
  assert(result.unpaired.every(row=>row.arm==='B'&&row.pair===2));
  const a=stats(result.matched.filter(row=>row.arm==='A').map(row=>row.ms)),b=stats(result.matched.filter(row=>row.arm==='B').map(row=>row.ms));
  assert.equal(effects(a,b).bMinusAMs.mean,-20);
  assert.equal(stats(rows.filter(row=>row.arm==='B').map(row=>row.ms)).mean,2560);
});
test('earlier complete scenarios retain four pairs even when a later scenario in the arm failed', () => {
  const result=matchScenarioPairs(pairedRows(4),{attempts:4});
  assert.equal(result.pairs.filter(pair=>pair.complete).length,4);
  assert.equal(result.matched.length,32);assert.equal(result.unpaired.length,0);
  const duplicate=pairedRows(4);duplicate[1].attempt=0;
  assert.equal(matchScenarioPairs(duplicate,{attempts:4}).pairs[0].complete,false);
});
test('known protocol failure can have sound recorded data but can never become VALID', () => {
  const failure={classification:'PROTOCOL',code:'HTTP_PROTOCOL_NOT_SATISFIED'};
  const complete=validationStatus([failure]);
  assert.equal(complete.status,'DATA_PASS_PROTOCOL_FAIL');assert.equal(complete.dataStatus,'DATA_PASS');assert.equal(complete.protocolStatus,'FAIL');
  const inconsistent=validationStatus([failure,{classification:'DATA_QUALITY',code:'CHILD_EVIDENCE_MISMATCH'}]);
  assert.equal(inconsistent.status,'INVALID_OR_INCOMPLETE');assert.equal(inconsistent.dataStatus,'DATA_INVALID_OR_INCOMPLETE');
  assert.equal(inconsistent.protocolStatus,'FAIL');assert.equal(inconsistent.protocolIssues.length,1);assert.equal(inconsistent.dataIssues.length,1);
});
test('pre-specified interruption sensitivity keeps pairs 0, 1 and 3 without discarding any raw observation', () => {
  const rows=pairedRows(4);for(const row of rows)if(row.pair===2&&row.arm==='B')row.ms=10000;
  const result=matchScenarioPairs(rows,{attempts:4},{interruptedPairs:[2]});
  assert.equal(rows.length,32);assert.equal(result.matched.length,32);assert.equal(result.uninterrupted.length,24);
  assert.equal(result.pairs[2].complete,true);assert.equal(result.pairs[2].continuity,'INTERRUPTED_BY_OPERATIONAL_GAP');
  assert.deepEqual([...new Set(result.uninterrupted.map(row=>row.pair))],[0,1,3]);
  assert.equal(stats(result.uninterrupted.filter(row=>row.arm==='B').map(row=>row.ms)).mean,80);
  const incomplete=matchScenarioPairs(rows.filter(row=>!(row.pair===3&&row.arm==='A')),{attempts:4},{interruptedPairs:[2]});
  assert.deepEqual([...new Set(incomplete.uninterrupted.map(row=>row.pair))],[0,1]);
});
test('the recorded warmup timeout is an operation failure, while both admissions succeeded', () => {
  const actual={status:503,code:'SERVICE_UNAVAILABLE',ms:20479.233600000007,
    metrics:{admissions:[{ms:0.460},{ms:0.558}],sqlErrors:[],failures:[{code:'LEASE_TIMEOUT'}]}};
  assert.equal(expectedInterruptedWarmup(actual),true);
  assert.equal(expectedInterruptedWarmup({...actual,status:200}),false);
  assert.equal(expectedInterruptedWarmup({...actual,code:'OTHER_FAILURE'}),false);
  assert.equal(expectedInterruptedWarmup({...actual,metrics:{...actual.metrics,failures:[]}}),false);
  assert.equal(expectedInterruptedWarmup({...actual,metrics:{...actual.metrics,failures:[{code:'OTHER_FAILURE'}]}}),false);
  assert.equal(expectedInterruptedWarmup({...actual,metrics:{admissions:[{error:'LEASE_TIMEOUT'}],failures:[]}}),false);
});
