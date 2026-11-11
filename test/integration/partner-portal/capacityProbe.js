'use strict';
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { evaluateCapacity } = require('./capacity');
const { TIMED_SCENARIOS } = require('./temporalDiagnostic');

const CAPACITY_SCENARIOS = Object.freeze([
  ...[0, 25, 26, 100, 101, 10000, 10001].map(count => Object.freeze({ id: `volume-${count}`, count, profile: 'volume' })),
  ...[['denied', 101], ['shared-origin', 101], ['distinct-origins', 101], ['selective', 101],
    ['historical-people', 101], ['large-payload', 26]].map(([profile, count]) => Object.freeze({ id: `profile-${profile}`, count, profile }))
]);
const own = (value, key) => Object.hasOwn(value, key);
const count = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = sql => typeof sql === 'string' ? sql : sql?.text || '';
const queryObservation = Symbol('capacity-query-observation');
function failure(code) { return Object.assign(new Error(code), { code }); }
function safeCode(error) { return typeof error?.code === 'string' && /^[A-Z0-9_]{2,80}$/.test(error.code) ? error.code : 'SERVICE_UNAVAILABLE'; }

function semanticResponse(result) {
  function position(token) {
    if (token === null) return null;
    if (typeof token !== 'string' || token.split('.').length !== 3) throw failure('INVALID_CURSOR_OBSERVATION');
    const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (!value || !value.context || !value.position || !own(value, 'exp')) throw failure('INVALID_CURSOR_OBSERVATION');
    return { context: value.context, position: value.position };
  }
  // No signed token, HMAC, expiry or private body is persisted. The separate
  // repository gate proves signed-cursor compatibility; this compares meaning.
  return { ...result, nextCursor: position(result.nextCursor), previousCursor: position(result.previousCursor) };
}

