'use strict';
// Offline derivation only. Never starts a server, accesses SQL or edits evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const sources = new Map();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  sources.set(relative, sha(bytes));
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
const round = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
const sum = xs => xs.reduce((n, x) => n + x, 0);
const mean = xs => xs.length ? sum(xs) / xs.length : NaN;
const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const correlation = (xs, ys) => {
  const a = mean(xs), b = mean(ys);
  return round(sum(xs.map((x, i) => (x - a) * (ys[i] - b))) / Math.sqrt(sum(xs.map(x => (x - a) ** 2)) * sum(ys.map(y => (y - b) ** 2))));
};
const query = (r, re, field = 'ms') => sum(Object.entries(r.metrics.queries).filter(([k]) => re.test(k)).map(([, v]) => v[field]));
const rows = [];
for (const [series, folder] of [['previous', 'c6-dedicated-slo-repeat'], ['latest', 'c6-regression-20261027-01']]) {
  const base = `context/reviews/${folder}`;
  const comparison = read(`${base}/comparison.json`);
  for (const s of comparison.sources) {
    const bytes = fs.readFileSync(path.join(root, s.path));
    assert.equal(sha(bytes), s.sha256, `Evidence drift: ${s.path}`);
    sources.set(s.path, s.sha256);
  }
  assert.equal(comparison.runs.length, 12);
  const background = read(`${base}/background.json`);
  assert.equal(background.cpuCounterVersion, 'fractional-double-v2');
  for (const run of comparison.runs) {
    const raw = read(`context/reviews/${run.report}/results.json`);
    const host = read(`context/reviews/${run.report}/host-variant.json`);
    const summary = read(`context/reviews/${run.report}/summary.json`);
    const scenario = raw.scenarios[0], requests = scenario.results;
    assert.equal(requests.length, 6); assert.equal(scenario.successes, 6); assert.equal(scenario.errors, 0);
    assert.equal(scenario.warmup.status, 200);
    const admissions = requests.flatMap(r => r.metrics.admissions.map((a, ordinal) => ({ ...a, ordinal, requestId: r.metrics.id })));
    assert.equal(admissions.length, 18);
    assert(requests.every(r => r.metrics.queryCount === (run.variant === 'before' ? 2619 : 2421)));
    assert(requests.every(r => query(r, /authority\/authority-protocol$/, 'calls') === 198));
    assert(requests.every(r => query(r, /\/audit-prepare$/, 'calls') === 10 && query(r, /\/audit-append$/, 'calls') === 10));
    assert(requests.every(r => r.metrics.sqlErrors.length === 0 && r.metrics.failures.length === 0));
    const worst = admissions.reduce((a, b) => a.ms > b.ms ? a : b);
    const checkouts = requests.flatMap(r => r.metrics.checkouts);
    const tenant = checkouts.filter(c => c.role?.startsWith('tenant'));
    const authority = checkouts.filter(c => c.role === 'authority');
    const initiallyAdmitted = requests.filter(r => r.metrics.admissions[0].before.active < 5);
    assert.equal(initiallyAdmitted.length, 5);
    // Only the first checkout of directly admitted requests is used here.
    // Queued checkouts can be attributed to the dispatcher ALS context.
    const firstHoldMin = Math.min(...initiallyAdmitted.map(r => r.metrics.checkouts.find(c => c.role?.startsWith('tenant')).holdMs));
    const frames = raw.instrumentation.samples.filter(f => f.phase === 'dashboard-c6');
    const node = host.samples.filter(s => s.phase === 'dashboard-c6');
    const start = host.phases.find(p => p.phase === 'dashboard-c6').at;
    const end = host.phases.find(p => p.phase === 'dashboard-c6-drain').at;
    const bg = background.samples.filter(s => Date.parse(s.startedAt) <= end && Date.parse(s.finishedAt) >= start);
    const overlap = s => Math.max(0, Math.min(end, Date.parse(s.finishedAt)) - Math.max(start, Date.parse(s.startedAt)));
    const nodeWindow = sum(node.map(s => s.intervalMs));
    const nodeCpuMs = sum(node.map(s => s.nodeCpuOneCorePercent * s.intervalMs / 100));
    const queryCount = sum(requests.map(r => r.metrics.queryCount));
    const sessionObservations = frames.flatMap(f => f.sessions).filter(s => s.state !== 'idle');
    const classCounts = {};
    for (const s of sessionObservations) {
      const key = `${s.role.startsWith('tenant') ? 'tenant' : s.role}/${s.state}/${s.waitType || 'none'}/${s.wait || 'none'}`;
      classCounts[key] = (classCounts[key] || 0) + 1;
    }
    rows.push({ series, run: run.index, variant: run.variant, report: run.report,
      httpP95Ms: scenario.p95Ms, warmupMs: scenario.warmup.ms,
      warmupQueryCount: scenario.warmup.metrics.queryCount,
      warmupAdmissionMaxMs: Math.max(...scenario.warmup.metrics.admissions.map(a => a.ms)),
      warmupActiveBefore: scenario.warmup.metrics.admissions.map(a => a.before.active),
      admissionMaxMs: worst.ms, admissionMaxOrdinal: worst.ordinal, activeBeforeWorst: worst.before.active,
      laterAdmissionMaxMs: Math.max(...admissions.filter(a => a.ordinal > 0).map(a => a.ms)),
      admissionsOver4000: admissions.filter(a => a.ms > 4000).length,
      maxActive: Math.max(...frames.flatMap(f => f.managers.map(m => m.active))),
      maxQueued: Math.max(...frames.flatMap(f => f.managers.map(m => m.queued))),
      tenantCheckoutMaxMs: Math.max(...tenant.map(c => c.waitMs)),
      tenantPhysicalWaitingMax: Math.max(...tenant.map(c => c.waiting)),
      tenantHoldMedianMs: round(median(tenant.map(c => c.holdMs))),
      tenantHoldMeanMs: round(mean(tenant.map(c => c.holdMs))),
      initialHoldMinimumMs: firstHoldMin, initialHoldMinusAdmissionMaxMs: round(firstHoldMin - worst.ms),
      leaseRemainingMinMs: Math.min(...admissions.map(a => a.leaseRemainingMs)),
      leaseRemainingMaxMs: Math.max(...admissions.map(a => a.leaseRemainingMs)),
      authorityCheckoutMaxMs: Math.max(...authority.map(c => c.waitMs)),
      queryCount, distinctQueryHashes: new Set(requests.flatMap(r => Object.keys(r.metrics.queryHashes))).size,
      queryMsPerRequest: round(mean(requests.map(r => query(r, /./)))),
      metadataMsPerRequest: round(mean(requests.map(r => query(r, /\/metadata$/)))),
      authorityMetadataMsPerRequest: round(mean(requests.map(r => query(r, /^authority\/metadata$/)))),
      tenantMetadataMsPerRequest: round(mean(requests.map(r => query(r, /^tenant.*\/metadata$/)))),
      authorityLockMsPerRequest: round(mean(requests.map(r => query(r, /authority-lock$/)))),
      auditPrepareMsPerRequest: round(mean(requests.map(r => query(r, /audit-prepare$/)))),
      auditHeldMsPerRequest: round(mean(requests.map(r => r.metrics.locks['audit-held'].ms))),
      centralHeldMsPerRequest: round(mean(requests.map(r => r.metrics.locks['central-held'].ms))),
      schemaSpanMsPerRequest: round(mean(requests.map(r => r.metrics.spans.assertCentralSchema.ms))),
      admissionSpanMsPerRequest: round(mean(requests.map(r => r.metrics.spans.assertAuthorityAdmission.ms))),
      tenantMetadataSpanMsPerRequest: round(mean(requests.map(r => r.metrics.spans.observeTenantRuntimeMetadata.ms))),
      sqlSampleMeanMs: round(mean(frames.map(f => f.sampleMs))), sqlFrames: frames.length,
      centralBlockedFrames: summary.scenarios[0].centralBlockedFrames,
      auditBlockedFrames: summary.scenarios[0].auditBlockedFrames,
      nonIdleSessionObservations: sessionObservations.length, nonIdleClasses: classCounts,
      nodeCpuMsApprox: round(nodeCpuMs), nodeCpuMsPerQueryApprox: round(nodeCpuMs / queryCount),
      nodeSampleWindowMs: round(nodeWindow), phaseDurationMs: end - start,
      nodeCpuOneCorePercent: round(nodeCpuMs / nodeWindow * 100),
      eventLoopUtilization: round(sum(node.map(s => s.eventLoopUtilization * s.intervalMs)) / nodeWindow),
      eventLoopDelayMaxMs: round(Math.max(...node.map(s => s.eventLoopDelayMaxMs))),
      hostCpuPercent: round(sum(node.map(s => s.hostCpuPercent * s.intervalMs)) / nodeWindow),
      backgroundMeanPercent: round(sum(bg.map(s => s.cpuPercent * s.intervalMs)) / sum(bg.map(s => s.intervalMs))),
      backgroundMaxPercent: round(Math.max(...bg.map(s => s.cpuPercent))),
      backgroundOverlapMeanPercent: round(sum(bg.map(s => s.cpuPercent * overlap(s))) / sum(bg.map(overlap))),
      backgroundPeakFullyInsidePhase: bg.filter(s => s.cpuPercent === Math.max(...bg.map(x => x.cpuPercent)))
        .every(s => Date.parse(s.startedAt) >= start && Date.parse(s.finishedAt) <= end),
      trackedInitialProcesses: background.trackedInitialProcesses,
      observedInitialProcessesMinimum: Math.min(...bg.map(s => s.observedProcesses)),
      environmentValid: run.host.controlledChecksPass,
      freeMemoryMinGiB: run.host.freeMemoryMinGiB, afterResponseQueries: run.afterResponseQueries });
  }
}
const latest = rows.filter(r => r.series === 'latest');
const correlations = Object.fromEntries(['initialHoldMinimumMs', 'tenantHoldMedianMs', 'metadataMsPerRequest', 'authorityLockMsPerRequest', 'auditPrepareMsPerRequest',
  'nodeCpuMsPerQueryApprox', 'eventLoopUtilization', 'eventLoopDelayMaxMs', 'sqlSampleMeanMs', 'backgroundMeanPercent', 'backgroundMaxPercent', 'hostCpuPercent']
  .map(field => [field, correlation(latest.map(r => r.admissionMaxMs), latest.map(r => r[field]))]));
