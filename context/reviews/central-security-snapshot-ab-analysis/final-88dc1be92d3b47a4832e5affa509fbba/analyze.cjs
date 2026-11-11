'use strict';
// Offline A/B evidence analysis. Builtins and the source-only verifier; no backend, SQL, network or process execution.
// Usage: node analyze.cjs <ab.json> <readiness/report.json> <metadata/report.json> <http/report.json> [continuation/report.json]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const SCENARIOS = Object.freeze([
  { id: 'report-c1', concurrency: 1, tenants: 1, attempts: 4 },
  { id: 'report-c2', concurrency: 2, tenants: 1, attempts: 4 },
  { id: 'report-c4', concurrency: 4, tenants: 1, attempts: 8 },
  { id: 'dashboard-c1', concurrency: 1, tenants: 1, attempts: 4 },
  { id: 'dashboard-c4', concurrency: 4, tenants: 1, attempts: 8 },
  { id: 'dashboard-c4-two-tenants', concurrency: 4, tenants: 2, attempts: 8 },
]);
const issues = [];
const check = (condition, code, context = {}) => { if (!condition) issues.push({ classification:'DATA_QUALITY', code, ...context }); return Boolean(condition); };
const protocolCheck = (condition, code, context = {}) => { if (!condition) issues.push({ classification:'PROTOCOL', code, ...context }); return Boolean(condition); };
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


