'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const { evaluateAdmissionSlo } = require('./slo');
const policy = require('./policy.json');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const finite = n => Number.isFinite(n) && n >= 0;
function requireEvidence(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { gateCode: code });
}
function approvedSlo(slo) {
  return slo && Object.entries(policy.slo).every(([key, value]) => slo[key] === value);
}
function validHost(host) {
  const b = host?.background;
  return host?.controlledChecksPass === true && host.preflightPass === true
    && host.backgroundContainersQuiet === true && equal(host.samplingErrors, [])
    && finite(host.freeMemoryMinGiB) && host.freeMemoryMinGiB >= policy.host.freeMemoryMinimumGiB
    && b?.status === 'COMPLETE' && b.cpuCounterVersion === policy.host.counterVersion
    && Number.isInteger(b.samples) && b.samples >= 2
    && finite(b.meanCpuPercent) && b.meanCpuPercent <= policy.host.backgroundCpuMeanMaximum
    && finite(b.maxCpuPercent) && b.maxCpuPercent <= policy.host.backgroundCpuSampleMaximum
    && finite(b.maxIntervalMs) && b.maxIntervalMs > 0 && b.maxIntervalMs <= policy.host.sampleIntervalMaximumMs;
}

// Recompute from measured waits, never from stored PASS flags or rounded quantiles.
function evaluateComparison(report) {
  requireEvidence(report?.status === 'COMPLETE', 'INCOMPLETE_REPORT');
  requireEvidence(equal(report.policies, [policy.pool]), 'POLICY_DRIFT');
  requireEvidence(equal(report.checks, policy.checks), 'AUTHORITY_CHECKS_MISSING');
  requireEvidence(Array.isArray(report.runs) && report.runs.length === 12, 'INCOMPLETE_BURSTS');
  requireEvidence(equal(report.runs.map(r => r.variant), policy.order), 'ORDER_DRIFT');
  requireEvidence(new Set(report.runs.map(r => r.report)).size === 12, 'DUPLICATE_BURST');
  requireEvidence(equal(report.sloResults?.map(r => r.variant), ['before', 'after'])
    && report.sloResults.every(r => approvedSlo(r.approvedCriteria)), 'SLO_DRIFT');
  for (const [i, r] of report.runs.entries()) {
    requireEvidence(r.index === i + 1 && /^[a-z0-9-]+$/.test(r.report), 'INVALID_BURST');
    requireEvidence(r.successes === 6 && r.errors === 0 && r.requests?.length === 6
      && r.requests.every(x => x.status === 200), 'HTTP_FAILURE_OR_MISSING_REQUEST');
    requireEvidence(r.admissionSlo?.dataComplete === true && r.admissionSlo.waits?.length === 18
      && r.admissionSlo.waits.every(finite), 'INCOMPLETE_ADMISSIONS');
    requireEvidence(equal(r.admissionSlo.failures, []) && r.admissionErrors === 0, 'ADMISSION_FAILURE');
    requireEvidence(r.afterResponseQueries === 0 && equal(r.protocolCalls, [198]) && equal(r.auditAppends, [10]), 'AUTHORITY_OR_AUDIT_DRIFT');
    requireEvidence(validHost(r.host), 'INVALID_ENVIRONMENT');
  }
  const variants = ['before', 'after'].map(variant => ({ variant,
    ...evaluateAdmissionSlo(report.runs.filter(r => r.variant === variant), policy.slo, policy.pool.acquireTimeoutMs) }));
  return { policy: policy.id, verdict: variants.every(r => r.verdict === 'PASS') ? 'PASS' : 'FAIL', variants };
}

function confined(file) {
  const resolved = fs.realpathSync(file);
  const relative = path.relative(root, resolved);
  requireEvidence(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'SOURCE_OUTSIDE_WORKSPACE');
  return resolved;
}

