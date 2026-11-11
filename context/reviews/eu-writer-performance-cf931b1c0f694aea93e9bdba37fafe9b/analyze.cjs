'use strict';
// Offline evidence analysis only. No runtime imports, network, SQL, or processes.
// Usage: node analyze.cjs <metadata/report.json> <http/report.json>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const PIN = Object.freeze({
  trialId: 'eu-writer-trial-0ecb31dc7c705859',
  sourceSetDigest: '0ecb31dc7c70585959a97b38046e79c5aa0dec06b87763a557720ad3e8ce1d6c',
  manifestSha256: '767625d37bece93c7877a577c527324ce514cec3081ed57451d1677b04be7afc',
  seedDigest: '3809b44e0f34f7a5f6868b9052fb66af021051292b0b49648b9d0e8876edf3f6',
});
const IMAGE_PINS = Object.freeze({ postgres: 'sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',
  keycloak: 'sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc' });
const SCENARIOS = Object.freeze([
  { id: 'report-c1', concurrency: 1, tenants: 1, attempts: 4 },
  { id: 'report-c2', concurrency: 2, tenants: 1, attempts: 4 },
  { id: 'report-c4', concurrency: 4, tenants: 1, attempts: 8 },
  { id: 'dashboard-c1', concurrency: 1, tenants: 1, attempts: 4 },
  { id: 'dashboard-c4', concurrency: 4, tenants: 1, attempts: 8 },
  { id: 'dashboard-c4-two-tenants', concurrency: 4, tenants: 2, attempts: 8 },
]);
const issues = [];
const check = (condition, code, context = {}) => { if (!condition) issues.push({ code, ...context }); return Boolean(condition); };
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const sum = values => values.reduce((total, value) => total + value, 0);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ratio = (numerator, denominator) => finite(numerator) && finite(denominator) && denominator > 0 ? numerator / denominator : null;
function stats(values) {
  const valid = values.filter(finite).sort((a, b) => a - b);
  const rank = p => valid.length ? valid[Math.ceil(valid.length * p) - 1] : null;
  return { n: valid.length, missing: values.length - valid.length, minimum: valid[0] ?? null,
    p50: rank(.5), p95: rank(.95), maximum: rank(1), mean: valid.length ? sum(valid) / valid.length : null };
}
function union(intervals) {
  let last = -Infinity, total = 0;
  for (const [start, end] of intervals.slice().sort((a, b) => a[0] - b[0])) {
    if (!finite(start) || !finite(end) || end < start) return null;
    total += Math.max(0, end - Math.max(start, last)); last = Math.max(last, end);
  }
  return total;
}
const intervals = events => events.map(event => [event.startMs, event.endMs]);
function clipped(events, from, to = Infinity) {
  return events.map(event => [Math.max(event.startMs, from), Math.min(event.endMs, to)])
    .filter(([start, end]) => end >= start);
}
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows) { const id = key(row); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(row); }
  return groups;
};
const exactIndices = (rows, count, field) => rows.length === count &&
  new Set(rows.map(row => row[field])).size === count && rows.every(row => Number.isInteger(row[field]) && row[field] >= 0 && row[field] < count);

function read(file) { const bytes = fs.readFileSync(file); return { path: path.resolve(file), sha256: sha(bytes), bytes: bytes.length, data: JSON.parse(bytes) }; }
function bundleFor(file) {
  let folder = path.dirname(file);
  for (let depth = 0; depth < 5; depth++, folder = path.dirname(folder)) if (fs.existsSync(path.join(folder, 'trial.json'))) return folder;
  return null;
}
function validateReport(input, mode, expectedStages) {
  const report = input.data, context = { mode };
  check(report.mode === mode, 'MODE_MISMATCH', context);
  check(report.status === 'PASS', 'REPORT_NOT_PASS', { ...context, actual: report.status, failure: report.failure ?? null });
  check(report.performanceMeasurement === true && report.habitualEnvironmentAccess === false, 'EXECUTION_SCOPE_INVALID', context);
  check(report.cleanup === true && report.sourceIntegrityAfter === 'PASS', 'REPORT_CLEANUP_OR_INTEGRITY_INVALID', context);
  for (const [key, value] of Object.entries(PIN)) check(report[key] === value, 'IDENTITY_MISMATCH', { ...context, key });
  for (const [key, value] of Object.entries(IMAGE_PINS)) check(report.images?.[key]?.id === value, 'IMAGE_PIN_MISMATCH', { ...context, image: key });
  check(list(report.stages).map(stage => stage.stage).join(',') === expectedStages.join(','), 'STAGES_MISMATCH', context);
  const bundle = bundleFor(input.path);
  check(Boolean(bundle), 'BUNDLE_MANIFEST_MISSING', context);
  if (bundle) check(sha(fs.readFileSync(path.join(bundle, 'trial.json'))) === PIN.manifestSha256, 'MANIFEST_DIGEST_MISMATCH', context);
  for (const stage of list(report.stages)) {
    const at = { ...context, stage: stage.stage, index: stage.index }, child = stage.result || {};
    check(stage.status === 'PASS' && child.status === 'PASS', 'STAGE_NOT_PASS', { ...at, failure: stage.failure ?? child.failure ?? null });
    check(stage.cleanup?.status === 'PASS' && child.cleanup === true && child.sourceIntegrityAfter === 'PASS', 'STAGE_CLEANUP_OR_INTEGRITY_INVALID', at);
    check(stage.childCleanup?.exitVerified === true, 'CHILD_EXIT_UNVERIFIED', at);
    check(child.mode === mode && child.stage === stage.stage && child.performanceMeasurement === true, 'CHILD_SCOPE_MISMATCH', at);
    for (const [key, value] of Object.entries(PIN)) check(child[key] === value, 'CHILD_IDENTITY_MISMATCH', { ...at, key });
    if (bundle && stage.evidence?.path && /^[a-f0-9]{64}$/.test(stage.evidence?.sha256 || '')) {
      const childPath = path.resolve(bundle, stage.evidence.path), relative = path.relative(bundle, childPath);
      if (check(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'CHILD_EVIDENCE_PATH_INVALID', at)) {
        try { const actual = read(childPath); check(actual.sha256 === stage.evidence.sha256, 'CHILD_DIGEST_MISMATCH', at);
          check(isDeepStrictEqual(actual.data, child), 'EMBEDDED_CHILD_MISMATCH', at); }
        catch (error) { check(false, 'CHILD_EVIDENCE_UNREADABLE', { ...at, error: error.code || error.name }); }
      }
    } else check(false, 'CHILD_EVIDENCE_MISSING', at);
    check(isDeepStrictEqual(stage.environment?.images, report.images), 'STAGE_IMAGES_MISMATCH', at);
  }
  return { path: input.path, sha256: input.sha256, bytes: input.bytes, status: report.status, mode, runId: report.runId,
    startedAt: report.startedAt, finishedAt: report.finishedAt, cleanup: report.cleanup, sourceIntegrityAfter: report.sourceIntegrityAfter,
    trialId: report.trialId, images: report.images, environment: report.environment, stageEvidence: list(report.stages).map(stage => stage.evidence ?? null) };
}