const medians = (name, subset) => ({ name, bursts: subset.length, ...Object.fromEntries(['httpP95Ms','admissionMaxMs','tenantHoldMedianMs','metadataMsPerRequest',
  'authorityLockMsPerRequest','auditPrepareMsPerRequest','auditHeldMsPerRequest','nodeCpuMsPerQueryApprox','eventLoopUtilization','sqlSampleMeanMs','backgroundMeanPercent']
  .map(field => [field, round(median(subset.map(r => r[field])))])) });
const groups = ['before','after'].flatMap(variant => [
  medians(`previous-${variant}`, rows.filter(r => r.series === 'previous' && r.variant === variant)),
  medians(`latest-over4s-${variant}`, latest.filter(r => r.variant === variant && r.admissionMaxMs > 4000)),
  medians(`latest-within4s-${variant}`, latest.filter(r => r.variant === variant && r.admissionMaxMs <= 4000))]);
const result = { at: new Date().toISOString(), scope: 'Offline evidence analysis; SLO and gate unchanged',
  validation: { series: 2, bursts: rows.length, requests: rows.length * 6, admissions: rows.length * 18,
    allSourceHashesMatch: true, countsAndAuthorityInvariant: true },
  rows, groups, descriptivePearsonLatest12: correlations,
  limits: ['Post-hoc grouping by observed maximum is descriptive and not an experiment or a new gate.',
    'CPU is integrated over intervals labelled C6 at sample completion; boundaries can straddle phases. It includes the single-process harness and API.',
    'SQL driver durations include client scheduling and network, not only PostgreSQL execution. Spans overlap and must not be summed as a wall-time budget.',
    'Non-idle session counts are sampled observations, not CPU-time shares. Slow event loops delay sampling.',
    'No per-allocation timestamps/operation labels, GC/profiler traces, core frequencies or per-process host deltas were saved.',
    'Correlations are descriptive for twelve bursts, with variant/time confounding; they do not establish causality.'],
  sources: [...sources].map(([p,h]) => ({path:p,sha256:h})) };
fs.writeFileSync(path.join(__dirname, 'analysis.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({validation: result.validation, groups, correlations}, null, 2));