// The comparison is an index into the raw evidence. Check hashes and reconcile
// requests/admissions and critical invariants, so omission cannot turn into PASS.
function verifySources(report) {
  requireEvidence(Array.isArray(report.sources) && report.sources.length > 0, 'MISSING_SOURCES');
  const sources = new Map();
  for (const source of report.sources) {
    requireEvidence(typeof source.path === 'string' && /^context\/reviews\/[a-zA-Z0-9_./-]+\.json$/.test(source.path)
      && !source.path.split('/').includes('..') && !sources.has(source.path), 'INVALID_SOURCE_PATH');
    const bytes = fs.readFileSync(confined(path.join(root, source.path)));
    requireEvidence(hash(bytes) === source.sha256, 'SOURCE_HASH_MISMATCH');
    sources.set(source.path, json(bytes));
  }
  function get(file) { requireEvidence(sources.has(file), 'MISSING_SOURCE'); return sources.get(file); }
  const pins = {};
  for (const [variant, field] of [['before', 'hashes'], ['after', 'sourceHashes']]) {
    const candidates = [...sources.values()].filter(value => policy.variantPaths.every(p => /^[a-f0-9]{64}$/.test(value[field]?.[p])));
    requireEvidence(candidates.length === 1, 'VARIANT_MANIFEST_MISSING_OR_AMBIGUOUS');
    pins[variant] = candidates[0][field];
  }
  const controls = [...sources.keys()].filter(p => p.endsWith('/host-control.json'));
  requireEvidence(controls.length === 1, 'MISSING_HOST_CONTROL');
  const folder = path.posix.dirname(controls[0]);
  const control = get(controls[0]), protocol = get(`${folder}/protocol.json`), background = get(`${folder}/background.json`);
  requireEvidence(control.status === 'COMPLETE' && equal(control.cleanupErrors, [])
    && control.containers?.length > 0 && control.containers.every(c => c.pausedByThisRun && c.resumed), 'HOST_NOT_RESTORED');
  requireEvidence(equal(control.initial, control.final) && equal(control.order, policy.order), 'HOST_OR_ORDER_DRIFT');
  requireEvidence(approvedSlo(control.slo) && approvedSlo(protocol.admissionSlo)
    && equal(control.slo, protocol.admissionSlo), 'SLO_DRIFT');
  requireEvidence(equal(protocol.pairs.flat().map(v => v === 'A' ? 'before' : v === 'B' ? 'after' : null), policy.order), 'ORDER_DRIFT');
  requireEvidence(control.runs?.length === 12 && report.runs?.length === 12, 'INCOMPLETE_BURSTS');
  const queryCount = (row, pattern) => Object.entries(row.metrics.queries).filter(([key]) => pattern.test(key)).reduce((n, [, q]) => n + q.calls, 0);
  for (const [i, r] of report.runs.entries()) {
    const entry = control.runs[i];
    requireEvidence(entry.report === r.report && entry.variant === r.variant && entry.status === 'COMPLETE'
      && entry.exitCode === 0 && equal(entry.config, control.initial), 'RUN_CONTROL_DRIFT');
    const dir = `context/reviews/${r.report}`;
    const raw = get(`${dir}/results.json`), summary = get(`${dir}/summary.json`), host = get(`${dir}/host-variant.json`);
    requireEvidence(raw.status === 'COMPLETE' && raw.mode === 'capacity' && !raw.cleanupError
      && equal(raw.checks, policy.checks) && equal(raw.instrumentation.policies, [policy.pool]), 'RAW_CHECKS_OR_POLICY_DRIFT');
    requireEvidence(raw.scenarios?.length === 1, 'INCOMPLETE_SCENARIO');
    const s = raw.scenarios[0];
    requireEvidence(s.name === 'dashboard-c6' && s.samples === 6 && s.concurrency === 6 && s.tenants === 1
      && s.warmup?.status === 200 && s.results?.length === 6 && s.successes === 6 && s.errors === 0, 'RAW_WORKLOAD_FAILURE');
    const waits = s.results.flatMap(row => row.metrics.admissions.map(a => a.ms));
    requireEvidence(equal(waits, r.admissionSlo.waits), 'ADMISSIONS_MISMATCH');
    requireEvidence(equal(s.results.map(row => ({ status: row.status, code: row.code ?? null, ms: row.ms,
      queries: row.metrics.queryCount, tx: row.metrics.authorityTransactions })), r.requests), 'REQUESTS_MISMATCH');
    for (const row of s.results) {
      requireEvidence(row.status === 200 && row.total === 1000 && row.metrics.admissions.length === 3
        && row.metrics.admissions.every(a => finite(a.ms) && !a.error)
        && equal(row.metrics.sqlErrors, []) && equal(row.metrics.failures, []), 'RAW_REQUEST_FAILURE');
      requireEvidence(queryCount(row, /authority\/authority-protocol$/) === 198
        && queryCount(row, /\/audit-prepare$/) === 10 && queryCount(row, /\/audit-append$/) === 10
        && Object.values(row.metrics.afterResponseQueries || {}).every(q => q.calls === 0), 'RAW_AUTHORITY_OR_AUDIT_DRIFT');
    }
    requireEvidence(summary.scenarios[0].afterResponseQueryCompletions === 0, 'AFTER_RESPONSE_QUERIES');
    requireEvidence(host.variant === r.variant && host.completeVariant && host.instrumentationObserved
      && host.loaded?.length === 3 && equal(host.loaded, r.loadedSources), 'SOURCE_VARIANT_DRIFT');
    requireEvidence(equal(host.loaded.map(s => s.path).sort(), [...policy.variantPaths].sort())
      && host.loaded.every(s => s.sha256 === pins[r.variant]?.[s.path]), 'SOURCE_VARIANT_DRIFT');
    const idle = [...sources.keys()].filter(p => p.startsWith(`${dir}/idle-`)).sort();
    requireEvidence(idle.length > 0, 'PREFLIGHT_MISSING');
    const preflight = get(idle.at(-1));
    requireEvidence(preflight.pass === true && preflight.samples?.length === 3
      && preflight.samples.every(s => finite(s.cpuPercent) && s.cpuPercent <= 25
        && finite(s.freeBytes) && s.freeBytes >= 4 * 1024 ** 3), 'PREFLIGHT_MISSING');
    const start = host.phases.find(p => p.phase === 'dashboard-c6')?.at;
    const end = host.phases.find(p => p.phase === 'dashboard-c6-drain')?.at;
    requireEvidence(finite(start) && finite(end) && end > start, 'INVALID_PHASE');
    const samples = background.samples.filter(x => Date.parse(x.startedAt) <= end && Date.parse(x.finishedAt) >= start);
    requireEvidence(background.status === 'COMPLETE' && background.cpuCounterVersion === policy.host.counterVersion
      && samples.length >= 2 && samples.every(x => finite(x.cpuPercent) && x.cpuPercent <= 10
        && finite(x.intervalMs) && x.intervalMs > 0 && x.intervalMs <= 5000 && x.observedProcesses > 0)
      && samples.reduce((n, x) => n + x.cpuPercent * x.intervalMs, 0) / samples.reduce((n, x) => n + x.intervalMs, 0) <= 5,
    'INVALID_ENVIRONMENT');
    const nodeSamples = host.samples.filter(x => x.phase === 'dashboard-c6');
    requireEvidence(equal(host.samplingErrors, []) && nodeSamples.length >= 2
      && nodeSamples.every(x => finite(x.freeBytes) && x.freeBytes >= 4 * 1024 ** 3), 'INVALID_ENVIRONMENT');
  }
}

function gateFile(file) {
  try {
    const bytes = fs.readFileSync(confined(path.resolve(file)));
    const report = json(bytes);
    verifySources(report);
    return { ...evaluateComparison(report), comparisonSha256: hash(bytes), policySha256: hash(fs.readFileSync(path.join(__dirname, 'policy.json'))) };
  } catch (error) {
    return { policy: policy.id, verdict: 'FAIL', reason: error.gateCode || 'INVALID_OR_MISSING_EVIDENCE' };
  }
}

if (require.main === module) {
  const result = process.argv.length === 3 ? gateFile(process.argv[2]) : { policy: policy.id, verdict: 'FAIL', reason: 'USAGE_COMPARISON_JSON_REQUIRED' };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}
module.exports = { evaluateComparison, gateFile };
