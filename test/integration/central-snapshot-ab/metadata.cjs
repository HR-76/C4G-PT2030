'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');
const PAIRS = [['A','B'],['B','A'],['A','B'],['B','A'],['A','B'],['B','A']];
const REVISIONS = ['042_opportunity_eu_source_control_v2','043_opportunity_eu_writer_v2'];
const fail = code => Object.assign(Error(code), { code });
const safeCode = error => /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'AB_METADATA_FAILED';
const digest = text => createHash('sha256').update(text).digest('hex');
const loadCollectors = root => require(path.resolve(root, 'backend/src/security/centralSchemaManifest.js'));
function distribution(values) {
  const sorted = values.slice().sort((a,b) => a-b);
  if (!sorted.length || sorted.some(x => !Number.isFinite(x) || x < 0)) throw fail('AB_METADATA_POPULATION_INVALID');
  return { count: sorted.length, p50Ms: sorted[Math.ceil(sorted.length*.5)-1], p95Ms: sorted[Math.ceil(sorted.length*.95)-1], maximumMs: sorted.at(-1) };
}
async function runMetadataAB({ client, rootA, rootB, revision, mode = 'measure', onProgress = () => {}, load = loadCollectors } = {}) {
  if (!client || typeof client.connect !== 'function') throw fail('AB_METADATA_POOL_REQUIRED');
  if (!REVISIONS.includes(revision) || !['functional','measure'].includes(mode) || typeof onProgress !== 'function') throw fail('AB_METADATA_ARGUMENTS_INVALID');
  const collectors = { A: load(rootA), B: load(rootB) };
  const expected = collectors.A.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[revision];
  if (!expected || collectors.B.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[revision] !== expected) throw fail('AB_METADATA_CONTRACT_CHANGED');
  const epoch = performance.now();
  const report = { schemaVersion: 1, status: 'RUNNING', mode, revision, clock: 'MONOTONIC', quantiles: 'NEAREST_RANK',
    comparison: 'ORIGINAL_AGGREGATE_VS_OPTIMIZED_AGGREGATE_WITH_IDENTICAL_SECURITY_CHECKPOINTS',
    fingerprint: expected, checks: {}, samples: [], blocks: [], pairs: [], connections: [], summary: {},
    limits: ['Driver intervals include execution, transport and waits; they are not SQL CPU.', 'Functional/drift checks are outside the measured population.'] };
  async function connection(label, work) {
    const start = performance.now(), acquired = await client.connect();
    if (!acquired || typeof acquired.query !== 'function' || typeof acquired.release !== 'function') throw fail('AB_METADATA_CLIENT_INVALID');
    report.connections.push({ label, acquisitionMs: performance.now()-start, callerOwned: false });
    try { return await work(acquired); } finally { acquired.release(); }
  }
  async function observe(acquired, arm, phase, sampleIndex, pairIndex = null, blockIndex = null) {
    const started = performance.now(), queries = [];
    const sample = { arm, phase, pairIndex, blockIndex, sampleIndex, startedMs: started-epoch, status: 'RUNNING', queries, queryCounts: { base: 0, security: 0 } };
    report.samples.push(sample);
    const observed = { async query(...args) {
      const queryStart = performance.now(), kind = queries.length === 0 ? 'base' : 'security';
      const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (typeof text !== 'string') throw fail('AB_METADATA_QUERY_INVALID');
      const event = { kind, hash: digest(text), startedMs: queryStart-epoch, status: 'RUNNING' }; queries.push(event); sample.queryCounts[kind]++;
      try { const value = await acquired.query(...args); event.status = 'PASS'; return value; }
      catch (error) { event.status = 'FAIL'; event.code = safeCode(error); throw error; }
      finally { event.durationMs = performance.now()-queryStart; }
    } };
    try {
      let json, fingerprint;
      if (phase === 'equivalence') { const value = await collectors[arm].centralSchemaSnapshot(observed); json = JSON.stringify(value); fingerprint = collectors[arm].schemaFingerprint(value); }
      else fingerprint = await collectors[arm].assertCentralSchema(observed, revision);
      const securityCount = phase === 'equivalence' ? 7 : revision.startsWith('043_') ? 17 : 12;
      if (sample.queryCounts.base !== 1 || sample.queryCounts.security !== securityCount) throw fail('AB_METADATA_SECURITY_READ_COUNT_CHANGED');
      sample.fingerprint = fingerprint; sample.status = 'PASS';
      if (phase !== 'equivalence' && fingerprint !== expected) throw fail('AB_METADATA_FINGERPRINT_MISMATCH');
      return { sample, json, fingerprint };
    } catch (error) { sample.status = 'FAIL'; sample.code = safeCode(error); throw error; }
    finally { sample.durationMs = performance.now()-started; sample.driverObservedWorkMs = queries.reduce((n,q) => n+q.durationMs,0); }
  }
  try {
    await connection('functional', async acquired => {
      let canonical;
      for (const arm of ['A','B']) {
        for (let index = 0; index < 2; index++) {
          const value = await observe(acquired, arm, 'equivalence', index);
          if (canonical === undefined) canonical = value.json;
          if (value.json !== canonical) throw fail('AB_METADATA_JSON_MISMATCH');
          if (value.fingerprint !== expected) throw fail('AB_METADATA_FINGERPRINT_MISMATCH');
        }
        for (let index = 0; index < 2; index++) await observe(acquired, arm, 'validation', index);
      }
    });
    report.checks = { exactJsonBytes: true, exactFingerprint: true, freshReadsPerCall: true, securityReadsPreserved: true };
    await onProgress({ stage: 'functional-complete', revision, status: 'PASS' });
    if (mode === 'measure') for (let pairIndex = 0; pairIndex < PAIRS.length; pairIndex++) {
      for (const arm of PAIRS[pairIndex]) {
        const start = performance.now(), blockIndex = report.blocks.length, cpu = process.cpuUsage(), memory = process.memoryUsage();
        const block = { pairIndex, blockIndex, arm, status: 'RUNNING', controlBudgetMs: 300000 }; report.blocks.push(block);
        const checkBudget = () => { block.controlElapsedMs = performance.now()-start; if (block.controlElapsedMs > block.controlBudgetMs) throw fail('CONTROL_DEADLINE_EXCEEDED'); };
        await connection('block-'+blockIndex, async acquired => {
          for (const [phase,count] of [['warmup',10],['measured',100]]) for (let index=0;index<count;index++) {
            checkBudget(); await observe(acquired,arm,phase,index,pairIndex,blockIndex); checkBudget();
          }
        }); checkBudget();
        const population = report.samples.filter(s => s.blockIndex === blockIndex && s.phase === 'measured');
        Object.assign(block, distribution(population.map(s => s.durationMs)), { status: 'PASS', warmups: 10,
          processCpuMicroseconds: process.cpuUsage(cpu), memoryBefore: { rss: memory.rss, heapUsed: memory.heapUsed },
          memoryAfter: (() => { const m = process.memoryUsage(); return { rss: m.rss, heapUsed: m.heapUsed }; })() });
        await onProgress({ stage: 'block-complete', revision, pairIndex, blockIndex, arm, count: population.length });
      }
      const arms = Object.fromEntries(report.blocks.filter(b => b.pairIndex === pairIndex).map(b => [b.arm,b]));
      report.pairs.push({ pairIndex, order: PAIRS[pairIndex].slice(), bMinusA: { p50Ms: arms.B.p50Ms-arms.A.p50Ms,
        p95Ms: arms.B.p95Ms-arms.A.p95Ms, maximumMs: arms.B.maximumMs-arms.A.maximumMs } });
    }
    if (mode === 'measure') for (const arm of ['A','B']) {
      const samples = report.samples.filter(s => s.arm === arm && s.phase === 'measured');
      if (samples.length !== 600) throw fail('AB_METADATA_SAMPLE_COUNT_INVALID'); report.summary[arm] = distribution(samples.map(s => s.durationMs));
    }
    report.status = 'PASS'; return report;
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: safeCode(error) };
    for (const block of report.blocks) if (block.status === 'RUNNING') block.status = 'FAIL';
    error.metadataABReport = report; throw error;
  } finally { report.totalDurationMs = performance.now()-epoch; }
}
module.exports = { runMetadataAB, distribution };