function fixtureOptions(scenario) {
  const person = (number, active, length) => ({ id: `60000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    name: `Synthetic person ${number}`, role: 'OUTRO', research_area: 'x'.repeat(length), contact: '', email: 'capacity@example.invalid', active });
  const body = scenario.profile === 'historical-people'
    ? { people: [person(1, true, 0), ...Array.from({ length: 100 }, (_, i) => person(i + 2, false, 200))] }
    : scenario.profile === 'large-payload'
      ? { research_area_interest: 'x'.repeat(2000), people: Array.from({ length: 50 }, (_, i) => person(i + 1, true, 400)) } : {};
  return { count: scenario.count, prefix: scenario.id, body,
    partnersPerApplication: scenario.profile === 'distinct-origins' ? 1 : 100,
    sharedOrigin: scenario.profile !== 'distinct-origins' };
}

async function tempCounter(tenant) {
  const value = (await tenant.pool.query({ text: `SELECT temp_bytes::text AS temp_bytes,stats_reset::text AS stats_reset
    FROM pg_stat_database WHERE datname=current_database()`, query_timeout: 1000 })).rows[0];
  if (!value || !own(value, 'temp_bytes') || !own(value, 'stats_reset')) return null;
  const bytes = typeof value.temp_bytes === 'string' && /^\d+$/.test(value.temp_bytes) ? Number(value.temp_bytes) : value.temp_bytes;
  return count(bytes) ? { bytes, reset: value.stats_reset } : null;
}

async function observeCleanup(env, tenant) {
  const started = performance.now(); let quiet = 0;
  while (performance.now() - started <= 10000) {
    const snapshot = env.runtime.poolManager.snapshot();
    if (!snapshot || !['active', 'queued', 'credentialDisposalsPending', 'cleanupFailures'].every(key => count(snapshot[key]))) return null;
    if (snapshot.cleanupFailures) return null;
    const row = (await tenant.pool.query({ text: `SELECT count(*)::int AS active FROM pg_stat_activity
      WHERE datname=current_database() AND usename=$1
      AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL OR backend_xmin IS NOT NULL)`,
    values: [tenant.credentials.login], query_timeout: 1000 })).rows[0];
    if (!row || !count(row.active)) return null;
    quiet = snapshot.active === 0 && snapshot.queued === 0 && snapshot.credentialDisposalsPending === 0 && row.active === 0 ? quiet + 1 : 0;
    if (quiet === 2) return performance.now() - started;
    await delay(10);
  }
  return null;
}

async function collect(env, tenant, service, actor, input, identity, observationErrors, requiredTiming) {
  const selected = TIMED_SCENARIOS.includes(identity.scenarioId);
  const trace = selected && env.timing ? env.timing.start() : null;
  if (selected && !trace && requiredTiming) observationErrors.push({ ...identity, code: 'TEMPORAL_DIAGNOSTIC_UNAVAILABLE' });
  const work = () => collectSample(env, tenant, service, actor, input, identity, observationErrors, trace);
  return trace ? env.timing.run(trace, work) : work();
}

async function collectSample(env, tenant, service, actor, input, identity, observationErrors, trace) {
  const previous = { ...env.hooks }, assigned = ['beforeQuery', 'afterQuery', 'onQueryError', 'onAuthorize', 'onAcquire'];
  const admissions = [], starts = [];
  let queryCount = 0, rowsRead = 0, readEvents = 0, authorizationCalls = 0, afterSuccessQueries = 0;
  let succeeded = false, settled = false, result, operationEnd = null, errorCode = null;
  let atSettlement;
  const measure = (label, work) => trace ? env.timing.measure(label, work) : work();
  let nodeRssPeakBytes = null, nodeHeapPeakBytes = null, memoryFailed = false;
  const note = code => observationErrors.push({ ...identity, code });
  function memory() {
    try {
      const current = process.memoryUsage();
      if (!count(current.rss) || !count(current.heapUsed) || !current.rss || !current.heapUsed) throw failure('MEMORY_MEASUREMENT_UNAVAILABLE');
      nodeRssPeakBytes = Math.max(nodeRssPeakBytes || 0, current.rss);
      nodeHeapPeakBytes = Math.max(nodeHeapPeakBytes || 0, current.heapUsed);
    } catch { memoryFailed = true; }
  }
  function completed(context) {
    if (context.tenant !== tenant) return;
    const marker = context[queryObservation];
    if (settled && succeeded && !marker?.countedLate) {
      afterSuccessQueries++; if (marker) marker.countedLate = true;
    }
  }
  env.hooks.beforeQuery = async context => {
    await previous.beforeQuery?.(context);
    if (context.tenant !== tenant) return;
    queryCount++; context[queryObservation] = { countedLate: false };
    if (/^BEGIN TRANSACTION READ WRITE\s*;?$/i.test(text(context.sql).trim())) starts.push(performance.now());
    if (settled && succeeded) { afterSuccessQueries++; context[queryObservation].countedLate = true; }
  };
  env.hooks.afterQuery = async context => {
    completed(context);
    if (context.tenant === tenant) {
      const sql = text(context.sql).trim();
      if (/^FETCH FORWARD (?:100|1) FROM c4g_partner_browse_[a-f0-9]{32}\s*;?$/i.test(sql)
        || /^SELECT\b/i.test(sql) && /\bFROM\s+opportunity_catalog\.application_partner\s+p\b/i.test(sql)) {
        readEvents++;
        if (Array.isArray(context.result?.rows)) rowsRead += context.result.rows.length;
        else rowsRead = NaN;
      }
    }
    await previous.afterQuery?.(context);
  };
  env.hooks.onQueryError = async context => { completed(context); await previous.onQueryError?.(context); };
  env.hooks.onAuthorize = async context => { authorizationCalls++; await previous.onAuthorize?.(context); };
  env.hooks.onAcquire = context => { admissions.push(context); previous.onAcquire?.(context); };
  let before = null, after = null, cleanupMs = null, responseBytes = null, responseDigest = null;
  memory(); const sampler = setInterval(memory, 10);
  try {
    try { before = await tempCounter(tenant); } catch { /* Missing measurement remains null. */ }
    try { result = await measure('OPERATION', () => service.execute('partnersBrowse', input, null, actor.request)); succeeded = true; }
    catch (error) { errorCode = safeCode(error); }
    finally { operationEnd = performance.now(); settled = true; memory(); if (trace) atSettlement = trace.snapshot(); }
    try { cleanupMs = await measure('CLEANUP', () => observeCleanup(env, tenant)); } catch { /* No claim of physical cleanup. */ }
    try { after = await tempCounter(tenant); } catch { /* Missing measurement remains null. */ }
    if (succeeded) {
      try {
        responseBytes = Buffer.byteLength(JSON.stringify(result));
        responseDigest = createHash('sha256').update(JSON.stringify(semanticResponse(result))).digest('hex');
      } catch { note('RESPONSE_MEASUREMENT_UNAVAILABLE'); }
    } else responseBytes = 0; // No successful repository result, not an HTTP error-body measurement.
  } finally {
    clearInterval(sampler); memory();
    for (const key of assigned) { if (own(previous, key)) env.hooks[key] = previous[key]; else delete env.hooks[key]; }
  }
  const operationMs = starts.length === 1 ? operationEnd - starts[0] : null;
  const admissionMs = admissions.length === 1 && finite(admissions[0].ms) ? admissions[0].ms : null;
  const postgresTempBytes = before && after && before.reset === after.reset && after.bytes >= before.bytes ? after.bytes - before.bytes : null;
  if (operationMs === null) note('OPERATION_MEASUREMENT_UNAVAILABLE');
  if (admissionMs === null) note('ADMISSION_MEASUREMENT_UNAVAILABLE');
  if (postgresTempBytes === null) note('POSTGRES_TEMP_MEASUREMENT_UNAVAILABLE');
  if (cleanupMs === null) note('CLEANUP_MEASUREMENT_UNAVAILABLE');
  if (memoryFailed) { nodeRssPeakBytes = null; nodeHeapPeakBytes = null; note('MEMORY_MEASUREMENT_UNAVAILABLE'); }
  if (!readEvents || !count(rowsRead)) { rowsRead = null; note('ROW_MEASUREMENT_UNAVAILABLE'); }
  if (rowsRead > 0 && (succeeded || errorCode === 'LIMIT_EXCEEDED') && authorizationCalls === 0) {
    authorizationCalls = null; note('AUTHORITY_MEASUREMENT_UNAVAILABLE');
  }
  let temporalDiagnostic;
  if (trace) {
    const afterCleanup = trace.snapshot();
    const status = atSettlement.status === 'INVALID' || afterCleanup.status === 'INVALID' ? 'INVALID'
      : Object.values(afterCleanup.metrics).some(row => row.inflight) ? 'INCOMPLETE' : 'VALID';
    temporalDiagnostic = { status, atSettlement, afterCleanup };
    if (status !== 'VALID') note(`TEMPORAL_DIAGNOSTIC_${status}`);
  }
  return { ...identity, ...(temporalDiagnostic ? { temporalDiagnostic } : {}), success: succeeded, errorCode, operationMs, admissionMs, responseBytes, responseDigest,
    queryCount, authorizationCalls, rowsRead, nodeRssPeakBytes, nodeHeapPeakBytes, postgresTempBytes, cleanupMs, afterSuccessQueries };
}

// The injectable factory exists only for offline format/coverage tests. Its
// unverified mode always marks evidence INCOMPLETE; the default runner rejects
// unprepared environments before any seed or query can execute.
function createCapacityProbe({ seedPartners, isPreparedEnvironment, allowUnverifiedForTests = false }) {
  return async function runCapacityGate(env, { repetitions = 2 } = {}) {
    const environmentVerified = isPreparedEnvironment(env) === true;
    if (!environmentVerified && !allowUnverifiedForTests) throw failure('PARTNER_GATE_ENVIRONMENT_REQUIRED');
    if (!Number.isSafeInteger(repetitions) || repetitions < 2 || repetitions % 2) throw failure('CAPACITY_REPETITIONS_INVALID');
    const tenant = env.tenants[0], samples = [], warmups = [], observationErrors = [];
    const scenarios = CAPACITY_SCENARIOS.map(scenario => ({ ...scenario, status: 'NOT_RUN' }));
    const services = { before: env.composition('baseline'), after: env.composition('candidate') };
    let stop = false;
    for (const scenario of scenarios) {
      if (stop) continue;
      let seeded, mayArchive = true;
      function requireCleanup(sample) {
        // Quiet tenant sessions do not prove that the reader/Central work has
        // settled. Leave the fixture to outer environment cleanup in that case.
        const pending = Object.values(sample.temporalDiagnostic?.afterCleanup.metrics || {}).some(row => row.inflight > 0);
        if (sample.cleanupMs === null || pending) {
          mayArchive = false;
          throw failure('CAPACITY_CLEANUP_UNCONFIRMED');
        }
      }
      try {
        seeded = await seedPartners(tenant, fixtureOptions(scenario));
        const actor = scenario.profile === 'denied' ? await env.actor(tenant, { profileCode: 'CONTRIBUTOR' }) : tenant.owner;
        const input = { q: scenario.profile === 'selective' ? `${seeded.prefix} ${String(scenario.count).padStart(5, '0')}` : seeded.prefix };
        const expectedErrorCode = scenario.count > 10000 ? 'LIMIT_EXCEEDED' : null;
        for (const variant of ['before', 'after']) {
          const sample = await collect(env, tenant, services[variant], actor, input,
            { scenarioId: scenario.id, variant, pair: 0, order: 0, candidates: scenario.count, expectedErrorCode }, observationErrors, environmentVerified);
          warmups.push(sample);
          requireCleanup(sample);
          if (sample.success !== (expectedErrorCode === null) || sample.errorCode !== expectedErrorCode) observationErrors.push({ scenarioId: scenario.id, code: 'UNEXPECTED_WARMUP_FAILURE' });
        }
        for (let pair = 1; pair <= repetitions; pair++) {
          const order = pair % 2 ? ['before', 'after'] : ['after', 'before'];
          for (const [index, variant] of order.entries()) {
            const sample = await collect(env, tenant, services[variant], actor, input,
              { scenarioId: scenario.id, variant, pair, order: index + 1, candidates: scenario.count, expectedErrorCode }, observationErrors, environmentVerified);
            samples.push(sample); requireCleanup(sample);
          }
        }
        scenario.status = 'COMPLETE';
      } catch (error) {
        const code = error?.code === 'CAPACITY_CLEANUP_UNCONFIRMED' ? error.code : 'CAPACITY_FIXTURE_FAILED';
        observationErrors.push({ scenarioId: scenario.id, code }); stop = true;
        if (!mayArchive) scenario.status = 'INCOMPLETE';
      }
      finally {
        if (seeded && mayArchive) try { await seeded.cleanup(); }
        catch { observationErrors.push({ scenarioId: scenario.id, code: 'CAPACITY_FIXTURE_CLEANUP_FAILED' }); stop = true; }
        if (seeded && !mayArchive) observationErrors.push({ scenarioId: scenario.id, code: 'CAPACITY_FIXTURE_ARCHIVE_DEFERRED' });
      }
    }
    const evaluation = evaluateCapacity(samples, { expectedScenarioIds: CAPACITY_SCENARIOS.map(scenario => scenario.id), expectedRepetitions: repetitions });
    if (observationErrors.length) {
      evaluation.failures.push(...observationErrors);
      if (evaluation.status === 'PASS') evaluation.status = 'FAIL';
    }
    if (!environmentVerified) { evaluation.status = 'INCOMPLETE'; evaluation.failures.push({ code: 'UNVERIFIED_ENVIRONMENT' }); }
    return { environmentVerified, samples, warmups, scenarios, observationErrors, evaluation, measurementScope: {
      operationMs: 'Observed main BEGIN TRANSACTION READ WRITE to composition settlement; real executor enforces the full operation deadline',
      admissionMs: 'Actual pool-manager acquire observer; exactly one admission per operation required',
      queryCount: 'Physical tenant LOGIN SQL only, including outer protocol; excludes Central SQL and admin observations',
      responseBytes: 'JSON repository result bytes; zero for refused operations with no successful result, not HTTP error bytes',
      responseDigest: 'SHA-256 of result with cursors reduced to context/position; no token/expiry persisted',
      memory: 'Observed gate-process RSS/heap peaks include fixtures and instrumentation; no product budget inferred',
      postgresTempBytes: 'Observed pg_stat_database counter delta; database-wide and subject to PostgreSQL statistics publication lag',
      cleanup: 'Two quiet observations of pool state and tenant LOGIN pg_stat_activity, within 10000 ms; pending temporal spans stop load and defer fixture archive to outer environment cleanup; separate gate verifies portal/session cleanup',
      productionCapacityApproved: false } };
  };
}

async function runCapacityGate(env, options) {
  const { isPreparedEnvironment } = require('./environment');
  if (!isPreparedEnvironment(env)) throw failure('PARTNER_GATE_ENVIRONMENT_REQUIRED');
  return createCapacityProbe({ isPreparedEnvironment, seedPartners: require('./repositoryProbe').seedPartners })(env, options);
}

module.exports = { CAPACITY_SCENARIOS, createCapacityProbe, runCapacityGate };