function metadataAnalysis(report, proof) {
  const result = { revisions: [], samples: [], blocks: [], pairs: [] };
  for (const stage of list(report.stages)) {
    const revision = stage.revision, m = stage.result?.metadata || {}, context = { revision };
    check(m.status === 'PASS' && m.mode === 'measure' && m.revision?.startsWith(revision + '_'), 'METADATA_STATUS_INVALID', context);
    check(m.clock === 'MONOTONIC' && m.quantiles === 'NEAREST_RANK', 'METADATA_SEMANTICS_INVALID', context);
    check(m.comparison === 'ORIGINAL_AGGREGATE_VS_OPTIMIZED_AGGREGATE_WITH_IDENTICAL_SECURITY_CHECKPOINTS', 'METADATA_COMPARISON_INVALID', context);
    check(m.fingerprint === proof.revisions.find(x => x.revision === revision)?.finalBaseline?.sha256, 'METADATA_READINESS_FINGERPRINT_MISMATCH', context);
    check(['exactJsonBytes', 'exactFingerprint', 'freshReadsPerCall', 'securityReadsPreserved'].every(key => m.checks?.[key] === true), 'METADATA_FUNCTIONAL_CHECKS_INCOMPLETE', context);
    const samples = list(m.samples), connections = list(m.connections);
    const phases = Object.fromEntries([...groupBy(samples, sample => sample.phase)].map(([key, values]) => [key, values.length]));
    check(phases.measured === 1200 && phases.warmup === 120 && phases.equivalence === 4 && phases.validation === 4 && samples.length === 1328, 'METADATA_PHASE_COUNTS_INVALID', { ...context, phases });
    for (const arm of ['A','B']) for (const phase of ['equivalence','validation']) {
      const values = samples.filter(sample => sample.arm === arm && sample.phase === phase);
      check(exactIndices(values, 2, 'sampleIndex') && values.every(x => x.blockIndex === null && x.pairIndex === null), 'METADATA_FUNCTIONAL_POPULATION_INVALID', { ...context, arm, phase });
    }
    check(connections.length === 13 && connections.every(connection => connection.callerOwned === false && nonnegative(connection.acquisitionMs)), 'METADATA_CONNECTIONS_INVALID', context);
    check(new Set(connections.map(connection => connection.label)).size === 13 && ['functional', ...Array.from({ length: 12 }, (_, index) => 'block-' + index)].every(label => connections.some(connection => connection.label === label)), 'METADATA_CONNECTION_LABELS_INVALID', context);
    for (const sample of samples) {
      const queries = list(sample.queries), base = queries.filter(query => query.kind === 'base'), security = queries.filter(query => query.kind === 'security');
      const expectedBase = ['A', 'B'].includes(sample.arm) ? 1 : null;
      const expectedSecurity = sample.phase === 'equivalence' ? 7 : revision === '043' ? 17 : 12;
      const at = { ...context, arm: sample.arm, phase: sample.phase, block: sample.blockIndex, sample: sample.sampleIndex };
      check(sample.status === 'PASS' && nonnegative(sample.durationMs) && sample.fingerprint === m.fingerprint, 'METADATA_SAMPLE_INVALID', at);
      check(base.length === expectedBase && security.length === expectedSecurity && queries.length === base.length + security.length &&
        sample.queryCounts?.base === expectedBase && sample.queryCounts?.security === expectedSecurity, 'METADATA_QUERY_COUNT_INVALID', at);
      const validQueries = queries.every(query => query.status === 'PASS' && nonnegative(query.durationMs) && nonnegative(query.startedMs) && HASH.test(query.hash || ''));
      check(validQueries, 'METADATA_QUERY_DURATION_OR_STATUS_INVALID', at);
      check(base[0]?.hash === proof.sqlHashes[revision]?.[sample.arm]?.central && security[0]?.hash === proof.sqlHashes[revision]?.[sample.arm]?.security, 'METADATA_SQL_NOT_BOUND_TO_READINESS', at);
      check(queries[0]?.kind === 'base' && queries.slice(1).every(q => q.kind === 'security') && nonnegative(sample.startedMs) && queries.every(q => q.startedMs >= sample.startedMs && q.startedMs + q.durationMs <= sample.startedMs + sample.durationMs + .00001), 'METADATA_QUERY_INTERVAL_INVALID', at);
      const baseMs = validQueries ? sum(base.map(query => query.durationMs)) : null;
      const securityMs = validQueries ? sum(security.map(query => query.durationMs)) : null;
      const observedWorkMs = validQueries ? baseMs + securityMs : null;
      check(finite(observedWorkMs) && finite(sample.driverObservedWorkMs) && Math.abs(observedWorkMs - sample.driverObservedWorkMs) < .00001, 'METADATA_WORK_SUM_MISMATCH', at);
      check(observedWorkMs <= sample.durationMs + .00001, 'METADATA_WORK_EXCEEDS_CALL', at);
      result.samples.push({ revision, arm: sample.arm, phase: sample.phase, pair: sample.pairIndex, block: sample.blockIndex,
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
      check(exactIndices(population, 100, 'index') && exactIndices(warmups, 10, 'index') && [...population,...warmups].every(sample => sample.arm === block.arm && sample.pair === block.pairIndex), 'METADATA_BLOCK_POPULATION_INVALID', { ...context, block: block.blockIndex });
      check(block.status === 'PASS' && block.controlBudgetMs === 300000 && nonnegative(block.controlElapsedMs) && block.controlElapsedMs <= 300000, 'METADATA_BLOCK_BUDGET_INVALID', { ...context, block: block.blockIndex });
      const computed = stats(population.map(sample => sample.ms));
      check(block.count === computed.n && block.warmups === 10 && block.p50Ms === computed.p50 && block.p95Ms === computed.p95 && block.maximumMs === computed.maximum, 'METADATA_REPORTED_BLOCK_QUANTILES_MISMATCH', { ...context, block: block.blockIndex });
      result.blocks.push({ revision, block: block.blockIndex, pair: block.pairIndex, arm: block.arm, status: block.status,
        latencyMs: stats(population.map(sample => sample.ms)), baseMs: stats(population.map(sample => sample.baseMs)),
        securityMs: stats(population.map(sample => sample.securityMs)), residualMs: stats(population.map(sample => sample.residualMs)),
        acquisitionMs: connections.find(connection => connection.label === 'block-' + block.blockIndex)?.acquisitionMs ?? null,
        controlElapsedMs: block.controlElapsedMs, processCpuMicroseconds: block.processCpuMicroseconds ?? null,
        memoryBefore: block.memoryBefore ?? null, memoryAfter: block.memoryAfter ?? null });
    }
    for (let pair = 0; pair < 6; pair++) {
      const two = result.blocks.filter(block => block.revision === revision && block.pair === pair).sort((a, b) => a.block - b.block);
      const expectedOrder = pair % 2 ? ['B', 'A'] : ['A', 'B'];
      check(two.map(block => block.arm).join(',') === expectedOrder.join(','), 'METADATA_PAIR_ORDER_INVALID', { ...context, pair });
      const aBlock = two.find(block => block.arm === 'A'), bBlock = two.find(block => block.arm === 'B');
      const differences = {}, percentages = {};
      for (const quantile of ['p50', 'p95', 'maximum', 'mean']) {
        const a = aBlock?.latencyMs[quantile], b = bBlock?.latencyMs[quantile];
        differences[quantile] = finite(a) && finite(b) ? b - a : null;
        percentages[quantile] = finite(a) && finite(b) && a > 0 ? (b / a - 1) * 100 : null;
      }
      result.pairs.push({ revision, pair, order: two.map(block => block.arm), bMinusAMs: differences, bRelativeChangePercent: percentages });
      const emitted = list(m.pairs).filter(x => x.pairIndex === pair);
      check(emitted.length === 1 && isDeepStrictEqual(emitted[0].order, expectedOrder) && emitted[0].bMinusA?.p50Ms === differences.p50 && emitted[0].bMinusA?.p95Ms === differences.p95 && emitted[0].bMinusA?.maximumMs === differences.maximum, 'METADATA_REPORTED_PAIR_MISMATCH', { ...context, pair });
    }
    check(list(m.pairs).length === 6, 'METADATA_PAIR_COUNT_INVALID', context);
    const arms = {};
    for (const arm of ['A', 'B']) {
      const population = revisionSamples.filter(sample => sample.phase === 'measured' && sample.arm === arm);
      check(population.length === 600, 'METADATA_VARIANT_POPULATION_INVALID', { ...context, arm });
      const computed = stats(population.map(x => x.ms)), emitted = m.summary?.[arm];
      check(emitted?.count === 600 && emitted.p50Ms === computed.p50 && emitted.p95Ms === computed.p95 && emitted.maximumMs === computed.maximum, 'METADATA_REPORTED_SUMMARY_MISMATCH', { ...context, arm });
      arms[arm] = { latencyMs: stats(population.map(sample => sample.ms)), baseMs: stats(population.map(sample => sample.baseMs)),
        securityMs: stats(population.map(sample => sample.securityMs)), observedWorkMs: stats(population.map(sample => sample.observedWorkMs)),
        residualMs: stats(population.map(sample => sample.residualMs)), baseFraction: stats(population.map(sample => sample.baseFraction)),
        securityFraction: stats(population.map(sample => sample.securityFraction)), queryCount: sum(population.map(sample => sample.baseQueries + sample.securityQueries)) };
    }
    const pairs = result.pairs.filter(pair => pair.revision === revision);
    result.revisions.push({ revision, status: m.status, totalCalls: samples.length, phases, arms,
      pairP50ChangeMs: stats(pairs.map(pair => pair.bMinusAMs.p50)), pairP95ChangeMs: stats(pairs.map(pair => pair.bMinusAMs.p95)),
      pairP50ChangePercent: stats(pairs.map(pair => pair.bRelativeChangePercent.p50)), pairP95ChangePercent: stats(pairs.map(pair => pair.bRelativeChangePercent.p95)),
      pairsBFasterAtP50: pairs.filter(pair => pair.bMinusAMs.p50 < 0).length,
      pairsBFasterAtP95: pairs.filter(pair => pair.bMinusAMs.p95 < 0).length,
      totalDurationMs: m.totalDurationMs });
  }
  check(result.samples.filter(x => x.phase === 'measured').length === 2400 && result.samples.filter(x => x.phase === 'warmup').length === 240, 'METADATA_TOTAL_COUNTS_INVALID');
  return result;
}


function validEvent(event) { return nonnegative(event?.startMs) && finite(event?.endMs) && event.endMs >= event.startMs; }
function requestCost(row, replica) {
  const record = row.metrics, events = list(record?.queryEvents), spans = list(record?.spans), checkouts = list(record?.checkouts), admissions = list(record?.admissions), locks = list(record?.lockEvents);
  const context = { replica, scenario: row.scenario, attempt: row.attempt, tenant: row.tenant };
  const complete = Boolean(record && record.queryCount > 0 && record.queryCount === events.length && record.pendingQueries === 0 &&
    events.every(event => validEvent(event) && HASH.test(event.hash || '') && typeof event.role === 'string' && typeof event.category === 'string') && spans.length && spans.every(validEvent) && checkouts.length &&
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

function csv(rows) {
  const fields = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('_'))))];
  const encode = value => { const raw = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return /[",\r\n]/.test(raw) ? '"' + raw.replaceAll('"', '""') + '"' : raw; };
  return fields.map(encode).join(',') + '\r\n' + rows.map(row => fields.map(field => encode(row[field])).join(',')).join('\r\n') + '\r\n';
}

const HASH = /^[a-f0-9]{64}$/;
const EXPECTED_DRIFT = ['table-structure', 'public-table', 'third-party-table', 'public-column', 'third-party-column',
  'foreign-table', 'foreign-column-table', 'foreign-column-view', 'foreign-function', 'owned-function', 'foreign-schema',
  'owned-schema', 'owned-null-acl', 'owned-empty-acl', 'owned-sequence', 'membership', 'role-attribute', 'multiple-grantors',
  'not-null-canonical', 'not-null-quoted', 'not-null-no-inherit', 'not-null-not-valid'];
function read(file) {
  const actual = fs.realpathSync(file), bytes = fs.readFileSync(actual);
  return { path: actual, sha256: sha(bytes), bytes: bytes.length, data: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
}
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
function evidencePath(file, identity) {
  const base = fs.realpathSync(path.join(identity.bundleRoot, 'evidence'));
  const actual = fs.realpathSync(path.resolve(identity.bundleRoot, file));
  if (!contained(identity.bundleRoot, base) || !contained(base, actual) || !fs.statSync(actual).isFile()) throw new Error('ANALYSIS_EVIDENCE_PATH_ESCAPE');
  return actual;
}
function evidence(file, identity) { return read(evidencePath(file,identity)); }
function stagePlan(mode) {
  const metadata = ['043', '042'].map(revision => ({ revision, arm: 'AB', kind: mode === 'readiness' ? 'equivalence' : 'metadata' }));
  if (mode === 'measure-metadata') return metadata;
  if (mode === 'readiness') return [...metadata, { revision: '043', arm: 'A', kind: 'http-readiness' }, { revision: '043', arm: 'B', kind: 'http-readiness' }];
  return [['A','B'],['B','A'],['A','B'],['B','A']].flatMap((order, pairIndex) => order.map(arm => ({ revision: '043', arm, kind: 'http', pairIndex })));
}
function identityFields(identity) {
  return { abId: identity.id, sourceSetDigest: identity.sourceSetDigest, manifestSha256: identity.manifestSha256,
    harnessDigest: identity.harnessDigest, variantDigests: { A: identity.variants.A.sourceSetDigest, B: identity.variants.B.sourceSetDigest } };
}
function validateReport(input, mode, identity, { continuation = false } = {}) {
  const extension = mode === 'measure-http-continuation', childMode = extension ? 'measure-http' : mode;
  const report = input.data, context = { mode }, measured = mode !== 'readiness', plan = stagePlan(childMode);
  const partial = continuation && mode === 'measure-http';
  const expectedIndices = extension ? [5,6,7] : partial ? [0,1,2,3,4] : plan.map((_,index) => index);
  check(report.mode === mode && report.status === (extension || partial ? 'FAIL' : 'PASS'), 'REPORT_SCOPE_OR_STATUS_INVALID', context);
  protocolCheck(report.status === 'PASS', 'CAMPAIGN_EXECUTION_FAILED', context);
  check(report.performanceMeasurement === measured && report.habitualEnvironmentAccess === false, 'EXECUTION_SCOPE_INVALID', context);
  check(report.cleanup === true && report.sourceIntegrityAfter === 'PASS', 'REPORT_CLEANUP_OR_INTEGRITY_INVALID', context);
  check(Number.isFinite(Date.parse(report.startedAt)) && Date.parse(report.finishedAt) >= Date.parse(report.startedAt), 'REPORT_TIMESTAMPS_INVALID', context);
  for (const [key, value] of Object.entries(identityFields(identity))) check(isDeepStrictEqual(report[key], value), 'REPORT_IDENTITY_MISMATCH', { ...context, key });
  check(report.seedDigest === identity.protocol.seedDigest && isDeepStrictEqual(report.images, identity.protocol.images), 'REPORT_SEED_OR_IMAGES_MISMATCH', context);
  check(isDeepStrictEqual(list(report.stages).map(x => x.index), expectedIndices), 'STAGE_INDICES_INVALID', context);
  const childInputs = [];
  for (const stage of list(report.stages)) {
    const index = stage.index;
    const expected = plan[index], child = stage.result || {}, at = { mode, index };
    check(Boolean(expected), 'UNEXPECTED_STAGE', at);
    if (expected) for (const [key, value] of Object.entries({ ...expected, index }))
      check(stage[key] === value && child[key] === value, 'STAGE_OR_CHILD_IDENTITY_MISMATCH', { ...at, key });
    const expectedStatus = partial && index === 4 ? 'FAIL' : 'PASS';
    check(stage.status === expectedStatus && child.status === expectedStatus && child.mode === childMode && child.performanceMeasurement === measured, 'CHILD_SCOPE_OR_STATUS_INVALID', at);
    protocolCheck(stage.status === 'PASS' && child.status === 'PASS', 'HTTP_STAGE_EXECUTION_FAILED', at);
    check(stage.cleanup?.status === 'PASS' && child.cleanup === true && child.sourceIntegrityAfter === 'PASS' && stage.childCleanup?.exitVerified === true, 'CHILD_CLEANUP_OR_INTEGRITY_INVALID', at);
    const resources = list(stage.resources), cleaned = list(stage.cleanup?.resources);
    check(resources.length === 2 && new Set(resources.map(x => x.id)).size === 2 && cleaned.length === 2 &&
      resources.every(resource => cleaned.some(row => row.id === resource.id && row.name === resource.name && row.removed === true)), 'RESOURCE_CLEANUP_INCOMPLETE', at);
    for (const [key, value] of Object.entries(identityFields(identity))) check(isDeepStrictEqual(child[key], value), 'CHILD_BINDING_MISMATCH', { ...at, key });
    check(child.seedDigest === identity.protocol.seedDigest && isDeepStrictEqual(stage.environment?.images, identity.protocol.images), 'CHILD_SEED_OR_IMAGES_MISMATCH', at);
    check(stage.environment?.network === 'LOOPBACK_ONLY' && stage.environment?.setupControlBudgetMs === 300000 && stage.environment?.cleanupControlBudgetMs === 120000, 'CHILD_ENVIRONMENT_INVALID', at);
    try {
      if (!HASH.test(stage.evidence?.sha256 || '') || typeof stage.evidence?.path !== 'string') throw new Error('CHILD_EVIDENCE_MISSING');
      const actual = evidence(stage.evidence.path, identity);
      check(actual.sha256 === stage.evidence.sha256 && isDeepStrictEqual(actual.data, child), 'CHILD_EVIDENCE_MISMATCH', at);
      childInputs.push({ path: actual.path, sha256: actual.sha256, bytes: actual.bytes });
    } catch { check(false, 'CHILD_EVIDENCE_UNREADABLE_OR_OUTSIDE_BUNDLE', at); }
  }
  return { path: input.path, sha256: input.sha256, bytes: input.bytes, mode, runId: report.runId, status: report.status,
    startedAt: report.startedAt, finishedAt: report.finishedAt, environment: report.environment, childInputs };
}
function validateContinuation(input, original, ready, identity) {
  const report = input.data;
  check(identity.id === 'central-snapshot-ab-58f2f8910abee80f' && original.data.runId === 'bfd7495e00394b85821c568571e26908' && ready.data.runId === '6858547a52ed431d8718719bbd1ed9fe', 'CONTINUATION_CONTRACT_IDENTITY_INVALID');
  check(report.campaignStatus === 'FAIL' && report.campaignCompleteness === 'INCOMPLETE' && report.continuationStatus === 'COMPLETED', 'CONTINUATION_COMPLETION_INVALID');
  check(Date.parse(original.data.finishedAt) <= Date.parse(report.startedAt), 'CONTINUATION_EXECUTION_OVERLAP');
  for (const [key,target] of [['sourceParent',original],['readiness',ready]]) {
    try {
      const actualPath = evidencePath(report[key]?.path,identity);
      check(actualPath === target.path && report[key]?.sha256 === target.sha256, 'CONTINUATION_INPUT_PIN_MISMATCH', { key });
    } catch { check(false,'CONTINUATION_INPUT_UNREADABLE',{key}); }
  }
  let orchestrator;
  try {
    const target = fs.realpathSync(path.resolve(identity.bundleRoot,report.orchestrator?.path));
    const evidenceRoot = fs.realpathSync(path.join(identity.bundleRoot,'evidence'));
    check(contained(evidenceRoot,target) && HASH.test(report.orchestrator?.sha256 || '') && sha(fs.readFileSync(target)) === report.orchestrator.sha256, 'CONTINUATION_ORCHESTRATOR_PIN_INVALID');
    orchestrator = {path:target,sha256:report.orchestrator?.sha256};
  } catch { check(false,'CONTINUATION_ORCHESTRATOR_UNREADABLE'); }
  check(report.httpCounts?.attempts === 108 && report.httpCounts?.warmups === 21, 'CONTINUATION_POPULATION_INVALID');
  return orchestrator;
}
function validateHttpReadiness(value, context, seedDigest) {
  const r = value || {};
  check(r.status === 'PASS' && r.performanceMeasurement === false && r.seedDigest === seedDigest, 'HTTP_READINESS_STATUS_INVALID', context);
  check(r.databaseIsolation?.verified === true && r.drained?.active === 0 && r.drained?.queued === 0, 'HTTP_READINESS_ISOLATION_OR_DRAIN_INVALID', context);
  check(r.writer?.state === 'QUIESCED' && r.writer.pending === 0 && r.writer.runtimeEnabled === false, 'HTTP_READINESS_WRITER_NOT_IDLE', context);
  check(r.schemas?.central === '043_opportunity_eu_writer_v2' && isDeepStrictEqual(r.schemas?.tenants, ['034_application_snapshot_v2','034_application_snapshot_v2']), 'HTTP_READINESS_SCHEMA_INVALID', context);
  const responses = list(r.responses), refusals = list(r.refusals);
  check(responses.length === 8 && refusals.length === 9, 'HTTP_READINESS_COUNTS_INVALID', context);
  for (const tenant of [0, 1]) for (const kind of ['report','private','dashboard','report-page-2']) {
    const rows = responses.filter(row => row.tenant === tenant && row.kind === kind);
    check(rows.length === 1 && rows[0].status === 200 && rows[0].metricsComplete === true && HASH.test(rows[0].responseDigest || ''), 'HTTP_READINESS_RESPONSE_INVALID', { ...context, tenant, kind });
  }
  for (const tenant of [0, 1]) for (const kind of ['tampered-report-cursor','cross-dashboard','cross-private']) {
    const rows = refusals.filter(row => row.tenant === tenant && row.kind === kind);
    check(rows.length === 1 && (kind === 'tampered-report-cursor' ? rows[0].status === 400 && rows[0].code === 'INVALID_CURSOR' : [403,404].includes(rows[0].status)), 'HTTP_READINESS_REFUSAL_INVALID', { ...context, tenant, kind });
  }
  for (const kind of ['anonymous-dashboard','anonymous-report','anonymous-private']) {
    const rows = refusals.filter(row => row.kind === kind);
    check(rows.length === 1 && rows[0].status === 401, 'HTTP_READINESS_ANONYMOUS_INVALID', { ...context, kind });
  }
}
function readinessAnalysis(report, identity) {
  const revisions = [], sqlHashes = {}, plans = [];
  const equal = value => value?.equal === true && HASH.test(value.sha256 || '') && Number.isInteger(value.bytes) && value.bytes > 0;
  for (const stage of list(report.stages)) {
    if (stage.kind === 'http-readiness') { validateHttpReadiness(stage.result?.httpReadiness, { arm: stage.arm, readiness: true }, identity.protocol.seedDigest); continue; }
    const r = stage.result?.equivalence || {}, revision = stage.revision, context = { revision, readiness: true };
    check(r.status === 'PASS' && r.revision?.startsWith(revision + '_'), 'EQUIVALENCE_STATUS_INVALID', context);
    check(list(r.baseline).length === 2 && r.baseline.every(equal) && equal(r.finalBaseline) && r.baseline.every(x => x.sha256 === r.finalBaseline.sha256), 'EQUIVALENCE_BASELINE_INVALID', context);
    const cases = list(r.transactional);
    check(cases.length === EXPECTED_DRIFT.length && new Set(cases.map(x => x.case)).size === cases.length && EXPECTED_DRIFT.every(name => cases.some(x => x.case === name)), 'EQUIVALENCE_CASES_MISSING_OR_DUPLICATED', context);
    for (const row of cases) {
      const at = { ...context, case: row.case }, unsupported = ['not-null-quoted','not-null-no-inherit','not-null-not-valid'].includes(row.case);
      check(row.status === 'PASS' && row.restored === true && equal(row.security), 'EQUIVALENCE_CASE_INCOMPLETE', at);
      check(unsupported ? row.schemaRefusal === 'UNSUPPORTED_NOT_NULL_CONSTRAINT' : equal(row.schema), 'EQUIVALENCE_SCHEMA_PARITY_INVALID', at);
      check(row.case === 'owned-empty-acl' ? row.guard === 'UNCHANGED_EXISTING_CONTRACT' : ['CENTRAL_SCHEMA_DRIFT','AUTHORITY_SECURITY_DRIFT','UNSUPPORTED_NOT_NULL_CONSTRAINT'].includes(row.guard), 'EQUIVALENCE_GUARD_INVALID', at);
      if (['owned-null-acl','owned-empty-acl','multiple-grantors'].includes(row.case)) check(row.catalogStateConfirmed === true, 'EQUIVALENCE_EDGE_CASE_UNCONFIRMED', at);
      if (row.case === 'multiple-grantors') check(row.duplicateGrantorsPreserved === true, 'EQUIVALENCE_GRANTOR_MULTIPLICITY_LOST', at);
    }
    check(list(r.postLockProofs).length === 2 && new Set(list(r.postLockProofs).map(x => x.arm)).size === 2, 'POST_LOCK_ARMS_MISSING', context);
    for (const arm of ['A','B']) {
      const p = list(r.postLockProofs).find(x => x.arm === arm)?.proof || {}, at = { ...context, arm };
      check(p.status === 'PASS' && p.revision === r.revision && p.collector === 'ACTUAL_AGGREGATE_WITH_SECURITY_READS' && Array.isArray(p.cleanupErrors) && p.cleanupErrors.length === 0, 'POST_LOCK_PROOF_FAILED', at);
      const expected = ['table-structure','authority-table-acl','catalog-table-acl', ...(revision === '043' ? ['writer-helper-definition','writer-helper-public-execute'] : [])];
      check(list(p.transactional).length === expected.length && expected.every(name => p.transactional.some(x => x.case === name && x.restored === true && x.rejected === true)), 'POST_LOCK_PRELIMINARY_DRIFT_INCOMPLETE', at);
      check(list(p.postLock).length === 2 && ['authority-table-acl','authority-role-attribute'].every(name => p.postLock.some(x => x.case === name && x.mutationAfterPreflight === true && x.realBlockedAuthorityTransactions === 1 && x.functionalCallbackExecuted === false && x.rejected === 'AUTHORITY_SECURITY_DRIFT' && x.restored === true)), 'POST_LOCK_REJECTION_INCOMPLETE', at);
    }
    const rawPlans = list(r.plans); check(rawPlans.length === 4, 'SQL_PLAN_SET_INVALID', context); sqlHashes[revision] = {};
    for (const arm of ['A','B']) {
      sqlHashes[revision][arm] = {};
      for (const kind of ['central','security']) {
        const rows = rawPlans.filter(x => x.arm === arm && x.kind === kind), value = rows[0], plan = value?.plan?.[0];
        check(rows.length === 1 && HASH.test(value?.sqlSha256 || '') && nonnegative(plan?.['Execution Time']) && nonnegative(plan?.['Planning Time']), 'SQL_PLAN_INVALID', { ...context, arm, kind });
        sqlHashes[revision][arm][kind] = value?.sqlSha256 ?? null;
        plans.push({ revision, arm, kind, sqlSha256: value?.sqlSha256, planningMs: plan?.['Planning Time'], executionMs: plan?.['Execution Time'], profilingOutsideMeasurement: true });
      }
    }
    revisions.push({ revision, status: r.status, cases: cases.map(x => ({ case: x.case, guard: x.guard, status: x.status, restored: x.restored })),
      baseline: r.baseline, finalBaseline: r.finalBaseline, postLockProofs: r.postLockProofs });
  }
  return { revisions, sqlHashes, plans };
}

function effects(a, b) {
  const difference = {}, relativeChangePercent = {};
  for (const key of ['p50','p95','maximum','mean']) {
    difference[key] = finite(a?.[key]) && finite(b?.[key]) ? b[key] - a[key] : null;
    relativeChangePercent[key] = finite(a?.[key]) && finite(b?.[key]) && a[key] > 0 ? (b[key] / a[key] - 1) * 100 : null;
  }
  return { bMinusAMs: difference, bRelativeChangePercent: relativeChangePercent };
}
function optimizedQueryCost(row, hashes) {
  if (!row.completeMetrics) return {};
  const base = row._events.filter(q => q.hash === hashes?.central), security = row._events.filter(q => q.hash === hashes?.security), both = [...base,...security];
  check(base.length > 0 && security.length > 0, 'HTTP_OPTIMIZED_QUERY_EVIDENCE_MISSING', { arm: row.arm, index: row.replica, scenario: row.scenario, attempt: row.attempt });
  return { centralBaseQueryCount: base.length, authoritySecurityQueryCount: security.length,
    centralCheckpointCount: row._spans.filter(span => ['assertCentralSchema','assertCentralSchemaForVersions'].includes(span.name)).length,
    tenantMetadataCheckpointCount: row._spans.filter(span => span.name === 'observeTenantRuntimeMetadata').length,
    centralBaseUnionMs: union(intervals(base)), authoritySecurityUnionMs: union(intervals(security)), optimizedSqlUnionMs: union(intervals(both)),
    optimizedSqlUnionToHttpRatio: ratio(union(intervals(both)), row.ms),
    centralBaseToHttpRatio: ratio(union(intervals(base)), row.ms), authoritySecurityToHttpRatio: ratio(union(intervals(security)), row.ms) };
}
const OPTIMIZED_FIELDS = ['centralBaseQueryCount','authoritySecurityQueryCount','centralCheckpointCount','tenantMetadataCheckpointCount','centralBaseUnionMs','authoritySecurityUnionMs',
  'optimizedSqlUnionMs','optimizedSqlUnionToHttpRatio','centralBaseToHttpRatio','authoritySecurityToHttpRatio'];
function checkpointCounts(row) {
  // Exact A workload counts: neither candidate SQL may remove a collection or
  // security checkpoint. The matrix, source tree and API business seed are fixed.
  const report = row.scenario?.startsWith('report-');
  const expected = { queryCount: report ? 1195 : 2841, transactionCount: report ? 52 : 113,
    centralBaseQueryCount: report ? 25 : 53, authoritySecurityQueryCount: report ? 50 : 106,
    centralCheckpointCount: report ? 25 : 53, tenantMetadataCheckpointCount: report ? 3 : 9 };
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key,row[key] ?? null]));
  const valid = SCENARIOS.some(value => value.id === row.scenario) && row.completeMetrics === true &&
    Object.entries(expected).every(([key,value]) => actual[key] === value);
  check(valid, 'HTTP_SQL_OR_CHECKPOINT_COUNT_CHANGED', { scenario:row.scenario, arm:row.arm, pair:row.pair, index:row.index, attempt:row.attempt, expected, actual });
  return { valid, expected, actual };
}
function population(rows) {
  return { ...httpPopulation(rows), optimizedSqlPerRequest: Object.fromEntries(OPTIMIZED_FIELDS.map(key => [key, stats(rows.map(row => row[key]))])), ...otherCosts(rows) };
}
function matchScenarioPairs(rows, scenario, {interruptedPairs=[]}={}) {
  const pairs = Array.from({length:4},(_,pair)=>{
    const a=rows.filter(row=>row.pair===pair&&row.arm==='A'),b=rows.filter(row=>row.pair===pair&&row.arm==='B');
    const successful=group=>exactIndices(group,scenario.attempts,'attempt')&&group.every(row=>row.status===200&&row.functionalPass===true&&row.normalizedResponsePass===true&&row.completeMetrics===true&&row.checkpointCountsPass===true);
    return {pair,complete:successful(a)&&successful(b),continuity:interruptedPairs.includes(pair)?'INTERRUPTED_BY_OPERATIONAL_GAP':'SEQUENTIAL_WITHIN_EXECUTION',recordedA:a.length,recordedB:b.length,missingA:Math.max(0,scenario.attempts-a.length),missingB:Math.max(0,scenario.attempts-b.length)};
  });
  const complete=new Set(pairs.filter(pair=>pair.complete).map(pair=>pair.pair));
  return {pairs,matched:rows.filter(row=>complete.has(row.pair)),unpaired:rows.filter(row=>!complete.has(row.pair)),uninterrupted:rows.filter(row=>complete.has(row.pair)&&!interruptedPairs.includes(row.pair))};
}
function validationStatus(values) {
  const dataIssues=values.filter(issue=>issue.classification==='DATA_QUALITY'),protocolIssues=values.filter(issue=>issue.classification==='PROTOCOL');
  const dataStatus=dataIssues.length?'DATA_INVALID_OR_INCOMPLETE':'DATA_PASS',protocolStatus=protocolIssues.length||dataIssues.length?'FAIL':'PASS';
  return {dataIssues,protocolIssues,dataStatus,protocolStatus,status:dataIssues.length?'INVALID_OR_INCOMPLETE':protocolStatus==='FAIL'?'DATA_PASS_PROTOCOL_FAIL':'VALID'};
}
function expectedContinuationIssue(issue) {
  if(issue.code==='CAMPAIGN_EXECUTION_FAILED')return ['measure-http','measure-http-continuation'].includes(issue.mode);
  if(issue.code==='HTTP_PROTOCOL_NOT_SATISFIED')return true;
  if(issue.index!==4)return false;
  if(['HTTP_STAGE_EXECUTION_FAILED','HTTP_WORKLOAD_FAILED'].includes(issue.code))return true;
  if(issue.code==='HTTP_PLANNED_STAGE_POPULATION_INCOMPLETE')return issue.measured===28&&issue.warmups===6;
  return issue.code==='HTTP_SCENARIO_PLAN_NOT_COMPLETED'&&issue.scenario==='dashboard-c4-two-tenants'&&issue.actualAttempts===0&&issue.actualWarmups===1;
}
function httpAnalysis(report, proof, identity, continuation = null) {
  const rows = [], warmups = [], scenarios = [], countInvariance = [], stages = [...list(report.stages),...list(continuation?.stages)];
  check(exactIndices(stages, 8, 'index'), 'HTTP_STAGE_COUNT_INVALID');
  for (const stage of stages) {
    const http = stage.result?.http || {}, index = stage.index, arm = stage.arm, pair = stage.pairIndex, context = { index, arm, pair };
    const interrupted = Boolean(continuation && index === 4);
    check(http.status === (interrupted ? 'FAIL' : 'PASS') && http.replica === index, 'HTTP_STAGE_STATUS_INVALID', context);
    protocolCheck(http.status === 'PASS','HTTP_WORKLOAD_FAILED',context);
    validateHttpReadiness(stage.result?.httpReadiness, context, identity.protocol.seedDigest);
    const attempts = list(http.attempts), warm = list(http.warmups);
    check(attempts.length === (interrupted ? 28 : 36) && warm.length === (interrupted ? 6 : 7) && list(http.scenarios).length === 6, 'HTTP_STAGE_POPULATION_INVALID', context);
    protocolCheck(attempts.length === 36 && warm.length === 7, 'HTTP_PLANNED_STAGE_POPULATION_INCOMPLETE', { ...context,measured:attempts.length,warmups:warm.length });
    for (const scenario of SCENARIOS) {
      const values = attempts.filter(row => row.scenario === scenario.id), pre = warm.filter(row => row.scenario === scenario.id), at = { ...context, scenario: scenario.id };
      const stopped = interrupted && scenario.id === 'dashboard-c4-two-tenants';
      check(exactIndices(values, stopped ? 0 : scenario.attempts, 'attempt') && values.every(row => row.replica === index && row.tenant === row.attempt % scenario.tenants), 'HTTP_SCENARIO_POPULATION_INVALID', at);
      check(exactIndices(pre, stopped ? 1 : scenario.tenants, 'tenant') && pre.every(row => row.status === (stopped ? 503 : 200) && row.replica === index && nonnegative(row.ms) && HASH.test(row.responseDigest || '')), 'HTTP_WARMUP_INVALID', at);
      if (stopped) check(pre[0]?.code === 'SERVICE_UNAVAILABLE' && list(pre[0]?.metrics?.admissions).some(entry => entry.error === 'LEASE_TIMEOUT'), 'EXPECTED_WARMUP_FAILURE_EVIDENCE_MISMATCH', at);
      protocolCheck(values.length === scenario.attempts && pre.length === scenario.tenants && pre.every(row => row.status === 200), 'HTTP_SCENARIO_PLAN_NOT_COMPLETED', { ...at,plannedAttempts:scenario.attempts,actualAttempts:values.length,plannedWarmups:scenario.tenants,actualWarmups:pre.length });
      for (const row of values) check(row.responseDigest === pre.find(value => value.tenant === row.tenant)?.responseDigest, 'HTTP_WARMUP_DIGEST_MISMATCH', { ...at, attempt: row.attempt });
      const supplied = list(http.scenarios).filter(value => value.id === scenario.id), s = supplied[0] || {}, good = values.filter(row => row.status === 200), computed = stats(good.map(row => row.ms)), all = stats(values.map(row => row.ms));
      if (stopped) check(supplied.length === 1 && s.status === 'FAIL' && s.replica === index && s.attempts === 0, 'INTERRUPTED_SCENARIO_EVIDENCE_INVALID', at);
      else {
        check(supplied.length === 1 && s.status === 'PASS' && s.replica === index && s.controlBudgetMs === 180000 && nonnegative(s.controlElapsedMs) && s.controlElapsedMs <= 180000 && nonnegative(s.drainMs) && s.drainMs <= 30000, 'HTTP_SCENARIO_BUDGET_OR_DRAIN_INVALID', at);
        check(s.attempts === values.length && s.successes === good.length && s.errors === values.length - good.length && s.timeouts === values.filter(x => x.code === 'HTTP_TIMEOUT').length && s.http503 === values.filter(x => x.status === 503).length && s.p50Ms === computed.p50 && s.p95Ms === computed.p95 && s.maximumMs === computed.maximum && s.allAttemptP50Ms === all.p50 && s.allAttemptP95Ms === all.p95, 'HTTP_REPORTED_SCENARIO_MISMATCH', at);
      }
      scenarios.push({ index, pair, arm, scenario: scenario.id, concurrency: scenario.concurrency, participatingTenants: scenario.tenants, plannedAttempts:scenario.attempts,missingAttempts:scenario.attempts-values.length, ...s });
    }
    for (const raw of attempts) {
      const row = { arm, pair, index, ...requestCost(raw, index) };
      Object.assign(row, optimizedQueryCost(row, proof.sqlHashes['043']?.[arm]));
      row.checkpointCountsPass = checkpointCounts(row).valid;
      if (row.completeMetrics) for (const [emitted, computed] of [['queryObservedWorkMs','queryObservedWorkMs'],['queryWallUnionMs','queryUnionMs'],['centralMetadataWallMs','centralMetadataMs'],['tenantMetadataWallMs','tenantMetadataMs'],['afterResponseQueries','queryCompletedAfterResponse'],['authorityLockHeldMs','authorityLockHeldUnionMs']]) {
        check(finite(raw.metricSummary?.[emitted]) && Math.abs(raw.metricSummary[emitted] - row[computed]) < .00001, 'HTTP_REPORTED_METRIC_MISMATCH', { ...context, scenario: row.scenario, attempt: row.attempt, field: emitted });
      }
      rows.push(row);
    }
    warmups.push(...warm.map(row => ({ arm, pair, index, scenario: row.scenario, tenant: row.tenant, ms: row.ms, status: row.status, code:row.code,
      responseDigest: row.responseDigest,queryCount:row.metrics?.queryCount??null,pendingQueries:row.metrics?.pendingQueries??null,
      admissionErrors:list(row.metrics?.admissions).map(entry=>entry.error).filter(Boolean),sqlErrors:row.metrics?.sqlErrors??null,failures:row.metrics?.failures??null })));
    if (!interrupted) check(nonnegative(stage.result?.drainMs) && stage.result.drainMs <= 30000, 'HTTP_FINAL_DRAIN_INVALID', context);
  }
  check(rows.length === (continuation ? 280 : 288) && warmups.length === (continuation ? 55 : 56), 'HTTP_TOTAL_COUNTS_INVALID');
  if (!continuation) check(report.httpCounts?.attempts === 288 && report.httpCounts?.warmups === 56, 'HTTP_REPORTED_COUNTS_INVALID');
  else check(warmups.filter(row=>row.status!==200).length===1 && warmups.filter(row=>row.status!==200).every(row=>row.index===4&&row.scenario==='dashboard-c4-two-tenants'&&row.tenant===0), 'UNEXPECTED_ADDITIONAL_WARMUP_FAILURE');
  protocolCheck(rows.length===288&&warmups.length===56&&warmups.every(row=>row.status===200),'HTTP_PROTOCOL_NOT_SATISFIED');
  const populations = [], pairs = [], comparisons = [], uninterruptedComparisons = [], costs = [];
  for (const scenario of SCENARIOS) {
    const all = rows.filter(row => row.scenario === scenario.id), byArm = {}, matches=matchScenarioPairs(all,scenario,{interruptedPairs:continuation?[2]:[]});
    for(const row of all){const pair=matches.pairs.find(pair=>pair.pair===row.pair);row.pairComplete=pair.complete;row.pairContinuity=pair.continuity;row.uninterruptedPairEligible=pair.complete&&pair.continuity==='SEQUENTIAL_WITHIN_EXECUTION';row.comparisonPopulation=row.pairComplete?'MATCHED_PAIR':'UNPAIRED';}
    for (const arm of ['A','B']) {
      const group = all.filter(row => row.arm === arm); byArm[arm] = population(group);
      const missing=continuation&&scenario.id==='dashboard-c4-two-tenants'&&arm==='A'?8:0;
      check(group.length === 4 * scenario.attempts-missing, 'HTTP_ARM_POPULATION_INVALID', { arm, scenario: scenario.id });
      const counts = checkpointCounts({ ...group[0], scenario:scenario.id, arm });
      countInvariance.push({ scenario:scenario.id, arm, requests:group.length, valid:group.every(row => row.checkpointCountsPass === true), expected:counts.expected,
        observed:Object.fromEntries(Object.keys(counts.expected).map(key => [key,stats(group.map(row => row[key]))])) });
      populations.push({ scenario: scenario.id, arm, pair: 'ALL', tenant: 'ALL', population:'ALL_OBSERVED', ...byArm[arm] });
      populations.push({scenario:scenario.id,arm,pair:'MATCHED',tenant:'ALL',population:'MATCHED_PAIRS',...population(matches.matched.filter(row=>row.arm===arm))});
      populations.push({scenario:scenario.id,arm,pair:'UNINTERRUPTED',tenant:'ALL',population:'UNINTERRUPTED_MATCHED_PAIRS',...population(matches.uninterrupted.filter(row=>row.arm===arm))});
      if(matches.unpaired.some(row=>row.arm===arm))populations.push({scenario:scenario.id,arm,pair:'UNPAIRED',tenant:'ALL',population:'UNPAIRED',...population(matches.unpaired.filter(row=>row.arm===arm))});
      for (let pair = 0; pair < 4; pair++) populations.push({ scenario: scenario.id, arm, pair, tenant: 'ALL', population:'PAIR_ARM',pairComplete:matches.pairs[pair].complete, ...population(group.filter(row => row.pair === pair)) });
      if (scenario.tenants > 1) for (const tenant of [0,1]) populations.push({ scenario: scenario.id, arm, pair: 'ALL', tenant,population:'ALL_OBSERVED', ...population(group.filter(row => row.tenant === tenant)) });
      for (const [kind,key] of [['category',q => q.category],['role',q => q.role],['roleCategory',q => q.role + ':' + q.category],['hash',q => q.role + ':' + q.category + ':' + q.hash]])
        { costs.push(...queryGroups(group, kind, key).map(value => ({ scenario: scenario.id, arm,population:'ALL_OBSERVED', ...value })));
          if(matches.unpaired.length)costs.push(...queryGroups(matches.matched.filter(row=>row.arm===arm),kind,key).map(value=>({scenario:scenario.id,arm,population:'MATCHED_PAIRS',...value}))); }
    }
    for (const tenant of Array.from({length: scenario.tenants}, (_, n) => n)) {
      const digests = new Set(all.filter(row => row.tenant === tenant).map(row => row.responseDigest));
      check(digests.size === 1, 'HTTP_CROSS_ARM_OR_PAIR_RESPONSE_MISMATCH', { scenario: scenario.id, tenant });
    }
    for (let pair = 0; pair < 4; pair++) {
      const group = all.filter(row => row.pair === pair), a = population(group.filter(row => row.arm === 'A')), b = population(group.filter(row => row.arm === 'B'));
      const order = stages.filter(stage => stage.pairIndex === pair).map(stage => stage.arm);
      check(isDeepStrictEqual(order, pair % 2 ? ['B','A'] : ['A','B']), 'HTTP_PAIR_ORDER_INVALID', { pair, scenario: scenario.id });
      const completeness=matches.pairs[pair];
      pairs.push({ scenario: scenario.id, pair, order,...completeness, A:a.successLatencyMs,B:b.successLatencyMs,
        ...(completeness.complete?effects(a.successLatencyMs,b.successLatencyMs):{bMinusAMs:null,bRelativeChangePercent:null}),
        perRequestEffects: completeness.complete?Object.fromEntries(['queryUnionMs','metadataUnionMs','authorityLockAcquisitionObservedMs','authorityLockHeldUnionMs','checkoutWaitSumMs','managerAcquireSumMs'].map(key => [key,effects(a.perRequest[key],b.perRequest[key])])):null });
    }
    const selected = pairs.filter(row => row.scenario === scenario.id&&row.complete), matchedA=stats(matches.matched.filter(row=>row.arm==='A').map(row=>row.ms)),matchedB=stats(matches.matched.filter(row=>row.arm==='B').map(row=>row.ms));
    check(selected.length===(continuation&&scenario.id==='dashboard-c4-two-tenants'?3:4),'HTTP_MATCHED_PAIR_COUNT_INVALID',{scenario:scenario.id});
    comparisons.push({ scenario: scenario.id, concurrency: scenario.concurrency, tenants: scenario.tenants, matchedPairCount:selected.length,
      allObserved:{A:byArm.A.successLatencyMs,B:byArm.B.successLatencyMs},matched:{A:matchedA,B:matchedB,effect:effects(matchedA,matchedB)},
      unpaired:{A:stats(matches.unpaired.filter(row=>row.arm==='A').map(row=>row.ms)),B:stats(matches.unpaired.filter(row=>row.arm==='B').map(row=>row.ms))},
      pairedP50ChangeMs: stats(selected.map(x => x.bMinusAMs.p50)), pairedP95ChangeMs: stats(selected.map(x => x.bMinusAMs.p95)),
      pairedP50ChangePercent: stats(selected.map(x => x.bRelativeChangePercent.p50)), pairedP95ChangePercent: stats(selected.map(x => x.bRelativeChangePercent.p95)),
      pairsBFasterAtP50: selected.filter(x => x.bMinusAMs.p50 < 0).length, pairsBFasterAtP95: selected.filter(x => x.bMinusAMs.p95 < 0).length });
    const uninterrupted=selected.filter(pair=>pair.continuity==='SEQUENTIAL_WITHIN_EXECUTION'),uninterruptedA=stats(matches.uninterrupted.filter(row=>row.arm==='A').map(row=>row.ms)),uninterruptedB=stats(matches.uninterrupted.filter(row=>row.arm==='B').map(row=>row.ms));
    check(isDeepStrictEqual(uninterrupted.map(pair=>pair.pair),continuation?[0,1,3]:[0,1,2,3]),'HTTP_UNINTERRUPTED_PAIR_SET_INCOMPLETE',{scenario:scenario.id});
    uninterruptedComparisons.push({scenario:scenario.id,population:'UNINTERRUPTED_MATCHED_PAIRS',pairIndices:uninterrupted.map(pair=>pair.pair),pairCount:uninterrupted.length,
      A:uninterruptedA,B:uninterruptedB,effect:effects(uninterruptedA,uninterruptedB),
      pairedP50ChangeMs:stats(uninterrupted.map(pair=>pair.bMinusAMs.p50)),pairedP95ChangeMs:stats(uninterrupted.map(pair=>pair.bMinusAMs.p95)),
      pairedP50ChangePercent:stats(uninterrupted.map(pair=>pair.bRelativeChangePercent.p50)),pairedP95ChangePercent:stats(uninterrupted.map(pair=>pair.bRelativeChangePercent.p95))});
  }
  const sampler = samplerAnalysis(stages);
  for (const row of [...sampler.rows,...sampler.phases]) { const stage = stages.find(stage => stage.index === row.replica); row.arm = stage?.arm; row.pair = stage?.pairIndex; }
  return { totals: { ...httpPopulation(rows), interpretation: 'MIXED_SCENARIOS_FOR_COMPLETENESS_ONLY',plannedMeasured:288,recordedMeasured:rows.length,missingMeasured:288-rows.length,
    plannedWarmups:56,recordedWarmups:warmups.length,missingWarmups:56-warmups.length,warmupFailures:warmups.filter(row=>row.status!==200),
    matchedMeasured:rows.filter(row=>row.pairComplete).length,unpairedMeasured:rows.filter(row=>!row.pairComplete).length }, comparisons,uninterruptedComparisons, pairs, populations, scenarios, countInvariance, costs,
    requests: rows, warmups, samplerRows: sampler.rows, samplerPhases: sampler.phases, stageDrainMs: stages.map(stage => ({ index: stage.index, arm: stage.arm, pair: stage.pairIndex, ms: stage.result?.drainMs })) };
}