function metadataAnalysis(report) {
  const result = { revisions: [], samples: [], blocks: [], pairs: [] };
  for (const stage of list(report.stages)) {
    const revision = stage.stage, m = stage.result?.metadata || {}, context = { revision };
    check(m.status === 'PASS' && m.mode === 'measure' && m.revision?.startsWith(revision + '_'), 'METADATA_STATUS_INVALID', context);
    check(m.clock === 'MONOTONIC' && m.quantiles === 'NEAREST_RANK', 'METADATA_SEMANTICS_INVALID', context);
    check(['exactJsonBytes', 'exactFingerprint', 'freshReadsPerCall', 'securityReadsPreserved'].every(key => m.checks?.[key] === true), 'METADATA_FUNCTIONAL_CHECKS_INCOMPLETE', context);
    check(stage.result?.metadataDrift?.status === 'PASS', 'METADATA_DRIFT_NOT_PASS', context);
    const samples = list(m.samples), connections = list(m.connections);
    const phases = Object.fromEntries([...groupBy(samples, sample => sample.phase)].map(([key, values]) => [key, values.length]));
    check(phases.measured === 1200 && phases.warmup === 120 && phases.equivalence === 4 && phases.validation === 4 && samples.length === 1328, 'METADATA_PHASE_COUNTS_INVALID', { ...context, phases });
    check(connections.length === 13 && connections.every(connection => connection.callerOwned === false && nonnegative(connection.acquisitionMs)), 'METADATA_CONNECTIONS_INVALID', context);
    check(new Set(connections.map(connection => connection.label)).size === 13 && ['functional', ...Array.from({ length: 12 }, (_, index) => 'block-' + index)].every(label => connections.some(connection => connection.label === label)), 'METADATA_CONNECTION_LABELS_INVALID', context);
    for (const sample of samples) {
      const queries = list(sample.queries), base = queries.filter(query => query.kind === 'base'), security = queries.filter(query => query.kind === 'security');
      const expectedBase = sample.variant === 'M7' ? 7 : sample.variant === 'M1' ? 1 : null;
      const expectedSecurity = sample.phase === 'equivalence' ? 7 : revision === '043' ? 17 : 12;
      const at = { ...context, variant: sample.variant, phase: sample.phase, block: sample.blockIndex, sample: sample.sampleIndex };
      check(sample.status === 'PASS' && nonnegative(sample.durationMs) && sample.fingerprint === m.fingerprint, 'METADATA_SAMPLE_INVALID', at);
      check(base.length === expectedBase && security.length === expectedSecurity && queries.length === base.length + security.length &&
        sample.queryCounts?.base === expectedBase && sample.queryCounts?.security === expectedSecurity, 'METADATA_QUERY_COUNT_INVALID', at);
      const validQueries = queries.every(query => query.status === 'PASS' && nonnegative(query.durationMs));
      check(validQueries, 'METADATA_QUERY_DURATION_OR_STATUS_INVALID', at);
      const baseMs = validQueries ? sum(base.map(query => query.durationMs)) : null;
      const securityMs = validQueries ? sum(security.map(query => query.durationMs)) : null;
      const observedWorkMs = validQueries ? baseMs + securityMs : null;
      check(finite(observedWorkMs) && finite(sample.driverObservedWorkMs) && Math.abs(observedWorkMs - sample.driverObservedWorkMs) < .00001, 'METADATA_WORK_SUM_MISMATCH', at);
      result.samples.push({ revision, variant: sample.variant, phase: sample.phase, pair: sample.pairIndex, block: sample.blockIndex,
        index: sample.sampleIndex, status: sample.status, ms: finite(sample.durationMs) ? sample.durationMs : null,
        baseQueries: base.length, securityQueries: security.length, baseMs, securityMs, observedWorkMs,
        residualMs: finite(observedWorkMs) && finite(sample.durationMs) ? sample.durationMs - observedWorkMs : null,
        baseFraction: ratio(baseMs, sample.durationMs), securityFraction: ratio(securityMs, sample.durationMs), fingerprint: sample.fingerprint });
    }
    const revisionSamples = result.samples.filter(sample => sample.revision === revision);
    const blocks = list(m.blocks);
    check(exactIndices(blocks, 12, 'blockIndex'), 'METADATA_BLOCK_COUNT_INVALID', context);
    for (const block of blocks) {
      const population = revisionSamples.filter(sample => sample.block === block.blockIndex && sample.phase === 'measured');
      const warmups = revisionSamples.filter(sample => sample.block === block.blockIndex && sample.phase === 'warmup');
      check(exactIndices(population, 100, 'index') && exactIndices(warmups, 10, 'index') && population.every(sample => sample.variant === block.variant && sample.pair === block.pairIndex), 'METADATA_BLOCK_POPULATION_INVALID', { ...context, block: block.blockIndex });
      check(block.status === 'PASS' && block.controlBudgetMs === 300000 && nonnegative(block.controlElapsedMs) && block.controlElapsedMs <= 300000, 'METADATA_BLOCK_BUDGET_INVALID', { ...context, block: block.blockIndex });
      const computed = stats(population.map(sample => sample.ms));
      check(block.count === computed.n && block.warmups === 10 && block.p50Ms === computed.p50 && block.p95Ms === computed.p95 && block.maximumMs === computed.maximum, 'METADATA_REPORTED_BLOCK_QUANTILES_MISMATCH', { ...context, block: block.blockIndex });
      result.blocks.push({ revision, block: block.blockIndex, pair: block.pairIndex, variant: block.variant, status: block.status,
        latencyMs: stats(population.map(sample => sample.ms)), baseMs: stats(population.map(sample => sample.baseMs)),
        securityMs: stats(population.map(sample => sample.securityMs)), residualMs: stats(population.map(sample => sample.residualMs)),
        acquisitionMs: connections.find(connection => connection.label === 'block-' + block.blockIndex)?.acquisitionMs ?? null,
        controlElapsedMs: block.controlElapsedMs, processCpuMicroseconds: block.processCpuMicroseconds ?? null,
        memoryBefore: block.memoryBefore ?? null, memoryAfter: block.memoryAfter ?? null });
    }
    for (let pair = 0; pair < 6; pair++) {
      const two = result.blocks.filter(block => block.revision === revision && block.pair === pair).sort((a, b) => a.block - b.block);
      const expectedOrder = pair % 2 ? ['M1', 'M7'] : ['M7', 'M1'];
      check(two.map(block => block.variant).join(',') === expectedOrder.join(','), 'METADATA_PAIR_ORDER_INVALID', { ...context, pair });
      const m7 = two.find(block => block.variant === 'M7'), m1 = two.find(block => block.variant === 'M1');
      const differences = {}, percentages = {};
      for (const quantile of ['p50', 'p95', 'maximum', 'mean']) {
        const a = m7?.latencyMs[quantile], b = m1?.latencyMs[quantile];
        differences[quantile] = finite(a) && finite(b) ? b - a : null;
        percentages[quantile] = finite(a) && finite(b) && a > 0 ? (b / a - 1) * 100 : null;
      }
      result.pairs.push({ revision, pair, order: two.map(block => block.variant), m1MinusM7Ms: differences, m1RelativeChangePercent: percentages });
    }
    const variants = {};
    for (const variant of ['M7', 'M1']) {
      const population = revisionSamples.filter(sample => sample.phase === 'measured' && sample.variant === variant);
      check(population.length === 600, 'METADATA_VARIANT_POPULATION_INVALID', { ...context, variant });
      variants[variant] = { latencyMs: stats(population.map(sample => sample.ms)), baseMs: stats(population.map(sample => sample.baseMs)),
        securityMs: stats(population.map(sample => sample.securityMs)), observedWorkMs: stats(population.map(sample => sample.observedWorkMs)),
        residualMs: stats(population.map(sample => sample.residualMs)), baseFraction: stats(population.map(sample => sample.baseFraction)),
        securityFraction: stats(population.map(sample => sample.securityFraction)), queryCount: sum(population.map(sample => sample.baseQueries + sample.securityQueries)) };
    }
    const pairs = result.pairs.filter(pair => pair.revision === revision);
    result.revisions.push({ revision, status: m.status, totalCalls: samples.length, phases, variants,
      pairP50ChangeMs: stats(pairs.map(pair => pair.m1MinusM7Ms.p50)), pairP95ChangeMs: stats(pairs.map(pair => pair.m1MinusM7Ms.p95)),
      pairP50ChangePercent: stats(pairs.map(pair => pair.m1RelativeChangePercent.p50)), pairP95ChangePercent: stats(pairs.map(pair => pair.m1RelativeChangePercent.p95)),
      pairsM1FasterAtP50: pairs.filter(pair => pair.m1MinusM7Ms.p50 < 0).length,
      pairsM1FasterAtP95: pairs.filter(pair => pair.m1MinusM7Ms.p95 < 0).length,
      totalDurationMs: m.totalDurationMs, drift: stage.result?.metadataDrift ?? null });
  }
  return result;
}

