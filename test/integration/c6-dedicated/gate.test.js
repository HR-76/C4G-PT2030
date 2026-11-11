'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { evaluateComparison, gateFile } = require('./gate');
const root = path.resolve(__dirname, '../../..');
const validPath = path.join(root, 'context/reviews/c6-dedicated-slo-repeat/comparison.json');
const invalidPath = path.join(root, 'context/reviews/c6-dedicated-slo/comparison.json');
const fixture = () => JSON.parse(fs.readFileSync(validPath, 'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function rejects(edit, code) {
  const report = fixture(); edit(report);
  assert.throws(() => evaluateComparison(report), error => error.gateCode === code);
}
function modifiedFile(edit) {
  const report = fixture(); edit(report);
  const file = path.join(__dirname, `.gate-test-${process.pid}-${crypto.randomUUID()}.json`);
  try { fs.writeFileSync(file, JSON.stringify(report)); return gateFile(file); }
  finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
}

test('approved complete series passes with 108 measured admissions per variant', () => {
  const result = evaluateComparison(fixture());
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.variants.map(r => r.admissions), [108, 108]);
});
test('recompute p95 and maximum: stored PASS and rounding cannot hide a regression', () => {
  for (const [value, fill] of [[3000.001, true], [4000.001, false]]) {
    const report = fixture();
    for (const r of report.runs) r.admissionSlo.waits.fill(1000);
    if (fill) report.runs[0].admissionSlo.waits.fill(value);
    else report.runs[0].admissionSlo.waits[0] = value;
    assert.equal(evaluateComparison(report).verdict, 'FAIL');
  }
});
test('cannot relax SLO, pool policy or remove authority checks', () => {
  rejects(r => { r.sloResults[0].approvedCriteria.httpFailuresMaximum = 1; }, 'SLO_DRIFT');
  rejects(r => { r.sloResults[0].variant = 'after'; }, 'SLO_DRIFT');
  rejects(r => { r.policies[0].acquireTimeoutMs = 6000; }, 'POLICY_DRIFT');
  rejects(r => { r.policies[0].globalLimit++; }, 'POLICY_DRIFT');
  rejects(r => { r.checks.pop(); }, 'AUTHORITY_CHECKS_MISSING');
});
test('incomplete, duplicated and out-of-order bursts cannot pass', () => {
  rejects(r => { r.runs.pop(); }, 'INCOMPLETE_BURSTS');
  rejects(r => { r.runs[0].variant = 'after'; }, 'ORDER_DRIFT');
  rejects(r => { r.runs[0].report = r.runs[1].report; }, 'DUPLICATE_BURST');
  rejects(r => { r.runs[0].requests.pop(); }, 'HTTP_FAILURE_OR_MISSING_REQUEST');
  rejects(r => { r.runs[0].admissionSlo.waits.pop(); }, 'INCOMPLETE_ADMISSIONS');
  rejects(r => { r.runs[0].admissionSlo.waits[0] = null; }, 'INCOMPLETE_ADMISSIONS');
});
test('errors or loss of authority/audit invariants cannot be compensated by timings', () => {
  rejects(r => { r.runs[0].requests[0].status = 503; }, 'HTTP_FAILURE_OR_MISSING_REQUEST');
  rejects(r => { r.runs[0].errors = -1; }, 'HTTP_FAILURE_OR_MISSING_REQUEST');
  rejects(r => { r.runs[0].admissionSlo.failures.push({ code: 'POOL_EXHAUSTED' }); }, 'ADMISSION_FAILURE');
  rejects(r => { r.runs[0].afterResponseQueries = 1; }, 'AUTHORITY_OR_AUDIT_DRIFT');
  rejects(r => { r.runs[0].protocolCalls = [197]; }, 'AUTHORITY_OR_AUDIT_DRIFT');
  rejects(r => { r.runs[0].auditAppends = [9]; }, 'AUTHORITY_OR_AUDIT_DRIFT');
});
test('environment must pass observed thresholds even if the summary claims PASS', () => {
  for (const mutate of [
    h => { h.background.cpuCounterVersion = 'unversioned-v1-with-truncation'; },
    h => { h.background.meanCpuPercent = 5.001; },
    h => { h.background.maxCpuPercent = 10.001; },
    h => { h.background.maxIntervalMs = 5001; },
    h => { h.background.samples = 0; },
    h => { h.background.meanCpuPercent = null; },
    h => { h.freeMemoryMinGiB = 3.999; },
    h => { h.preflightPass = false; },
    h => { h.samplingErrors.push('FAILED'); }
  ]) rejects(r => mutate(r.runs[0].host), 'INVALID_ENVIRONMENT');
});
test('raw evidence is mandatory, hash-checked and confined to the workspace', () => {
  assert.equal(modifiedFile(r => { r.sources = []; }).reason, 'MISSING_SOURCES');
  assert.equal(modifiedFile(r => { r.sources[0].sha256 = '0'.repeat(64); }).reason, 'SOURCE_HASH_MISMATCH');
  assert.equal(modifiedFile(r => { r.sources.push(r.sources[0]); }).reason, 'INVALID_SOURCE_PATH');
  assert.equal(modifiedFile(r => { r.sources[0].path = 'context/reviews/../../outside.json'; }).reason, 'INVALID_SOURCE_PATH');
  assert.equal(modifiedFile(r => { r.sources = r.sources.filter(s => !s.path.endsWith('/background.json')); }).reason, 'MISSING_SOURCE');
  assert.equal(modifiedFile(r => { r.sources = r.sources.filter(s => !s.path.endsWith('/baseline.json')); }).reason, 'VARIANT_MANIFEST_MISSING_OR_AMBIGUOUS');
  assert.equal(modifiedFile(r => { r.sources = r.sources.filter(s => !s.path.endsWith('/verification.json')); }).reason, 'VARIANT_MANIFEST_MISSING_OR_AMBIGUOUS');
  assert.equal(modifiedFile(r => { r.runs[0].admissionSlo.waits[0] += 1; }).reason, 'ADMISSIONS_MISMATCH');
  assert.equal(modifiedFile(r => { r.runs[0].requests[0].ms += 1; }).reason, 'REQUESTS_MISMATCH');
});
test('CLI approves the valid series and rejects invalid or missing evidence without rewriting it', () => {
  for (const [file, exit] of [[validPath, 0], [invalidPath, 1]]) {
    const before = hash(file);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'gate.js'), file], { encoding: 'utf8' });
    assert.ifError(result.error); assert.equal(result.status, exit, result.stderr);
    assert.equal(JSON.parse(result.stdout).verdict, exit === 0 ? 'PASS' : 'FAIL');
    assert.equal(hash(file), before);
  }
  const result = spawnSync(process.execPath, [path.join(__dirname, 'gate.js')], { encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 1);
  assert.equal(gateFile(path.join(__dirname, 'missing.json')).verdict, 'FAIL');
});