function main(args = process.argv.slice(2)) {
  if (![4,5].includes(args.length)) throw new Error('Usage: node analyze.cjs <ab.json> <readiness/report.json> <metadata/report.json> <http/report.json> [continuation/report.json]');
  issues.length = 0;
  const outputs = ['summary.json','metadata-samples.csv','metadata-blocks.csv','metadata-pairs.csv','http-requests.csv','http-warmups.csv',
    'http-scenarios.csv','http-populations.csv','http-pairs.csv','http-checkpoint-counts.csv','http-query-costs.csv','http-sampler.csv','http-sampler-phases.csv','equivalence-plans.csv'];
  for (const name of outputs) if (fs.existsSync(path.join(__dirname,name))) throw new Error('ANALYSIS_OUTPUT_EXISTS');
  const manifest = read(args[0]), bundleRoot=fs.realpathSync(path.dirname(manifest.path)),root=fs.realpathSync(path.join(bundleRoot,'common'));
  if(path.basename(manifest.path)!=='ab.json'||!contained(bundleRoot,root)||manifest.data.harness?.sourceRoot!=='common')throw new Error('ANALYSIS_MANIFEST_LAYOUT_INVALID');
  // Bootstrap the captured builtin-only verifier. Resolving through the input
  // manifest makes this analyzer portable without importing a live workspace.
  const verifierFiles = ['scripts/verify-central-snapshot-ab.cjs','test/integration/central-snapshot-ab/archive.cjs'];
  for (const file of verifierFiles) {const actual=fs.realpathSync(path.join(root,file));if(!contained(root,actual)||sha(fs.readFileSync(actual)) !== manifest.data.harness?.sources?.[file]) throw new Error('ANALYSIS_VERIFIER_PIN_MISMATCH');}
  const { verifyAB } = require(path.join(root,verifierFiles[0]));
  const identity = verifyAB({ manifestPath: manifest.path, verifyDependencies: true });
  const ready = evidence(path.resolve(args[1]),identity), metadata = evidence(path.resolve(args[2]),identity), http = evidence(path.resolve(args[3]),identity);
  const continuation = args[4] ? evidence(path.resolve(args[4]),identity) : null;
  const inputs = { manifest: { path: manifest.path, sha256: manifest.sha256, bytes: manifest.bytes },
    readiness: validateReport(ready,'readiness',identity), metadata: validateReport(metadata,'measure-metadata',identity), http: validateReport(http,'measure-http',identity,{continuation:Boolean(continuation)}) };
  if(continuation){inputs.continuation=validateReport(continuation,'measure-http-continuation',identity);inputs.continuation.orchestrator=validateContinuation(continuation,http,ready,identity);}
  check(Date.parse(ready.data.finishedAt) <= Date.parse(metadata.data.startedAt) && Date.parse(metadata.data.finishedAt) <= Date.parse(http.data.startedAt), 'READINESS_M_H_SEQUENCE_INVALID');
  for (const key of ['platform','node','architecture','timezone']) check(ready.data.environment?.[key] === metadata.data.environment?.[key] && metadata.data.environment?.[key] === http.data.environment?.[key], 'EXECUTION_ENVIRONMENT_MISMATCH', { key });
  if(continuation)for(const key of ['platform','node','architecture','timezone'])check(continuation.data.environment?.[key]===http.data.environment?.[key],'CONTINUATION_ENVIRONMENT_MISMATCH',{key});
  const proof = readinessAnalysis(ready.data,identity), m = metadataAnalysis(metadata.data,proof), h = httpAnalysis(http.data,proof,identity,continuation?.data);
  const sourceAfter = verifyAB({ manifestPath: manifest.path, verifyDependencies: true });
  check(sourceAfter.manifestSha256 === identity.manifestSha256 && sourceAfter.sourceSetDigest === identity.sourceSetDigest, 'SOURCE_CHANGED_DURING_ANALYSIS');
  const limitations = [
    'Paired A/B compares original aggregate SQL with the two optimized SQL sources. All other runtime sources, protocol, seed and image IDs are bound to the same manifest.',
    '042 and 043 are separate metadata populations. Six alternating pairs per revision, 600 measured calls per arm; functional and warmup calls are excluded.',
    'Four alternating HTTP pairs use fresh fixtures. Per-scenario per-arm per-pair n is 4 or 8: nearest-rank p95 equals the maximum. This is diagnostic, not capacity, C6 or production-SLA certification.',
    'Differences are B minus A; negative latency change means B was faster in that observed population. Pooled quantiles and the distribution of paired changes answer different questions.',
    'Quantiles use nearest rank without rounding. Fractions are calculated per request before summarizing; medians and percentages from separate distributions are not additive.',
    'Intervals include driver, transport, execution and waits. Sums are observed work, not SQL CPU. Query unions are recomputed within each request, including before-response and after-response intervals.',
    'Central/security SQL labels are linked by exact SQL hashes captured during readiness EXPLAIN. Plans are profiling evidence outside timing populations, not repeated performance measurements.',
    'SQL classification and inclusive spans are different views. Spans, queries, admission durations, pool holds and lock holds overlap and must not be added.',
    'Each measured API request must preserve A counts: report 1195 queries, 52 transactions, 25 Central checkpoints/base SQL, 50 authority-security SQL and 3 tenant metadata checkpoints; dashboard 2841/113/53/106/9 respectively.',
    'Manager acquire includes queueing, preparation and physical checkout. Authority-lock query time includes the acquisition round trip; held time begins after acquisition and ends at commit/rollback.',
    'HTTP latency is an API client measurement including parsing; it does not measure browser rendering or perceived UI responsiveness.',
    'The 100ms sampler may miss short waits; sampled sessions have no request identity. Node CPU deltas use adjacent same-phase samples, exclude boundaries, and do not measure PostgreSQL or host CPU.',
    'Sampler phase labels may extend into drain/cleanup. Process memory and phase CPU are observations, not exclusive request costs.',
    'The local host is not reserved and external load/power management is uncontrolled. The paired sequence reduces some order effects but does not eliminate environmental variation.',
    'Dependency versions and lockfiles are checked, not installed dependency bytes. Source integrity and child-report hashes are verified again offline; no SQL, HTTP or infrastructure is executed by this script.',
    'Missing, failed or inconsistent evidence prevents VALID. Failed attempts remain in exports; success latency and all-attempt latency are separately labelled. Hard process termination may leave only partial evidence and cannot yield VALID.',
    ...(continuation ? [
      'This is an incomplete failed HTTP campaign plus an explicitly linked continuation of previously unattempted indices5–7. Original report, child evidence and failure are preserved; no synthetic PASS report is created.',
      'Recorded280/288 measured attempts and55/56 warmups include one failed503 warmup in A/index4. Eight measured A attempts and one warmup are missing. This protocol failure remains even if all continuation stages complete.',
      'The first five scenarios have four complete matched pairs. The two-tenant scenario has three; the eight B observations in its incomplete pair are exported as UNPAIRED and excluded from matched effects. All-observed distributions are separate.',
      'Pair2 links index4A before the operational interruption to index5B after it and is not temporally continuous. The pre-specified sensitivity comparison excludes pair2 and uses only complete uninterrupted pairs0,1,3 in all six scenarios; raw data and the primary matched comparisons remain present.',
      'DATA_PASS only means the recorded-attempt evidence is complete and consistent with the declared interruption. It does not certify the full protocol. A baseline failure does not establish that candidateB repairs its cause.'
    ] : []),
  ];
  const {dataIssues,protocolIssues,dataStatus,protocolStatus,status}=validationStatus(issues);
  const expectedProtocolIssues=continuation?protocolIssues.filter(expectedContinuationIssue):[],unexpectedProtocolIssues=protocolIssues.filter(issue=>!expectedProtocolIssues.includes(issue));
  const summary = { schemaVersion:1, analysisId:identity.id + '-analysis', generatedAt:new Date().toISOString(), analyzerSha256:sha(fs.readFileSync(__filename)),
    status,
    dataQuality:{status:dataStatus,scope:continuation?'RECORDED_ATTEMPTS_WITH_DECLARED_GAPS':'COMPLETE_PLANNED_POPULATION',count:dataIssues.length,issues:dataIssues},
    protocol:{status:protocolStatus,complete:protocolStatus==='PASS',count:protocolIssues.length,issues:protocolIssues,expectedProtocolIssueCount:expectedProtocolIssues.length,
      unexpectedIssueCount:unexpectedProtocolIssues.length,unexpectedIssues:unexpectedProtocolIssues,continuation:Boolean(continuation),
      errorsObserved:{measuredFailures:h.totals.errors,warmupFailures:h.totals.warmupFailures.length,missingMeasured:h.totals.missingMeasured,missingWarmups:h.totals.missingWarmups}}, identity:identityFields(identity), inputs,
    sourceVerification: { before:'PASS', after:sourceAfter.status, dependencyVersions:identity.dependencies, runtimeDifferences:identity.runtimeDifferences },
    validation:{count:issues.length,expectedProtocolIssueCount:expectedProtocolIssues.length,unexpectedIssueCount:dataIssues.length+unexpectedProtocolIssues.length,issues}, quantiles:'NEAREST_RANK', roundingBeforeDecision:false, limitations,
    readiness:proof, metadata:{revisions:m.revisions,blocks:m.blocks,pairs:m.pairs},
    http:{totals:h.totals,comparisons:h.comparisons,uninterruptedPairedComparisons:h.uninterruptedComparisons,
      sensitivity:{preSpecified:true,excludedPairIndices:continuation?[2]:[],reason:continuation?'LONG_OPERATIONAL_GAP_BETWEEN_INDEX4A_AND_INDEX5B':'NO_CONTINUATION_GAP'},
      pairs:h.pairs,populations:h.populations,scenarios:h.scenarios,checkpointCountInvariance:h.countInvariance,queryCosts:h.costs,samplerPhases:h.samplerPhases,stageDrainMs:h.stageDrainMs} };
  const files = { 'summary.json':JSON.stringify(summary,null,2)+'\n','metadata-samples.csv':csv(m.samples),'metadata-blocks.csv':csv(m.blocks),'metadata-pairs.csv':csv(m.pairs),
    'http-requests.csv':csv(h.requests),'http-warmups.csv':csv(h.warmups),'http-scenarios.csv':csv(h.scenarios),'http-populations.csv':csv(h.populations),'http-pairs.csv':csv(h.pairs),'http-checkpoint-counts.csv':csv(h.countInvariance),
    'http-query-costs.csv':csv(h.costs),'http-sampler.csv':csv(h.samplerRows),'http-sampler-phases.csv':csv(h.samplerPhases),'equivalence-plans.csv':csv(proof.plans) };
  for (const [name,content] of Object.entries(files)) fs.writeFileSync(path.join(__dirname,name),content,{flag:'wx'});
  process.stdout.write(JSON.stringify({status:summary.status,validationIssues:issues.length,summary:path.join(__dirname,'summary.json'),files:outputs.length})+'\n');
  if (issues.length) process.exitCode = 1;
  return summary;
}
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(JSON.stringify({status:'FAILED_BEFORE_COMPLETE_ANALYSIS',code:/^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'ANALYSIS_FAILED'})+'\n'); process.exitCode = 1; }
}
module.exports = { stats, union, effects, requestCost, httpPopulation, checkpointCounts, matchScenarioPairs, validationStatus, metadataAnalysis, readinessAnalysis, validateReport, httpAnalysis, main };