function validEvent(event) { return nonnegative(event?.startMs) && finite(event?.endMs) && event.endMs >= event.startMs; }
function requestCost(row, replica) {
  const record = row.metrics, events = list(record?.queryEvents), spans = list(record?.spans), checkouts = list(record?.checkouts), admissions = list(record?.admissions), locks = list(record?.lockEvents);
  const context = { replica, scenario: row.scenario, attempt: row.attempt, tenant: row.tenant };
  const complete = Boolean(record && record.queryCount > 0 && record.queryCount === events.length && record.pendingQueries === 0 &&
    events.every(validEvent) && spans.length && spans.every(validEvent) && checkouts.length &&
    spans.some(span => ['assertCentralSchema', 'assertCentralSchemaForVersions'].includes(span.name)) && spans.some(span => span.name === 'observeTenantRuntimeMetadata') &&
    checkouts.every(entry => nonnegative(entry.waitMs) && (entry.error || nonnegative(entry.holdMs))) && admissions.length &&
    admissions.every(entry => nonnegative(entry.ms) && nonnegative(entry.before?.active) && nonnegative(entry.before?.queued) && nonnegative(entry.after?.active) && nonnegative(entry.after?.queued)) &&
    Array.isArray(record.lockEvents) && locks.every(validEvent) && nonnegative(record.start) && nonnegative(record.responseAt) && record.responseAt >= record.start &&
    Number.isInteger(record.transactionCount) && record.transactionCount >= 0 && Array.isArray(record.sqlErrors) && record.sqlErrors.length === 0 && Array.isArray(record.failures) && record.failures.length === 0);
  check(complete && row.instrumentationPass === true, 'HTTP_METRICS_INCOMPLETE', context);
  check(row.functionalPass === true && row.normalizedResponsePass === true && /^[a-f0-9]{64}$/.test(row.responseDigest || ''), 'HTTP_FUNCTIONAL_FAILURE', context);
  check(row.status === 200 && nonnegative(row.ms), 'HTTP_ATTEMPT_FAILURE', { ...context, status: row.status, code: row.code });
  const base = { ...context, status: row.status, code: row.code, ms: finite(row.ms) ? row.ms : null,
    responseDigest: row.responseDigest, functionalPass: row.functionalPass, normalizedResponsePass: row.normalizedResponsePass,
    instrumentationPass: row.instrumentationPass, completeMetrics: complete, queryCount: record?.queryCount ?? null,
    transactionCount: record?.transactionCount ?? null, pendingQueries: record?.pendingQueries ?? null,
    sqlErrors: record?.sqlErrors ?? null, failures: record?.failures ?? null };
  if (!complete) return base;
  const responseMs = record.responseAt - record.start;
  check(events.every(event => event.afterResponse === (event.endMs > responseMs)), 'HTTP_AFTER_RESPONSE_FLAG_MISMATCH', context);
  const metadata = events.filter(event => event.category === 'metadata'), central = metadata.filter(event => event.role !== 'tenant'), tenant = metadata.filter(event => event.role === 'tenant');
  const queryUnionMs = union(intervals(events)), metadataUnionMs = union(intervals(metadata)), centralMetadataMs = union(intervals(central)), tenantMetadataMs = union(intervals(tenant));
  const before = group => union(clipped(group, 0, responseMs));
  const after = group => union(clipped(group, responseMs));
  const queryBeforeResponseMs = before(events), metadataBeforeResponseMs = before(metadata);
  const acquisition = events.filter(event => event.category === 'authority-lock');
  return { ...base, serverResponseMs: responseMs, queryObservedWorkMs: sum(events.map(event => event.endMs - event.startMs)),
    queryUnionMs, centralMetadataMs, tenantMetadataMs, metadataUnionMs, queryBeforeResponseMs, metadataBeforeResponseMs,
    queryUnionToHttpRatio: ratio(queryUnionMs, row.ms), metadataUnionToHttpRatio: ratio(metadataUnionMs, row.ms),
    centralMetadataToHttpRatio: ratio(centralMetadataMs, row.ms), tenantMetadataToHttpRatio: ratio(tenantMetadataMs, row.ms),
    queryBeforeResponseToHttpRatio: ratio(queryBeforeResponseMs, row.ms), metadataBeforeResponseToHttpRatio: ratio(metadataBeforeResponseMs, row.ms),
    queryOutsideMetadataUnionMs: queryUnionMs - metadataUnionMs,
    queryCompletedAfterResponse: events.filter(event => event.endMs > responseMs).length, queryAfterResponseUnionMs: after(events),
    authorityLockAcquisitionObservedMs: sum(acquisition.map(event => event.endMs - event.startMs)), authorityLockHeldUnionMs: union(intervals(locks)),
    checkoutCount: checkouts.length, checkoutWaitSumMs: sum(checkouts.map(entry => entry.waitMs)),
    checkoutHoldSumMs: checkouts.every(entry => nonnegative(entry.holdMs)) ? sum(checkouts.map(entry => entry.holdMs)) : null,
    admissionCount: admissions.length, managerAcquireSumMs: sum(admissions.map(entry => entry.ms)),
    observedManagerActiveMaximum: Math.max(...admissions.flatMap(entry => [entry.before.active, entry.after.active])),
    observedManagerQueuedMaximum: Math.max(...admissions.flatMap(entry => [entry.before.queued, entry.after.queued])),
    _events: events, _spans: spans, _checkouts: checkouts, _admissions: admissions };
}
const COST_FIELDS = ['ms', 'serverResponseMs', 'queryCount', 'transactionCount', 'queryObservedWorkMs', 'queryUnionMs', 'centralMetadataMs', 'tenantMetadataMs',
  'metadataUnionMs', 'queryOutsideMetadataUnionMs', 'queryBeforeResponseMs', 'metadataBeforeResponseMs', 'queryUnionToHttpRatio', 'metadataUnionToHttpRatio',
  'centralMetadataToHttpRatio', 'tenantMetadataToHttpRatio', 'queryBeforeResponseToHttpRatio', 'metadataBeforeResponseToHttpRatio',
  'queryCompletedAfterResponse', 'queryAfterResponseUnionMs', 'authorityLockAcquisitionObservedMs', 'authorityLockHeldUnionMs',
  'checkoutCount', 'checkoutWaitSumMs', 'checkoutHoldSumMs', 'admissionCount', 'managerAcquireSumMs', 'observedManagerActiveMaximum', 'observedManagerQueuedMaximum'];
function httpPopulation(rows) {
  const good = rows.filter(row => row.status === 200), complete = rows.filter(row => row.completeMetrics);
  return { n: rows.length, successes: good.length, errors: rows.length - good.length, timeouts: rows.filter(row => row.code === 'HTTP_TIMEOUT').length,
    http503: rows.filter(row => row.status === 503).length, incompleteMetrics: rows.length - complete.length,
    functionalFailures: rows.filter(row => row.functionalPass !== true || row.normalizedResponsePass !== true).length,
    successLatencyMs: stats(good.map(row => row.ms)), allAttemptLatencyMs: stats(rows.map(row => row.ms)),
    perRequest: Object.fromEntries(COST_FIELDS.map(field => [field, stats(rows.map(row => row[field]))])) };
}
function queryGroups(rows, kind, key) {
  const complete = rows.filter(row => row.completeMetrics), identifiers = new Set(complete.flatMap(row => row._events.map(key)));
  return [...identifiers].map(id => {
    const perRequest = complete.map(row => { const events = row._events.filter(event => key(event) === id); return { count: events.length,
      work: sum(events.map(event => event.endMs - event.startMs)), wall: union(intervals(events)), ratio: ratio(union(intervals(events)), row.ms) }; });
    const events = complete.flatMap(row => row._events.filter(event => key(event) === id));
    return { kind, id, requests: complete.length, requestsWithQueries: perRequest.filter(row => row.count > 0).length, queryCount: events.length,
      observedWorkMs: sum(perRequest.map(row => row.work)), eventDurationMs: stats(events.map(event => event.endMs - event.startMs)),
      perRequestCount: stats(perRequest.map(row => row.count)), perRequestObservedWorkMs: stats(perRequest.map(row => row.work)),
      perRequestUnionMs: stats(perRequest.map(row => row.wall)), perRequestUnionToHttpRatio: stats(perRequest.map(row => row.ratio)) };
  }).sort((a, b) => b.observedWorkMs - a.observedWorkMs);
}
function otherCosts(rows) {
  const complete = rows.filter(row => row.completeMetrics), names = new Set(complete.flatMap(row => row._spans.map(span => span.name)));
  const spans = [...names].map(name => {
    const matching = complete.map(row => row._spans.filter(span => span.name === name));
    return { name, inclusive: true, eventDurationMs: stats(matching.flat().map(span => span.endMs - span.startMs)),
      perRequestCount: stats(matching.map(group => group.length)), perRequestUnionMs: stats(matching.map(group => union(intervals(group)))),
      perRequestObservedWorkMs: stats(matching.map(group => sum(group.map(span => span.endMs - span.startMs)))) };
  });
  const checkouts = [...groupBy(complete.flatMap(row => row._checkouts), entry => entry.role || 'UNKNOWN')].map(([role, values]) => ({ role,
    n: values.length, errors: values.filter(value => value.error).length, waitMs: stats(values.map(value => value.waitMs)), holdMs: stats(values.map(value => value.holdMs)),
    observedPoolMaxima: [...new Set(values.map(value => value.max))] }));
  const admissions = complete.flatMap(row => row._admissions);
  return { spans, checkouts, admissions: { n: admissions.length, errors: admissions.filter(value => value.error).length,
    acquireMs: stats(admissions.map(value => value.ms)), scope: 'END_TO_END_MANAGER_ACQUIRE_INCLUDES_QUEUE_PREPARATION_AND_PHYSICAL_CHECKOUT' } };
}
function samplerAnalysis(stages) {
  const rows = [], phases = [];
  for (const stage of stages) {
    const replica = stage.index, evidence = stage.result?.instrumentation || {}, samples = list(evidence.samples);
    check(evidence.samplerIntervalMs === 100 && Array.isArray(evidence.samplerErrors) && evidence.samplerErrors.length === 0 && samples.length > 0, 'SAMPLER_INVALID', { replica });
    let prior;
    for (const sample of samples) {
      const managers = list(sample.managers), sessions = list(sample.sessions), elapsedMs = prior ? Date.parse(sample.at) - Date.parse(prior.at) : null;
      check(typeof sample.phase === 'string' && Number.isFinite(Date.parse(sample.at)) && nonnegative(sample.sampleMs) && nonnegative(sample.cpu?.user) && nonnegative(sample.cpu?.system) && nonnegative(sample.memory?.rss) && nonnegative(sample.memory?.heapUsed) && Array.isArray(sample.managers) && managers.every(manager => nonnegative(manager.active) && nonnegative(manager.queued)) && Array.isArray(sample.sessions) && sessions.every(session => nonnegative(session.blockingCount) && (session.transactionMs === null || nonnegative(session.transactionMs))), 'SAMPLER_SAMPLE_INCOMPLETE', { replica, phase: sample.phase, at: sample.at });
      const samePhase = prior && sample.phase === prior.phase;
      const cpuUser = samePhase && finite(sample.cpu?.user) && finite(prior.cpu?.user) ? sample.cpu.user - prior.cpu.user : null;
      const cpuSystem = samePhase && finite(sample.cpu?.system) && finite(prior.cpu?.system) ? sample.cpu.system - prior.cpu.system : null;
      const validCpu = samePhase && elapsedMs > 0 && nonnegative(cpuUser) && nonnegative(cpuSystem);
      rows.push({ replica, phase: sample.phase, at: sample.at, observerMs: sample.sampleMs,
        rssBytes: sample.memory?.rss ?? null, heapUsedBytes: sample.memory?.heapUsed ?? null,
        cpuUserMicroseconds: validCpu ? cpuUser : null, cpuSystemMicroseconds: validCpu ? cpuSystem : null, cpuIntervalMs: validCpu ? elapsedMs : null,
        nodeCpuFractionOneCore: validCpu ? (cpuUser + cpuSystem) / (elapsedMs * 1000) : null,
        managerCount: managers.length, activeSum: managers.length ? sum(managers.map(value => value.active)) : null,
        queuedSum: managers.length ? sum(managers.map(value => value.queued)) : null,
        managerActiveMaximum: managers.length ? Math.max(...managers.map(value => value.active)) : null,
        managerQueuedMaximum: managers.length ? Math.max(...managers.map(value => value.queued)) : null,
        postgresSessions: sessions.length, blockedSessions: sessions.filter(value => value.blockingCount > 0).length,
        blockersSum: sum(sessions.map(value => value.blockingCount)), maximumTransactionMs: sessions.some(value => finite(value.transactionMs)) ? Math.max(...sessions.map(value => value.transactionMs).filter(finite)) : null,
        _sessions: sessions });
      prior = sample;
    }
  }
  for (const [key, population] of groupBy(rows, row => row.replica + ':' + row.phase)) {
    const cpu = population.filter(row => finite(row.cpuIntervalMs)), sessions = population.flatMap(row => row._sessions);
    phases.push({ replica: population[0].replica, phase: population[0].phase, sampleCount: population.length,
      cpuIntervals: cpu.length, cpuExcludedBoundaryOrInvalidIntervals: population.length - cpu.length,
      cpuObservedWallMs: sum(cpu.map(row => row.cpuIntervalMs)),
      nodeCpuUserMicroseconds: cpu.length ? sum(cpu.map(row => row.cpuUserMicroseconds)) : null, nodeCpuSystemMicroseconds: cpu.length ? sum(cpu.map(row => row.cpuSystemMicroseconds)) : null,
      nodeCpuFractionOneCore: cpu.length ? ratio(sum(cpu.map(row => row.cpuUserMicroseconds + row.cpuSystemMicroseconds)), 1000 * sum(cpu.map(row => row.cpuIntervalMs))) : null,
      observerMs: stats(population.map(row => row.observerMs)), rssBytes: stats(population.map(row => row.rssBytes)), heapUsedBytes: stats(population.map(row => row.heapUsedBytes)),
      activeSum: stats(population.map(row => row.activeSum)), queuedSum: stats(population.map(row => row.queuedSum)),
      managerActiveMaximum: stats(population.map(row => row.managerActiveMaximum)), managerQueuedMaximum: stats(population.map(row => row.managerQueuedMaximum)),
      blockedSessions: stats(population.map(row => row.blockedSessions)), samplesWithBlockedSessions: population.filter(row => row.blockedSessions > 0).length,
      maximumTransactionMs: stats(population.map(row => row.maximumTransactionMs)),
      postgresStateWaitObservations: [...groupBy(sessions, session => JSON.stringify([session.state, session.waitType, session.wait]))]
        .map(([id, values]) => ({ stateWait: JSON.parse(id), observations: values.length, observationsWithBlockers: values.filter(value => value.blockingCount > 0).length })) });
  }
  return { rows, phases };
}
function httpAnalysis(report) {
  const rows = [], warmups = [], scenarioReports = [], stages = list(report.stages);
  check(exactIndices(stages, 3, 'index'), 'HTTP_REPLICA_INDICES_INVALID');
  for (const stage of stages) {
    const http = stage.result?.http || {}, replica = stage.index;
    check(http.status === 'PASS' && http.replica === replica, 'HTTP_REPLICA_STATUS_INVALID', { replica });
    check(stage.result?.httpReadiness?.status === 'PASS', 'HTTP_READINESS_INVALID', { replica });
    const attempts = list(http.attempts), warm = list(http.warmups);
    check(attempts.length === 36 && warm.length === 7 && list(http.scenarios).length === 6, 'HTTP_REPLICA_POPULATION_INVALID', { replica });
    for (const scenario of SCENARIOS) {
      const population = attempts.filter(row => row.scenario === scenario.id), pre = warm.filter(row => row.scenario === scenario.id);
      check(exactIndices(population, scenario.attempts, 'attempt') && population.every(row => row.replica === replica && row.tenant === row.attempt % scenario.tenants), 'HTTP_SCENARIO_POPULATION_INVALID', { replica, scenario: scenario.id });
      check(exactIndices(pre, scenario.tenants, 'tenant') && pre.every(row => row.status === 200 && row.replica === replica && /^[a-f0-9]{64}$/.test(row.responseDigest || '')), 'HTTP_WARMUP_INVALID', { replica, scenario: scenario.id });
      for (const row of population) check(row.responseDigest === pre.find(value => value.tenant === row.tenant)?.responseDigest, 'HTTP_DIGEST_MISMATCH', { replica, scenario: scenario.id, attempt: row.attempt });
      const supplied = list(http.scenarios).filter(value => value.id === scenario.id);
      check(supplied.length === 1 && supplied[0].status === 'PASS' && supplied[0].controlBudgetMs === 180000 && nonnegative(supplied[0].controlElapsedMs) && supplied[0].controlElapsedMs <= 180000 && nonnegative(supplied[0].drainMs) && supplied[0].drainMs <= 30000, 'HTTP_SCENARIO_BUDGET_OR_DRAIN_INVALID', { replica, scenario: scenario.id });
      scenarioReports.push({ replica, scenario: scenario.id, concurrency: scenario.concurrency, participatingTenants: scenario.tenants, ...supplied[0] });
    }
    rows.push(...attempts.map(row => requestCost(row, replica)));
    warmups.push(...warm.map(row => ({ replica, scenario: row.scenario, tenant: row.tenant, ms: row.ms, status: row.status, responseDigest: row.responseDigest })));
    check(nonnegative(stage.result?.drainMs) && stage.result.drainMs <= 30000, 'HTTP_FINAL_DRAIN_INVALID', { replica });
  }
  check(rows.length === 108 && warmups.length === 21 && report.httpCounts?.attempts === 108 && report.httpCounts?.warmups === 21, 'HTTP_TOTAL_COUNTS_INVALID');
  const populations = [];
  for (const scenario of SCENARIOS) {
    const all = rows.filter(row => row.scenario === scenario.id);
    populations.push({ scenario: scenario.id, replica: 'ALL', tenant: 'ALL', ...httpPopulation(all), ...otherCosts(all) });
    for (let replica = 0; replica < 3; replica++) {
      const population = all.filter(row => row.replica === replica);
      populations.push({ scenario: scenario.id, replica, tenant: 'ALL', ...httpPopulation(population), ...otherCosts(population) });
    }
    if (scenario.tenants > 1) for (let tenant = 0; tenant < scenario.tenants; tenant++) populations.push({ scenario: scenario.id, replica: 'ALL', tenant, ...httpPopulation(all.filter(row => row.tenant === tenant)) });
  }
  const costs = [];
  for (const scenario of SCENARIOS) {
    const population = rows.filter(row => row.scenario === scenario.id);
    for (const [kind, key] of [['category', event => event.category], ['role', event => event.role], ['roleCategory', event => event.role + ':' + event.category], ['hash', event => event.role + ':' + event.category + ':' + event.hash]])
      costs.push(...queryGroups(population, kind, key).map(group => ({ scenario: scenario.id, ...group })));
  }
  const sampler = samplerAnalysis(stages);
  return { totals: httpPopulation(rows), populations, scenarios: scenarioReports, costs, requests: rows, warmups,
    samplerPhases: sampler.phases, samplerRows: sampler.rows, stageDrainMs: stages.map(stage => ({ replica: stage.index, ms: stage.result?.drainMs ?? null })) };
}

function csv(rows) {
  const fields = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('_'))))];
  const encode = value => { const raw = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return /[",\r\n]/.test(raw) ? '"' + raw.replaceAll('"', '""') + '"' : raw; };
  return fields.map(encode).join(',') + '\r\n' + rows.map(row => fields.map(field => encode(row[field])).join(',')).join('\r\n') + '\r\n';
}
function main(args = process.argv.slice(2)) {
  if (args.length !== 2) throw new Error('Usage: node analyze.cjs <metadata/report.json> <http/report.json>');
  const outputs = ['summary.json', 'metadata-samples.csv', 'metadata-blocks.csv', 'metadata-pairs.csv', 'http-requests.csv', 'http-scenarios.csv', 'http-populations.csv', 'http-query-costs.csv', 'http-sampler.csv', 'http-sampler-phases.csv'];
  for (const name of outputs) if (fs.existsSync(path.join(__dirname, name))) throw new Error('Refusing to replace existing analysis: ' + name);
  const metadata = read(args[0]), http = read(args[1]), campaign = read(path.join(__dirname, 'protocol.json'));
  const inputs = { metadata: validateReport(metadata, 'measure-metadata', ['043', '042']), http: validateReport(http, 'measure-http', ['043', '043', '043']) };
  check(isDeepStrictEqual(metadata.data.images, http.data.images), 'M_H_IMAGES_MISMATCH');
  check(isDeepStrictEqual(campaign.data.images, metadata.data.images) && isDeepStrictEqual(campaign.data.images, http.data.images), 'CAMPAIGN_IMAGES_MISMATCH');
  check(campaign.data.trialId === PIN.trialId && campaign.data.sourceSetDigest === PIN.sourceSetDigest && campaign.data.manifest?.sha256 === PIN.manifestSha256 && campaign.data.seedDigest === PIN.seedDigest, 'CAMPAIGN_IDENTITY_MISMATCH');
  check(Date.parse(metadata.data.finishedAt) <= Date.parse(http.data.startedAt), 'M_H_EXECUTION_OVERLAP_OR_ORDER_INVALID');
  const m = metadataAnalysis(metadata.data), h = httpAnalysis(http.data);
  const limitations = [
    'Nearest-rank quantiles; raw values are not rounded. Ratios are computed within each request before their distribution is summarized.',
    'Six alternating metadata pairs per schema; 042 and 043 are separate populations. Functional and warmup calls are excluded from latency comparisons.',
    'HTTP p95 per replica has n=4 or n=8 and equals the maximum. This short closed-loop diagnostic is not a capacity test or an HTTP SLA.',
    'Query intervals include driver, network, database execution and waits. Sums are observed work, not SQL CPU. Interval unions avoid overlap within each request.',
    'Metadata category uses SQL classification; inclusive validation spans also contain security queries categorized elsewhere. Spans, queries, pool holds and lock holds overlap and must not be added.',
    'Manager acquire duration includes queueing, pool/credential preparation and physical checkout. There is no isolated per-request pure-queue timer.',
    'Authority-lock query duration is the observed acquisition round trip; authority-held interval starts after acquisition and ends at commit/rollback. Other locks have sampled observations only.',
    'Full query unions may extend beyond the response. Before-response unions and after-response unions are reported separately. HTTP timing includes client response parsing.',
    '100ms PostgreSQL sampling is observational and can miss short waits. Sessions carry no database/role identity in these reports, so sampled waits cannot be attributed to a specific request or tenant.',
    'CPU is the Node process only. Sample CPU deltas use adjacent same-phase timestamps; boundary intervals are excluded. RSS/heap are process memory; PostgreSQL/host CPU is not measured.',
    'Sampler phases are labels, not exclusive request windows: draining and final cleanup can retain the previous scenario label. Per-phase CPU is observational, not exclusive workload CPU.',
    'The campaign records hostReserved:false and externalLoadControlled:false with a balanced power scheme. Other host activity and power management can affect timing; no exclusive-host comparison is claimed.',
    'No production traffic, writer activity, historical causal comparison, optimization candidate B, or C6 admission certification is established by this analysis.',
    'Input source integrity PASS is checked against the reports and manifest identity; this offline utility does not re-execute the full source/dependency verifier.',
  ];
  const summary = { schemaVersion: 1, analysisId: 'eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b',
    generatedAt: new Date().toISOString(), analyzerSha256: sha(fs.readFileSync(__filename)), status: issues.length ? 'INVALID_OR_INCOMPLETE' : 'VALID',
    identity: PIN, inputs, campaign: { path: campaign.path, sha256: campaign.sha256, environment: {
      hostReserved: campaign.data.environment?.hostReserved ?? null, externalLoadControlled: campaign.data.environment?.externalLoadControlled ?? null,
      powerScheme: campaign.data.environment?.powerScheme ?? null } },
    validation: { issues, count: issues.length }, quantiles: 'NEAREST_RANK', roundingBeforeDecision: false, limitations,
    metadata: { revisions: m.revisions, blocks: m.blocks, pairs: m.pairs },
    http: { totals: h.totals, populations: h.populations, scenarios: h.scenarios, queryCosts: h.costs, samplerPhases: h.samplerPhases, stageDrainMs: h.stageDrainMs } };
  const files = {
    'summary.json': JSON.stringify(summary, null, 2) + '\n',
    'metadata-samples.csv': csv(m.samples), 'metadata-blocks.csv': csv(m.blocks), 'metadata-pairs.csv': csv(m.pairs),
    'http-requests.csv': csv(h.requests), 'http-scenarios.csv': csv(h.scenarios), 'http-populations.csv': csv(h.populations),
    'http-query-costs.csv': csv(h.costs), 'http-sampler.csv': csv(h.samplerRows), 'http-sampler-phases.csv': csv(h.samplerPhases),
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(__dirname, name), content, { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: summary.status, validationIssues: issues.length, summary: path.join(__dirname, 'summary.json'), files: outputs.length }) + '\n');
  if (issues.length) process.exitCode = 1;
  return summary;
}
if (require.main === module) main();
module.exports = { stats, union, metadataAnalysis, requestCost, httpPopulation, main };
