'use strict';
// This module has no CLI side effects and creates no database or connection.
// Its caller supplies a scoped runtime client/pool from an owned fixture.
const process = require('node:process');
const schema = require('../../../backend/src/security/centralSchemaManifest');
const legacy = require('../../../backend/test/support/centralSchemaLegacyQueries.json');
const defaultProtocol = require('../../../context/references/performance/eu-writer-v2-protocol.json');

const REVISIONS = Object.freeze(['042_opportunity_eu_source_control_v2', '043_opportunity_eu_writer_v2']);
const FIELDS = Object.freeze(['tables', 'columns', 'constraints', 'indexes', 'triggers', 'triggerFunctions', 'authoritySequence']);
const PAIRS = Object.freeze([['M7', 'M1'], ['M1', 'M7'], ['M7', 'M1'], ['M1', 'M7'], ['M7', 'M1'], ['M1', 'M7']]);
const fail = code => Object.assign(new Error(code), { code });
const safeCode = error => /^[A-Z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'METADATA_VALIDATION_FAILED';
const normalize = text => text.replace(/\s+/g, ' ').trim();
const now = () => process.hrtime.bigint();
const milliseconds = ns => Number(ns) / 1e6;
const isPool = source => typeof source?.connect === 'function' && typeof source.release !== 'function' && !source.connection;
let aggregateSqlPromise;

// Capture only immutable SQL text from the actual collector, without touching a
// database or retaining a snapshot. A changed base projection fails closed.
async function aggregateSql() {
  if (!aggregateSqlPromise) aggregateSqlPromise = (async () => {
    const stop = {}, texts = [];
    try { await schema.centralSchemaSnapshot({ query(sql) { texts.push(sql); throw stop; } }); }
    catch (error) { if (error !== stop) throw error; }
    const sql = texts[0];
    if (texts.length !== 1 || typeof sql !== 'string' || (sql.match(/\bjson_agg\(/g) || []).length !== 7 ||
      !FIELDS.every(field => typeof legacy[field] === 'string' && sql.includes('AS "' + field + '"') &&
        normalize(sql).includes('FROM (' + normalize(legacy[field]) + ') AS catalog_row)')))
      throw fail('METADATA_AGGREGATE_CONTRACT_CHANGED');
    return sql;
  })();
  return aggregateSqlPromise;
}

function validateRevision(revision) {
  if (!REVISIONS.includes(revision)) throw fail('METADATA_REVISION_INVALID');
}

function validateProtocol(protocol) {
  const m = protocol?.metadata;
  if (!m || m.warmupCallsPerBlock !== 10 || m.measuredCallsPerBlock !== 100 || m.samplesPerVariantPerSchema !== 600 ||
    m.connectionsPerBlock !== 1 || JSON.stringify(m.pairOrder) !== JSON.stringify(PAIRS) ||
    protocol?.measurement?.clock !== 'MONOTONIC' || protocol?.measurement?.quantiles !== 'NEAREST_RANK' ||
    protocol?.measurement?.roundBeforeDecision !== false || protocol?.execution?.controlBudgetsMs?.metadataBlock !== 300000)
    throw fail('METADATA_PROTOCOL_INVALID');
  return m;
}

function nearestRank(values, quantile) {
  if (!Array.isArray(values) || !values.length || values.some(value => !Number.isFinite(value) || value < 0) ||
    !Number.isFinite(quantile) || quantile <= 0 || quantile > 1) throw fail('METADATA_POPULATION_INVALID');
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1];
}

function distribution(values) {
  return { count: values.length, p50Ms: nearestRank(values, 0.5), p95Ms: nearestRank(values, 0.95), maximumMs: nearestRank(values, 1) };
}

function expectedSecurityQueries(revision, phase) {
  // Current scoped reader: authority(1), catalog-reader(6), catalog(5), and
  // writer helpers(5) only for 043. This count is evidence, never a bypass.
  return phase === 'equivalence' ? 7 : revision === REVISIONS[1] ? 17 : 12;
}

async function observe({ client, revision, variant, phase, epoch, report, pairIndex = null, blockIndex = null, sampleIndex = null }) {
  const sql = await aggregateSql(), started = now();
  const sample = { revision, variant, phase, pairIndex, blockIndex, sampleIndex, startedNs: String(started - epoch),
    status: 'RUNNING', queryCounts: { base: 0, security: 0 }, queries: [] };
  report.samples.push(sample);
  let aggregateCalls = 0;
  async function physical(kind, args) {
    const begin = now(), query = { kind, startedNs: String(begin - epoch), status: 'RUNNING' };
    sample.queries.push(query); sample.queryCounts[kind]++;
    try { const result = await Reflect.apply(client.query, client, args); query.status = 'PASS'; return result; }
    catch (error) { query.status = 'FAIL'; query.errorCode = safeCode(error); throw error; }
    finally { const elapsed = now() - begin; query.durationNs = String(elapsed); query.durationMs = milliseconds(elapsed); }
  }
  const observed = { async query(...args) {
    if (args[0] !== sql) return physical('security', args);
    aggregateCalls++;
    if (variant === 'M1') return physical('base', args);
    if (args.length !== 1) throw fail('METADATA_AGGREGATE_CONTRACT_CHANGED');
    const row = {};
    for (const field of FIELDS) {
      const result = await physical('base', [legacy[field]]);
      if (!Array.isArray(result?.rows)) throw fail('CENTRAL_SCHEMA_SNAPSHOT_INVALID');
      row[field] = result.rows;
    }
    return { rows: [row] };
  } };
  try {
    let snapshot;
    if (phase === 'equivalence') {
      snapshot = await schema.centralSchemaSnapshot(observed);
      sample.fingerprint = schema.schemaFingerprint(snapshot);
      if (sample.fingerprint !== schema.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[revision]) throw fail('METADATA_FINGERPRINT_MISMATCH');
    } else sample.fingerprint = await schema.assertCentralSchema(observed, revision);
    if (aggregateCalls !== 1 || sample.queryCounts.base !== (variant === 'M7' ? 7 : 1) ||
      sample.queryCounts.security !== expectedSecurityQueries(revision, phase)) throw fail('METADATA_QUERY_COUNT_MISMATCH');
    sample.status = 'PASS';
    return { sample, json: snapshot === undefined ? undefined : JSON.stringify(snapshot) };
  } catch (error) { sample.status = 'FAIL'; sample.errorCode = safeCode(error); throw error; }
  finally {
    const elapsed = now() - started;
    sample.durationNs = String(elapsed); sample.durationMs = milliseconds(elapsed);
    sample.driverObservedWorkMs = sample.queries.reduce((sum, query) => sum + query.durationMs, 0);
  }
}

async function withConnection(source, report, label, callback) {
  const start = now(), pooled = isPool(source);
  const client = pooled ? await source.connect() : source;
  if (!client || typeof client.query !== 'function' || (pooled && typeof client.release !== 'function')) throw fail('METADATA_CLIENT_INVALID');
  report.connections.push({ label, callerOwned: !pooled, acquisitionMs: pooled ? milliseconds(now() - start) : null });
  try { return await callback(client); }
  finally { if (pooled) client.release(); }
}

async function functional(client, revision, report, epoch) {
  const serialized = new Map();
  for (const variant of ['M7', 'M1']) {
    for (let sampleIndex = 0; sampleIndex < 2; sampleIndex++) {
      const result = await observe({ client, revision, variant, phase: 'equivalence', epoch, report, sampleIndex });
      if (serialized.has(variant) && serialized.get(variant) !== result.json) throw fail('METADATA_REPEAT_CHANGED');
      serialized.set(variant, result.json);
    }
    for (let sampleIndex = 0; sampleIndex < 2; sampleIndex++) await observe({ client, revision, variant, phase: 'validation', epoch, report, sampleIndex });
  }
  if (serialized.get('M7') !== serialized.get('M1')) throw fail('METADATA_JSON_BYTES_DIFFER');
  report.fingerprint = schema.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[revision];
  report.checks = { exactJsonBytes: true, exactFingerprint: true, freshReadsPerCall: true, securityReadsPreserved: true };
}

async function checkpointMetadata({ client, revision, variant = 'M1' }) {
  validateRevision(revision);
  if (!['M7', 'M1'].includes(variant)) throw fail('METADATA_VARIANT_INVALID');
  const report = { samples: [] };
  return (await observe({ client, revision, variant, phase: 'validation', epoch: now(), report })).sample;
}

async function runMetadata({ client, revision, mode = 'functional', protocol = defaultProtocol, onProgress = () => {} } = {}) {
  validateRevision(revision);
  const parameters = validateProtocol(protocol);
  if (!['functional', 'measure'].includes(mode)) throw fail('METADATA_MODE_INVALID');
  if (!client || (typeof client.query !== 'function' && typeof client.connect !== 'function') || typeof onProgress !== 'function') throw fail('METADATA_CLIENT_INVALID');
  if (mode === 'measure' && !isPool(client)) throw fail('METADATA_POOL_REQUIRED');
  const epoch = now(), report = { schemaVersion: 1, status: 'RUNNING', mode, revision, protocolId: protocol.protocolId,
    clock: 'MONOTONIC', quantiles: 'NEAREST_RANK', connections: [], checks: {}, samples: [], blocks: [], pairs: [], summary: {},
    limits: ['Scoped runtime client supplied by the owned fixture.', 'Functional durations are not performance samples.',
      'Drift, rollback and post-lock checks are separate fixture operations.', 'Driver interval sums are observed work, not SQL CPU.'] };
  try {
    await aggregateSql();
    await withConnection(client, report, 'functional', connection => functional(connection, revision, report, epoch));
    await onProgress({ stage: 'functional-complete', revision, status: 'PASS' });
    if (mode === 'measure') {
      for (let pairIndex = 0; pairIndex < PAIRS.length; pairIndex++) {
        for (const variant of PAIRS[pairIndex]) {
          const blockStarted = now(), controlBudgetMs = protocol.execution.controlBudgetsMs.metadataBlock;
          const blockIndex = report.blocks.length, block = { pairIndex, blockIndex, variant, status: 'RUNNING', controlBudgetMs };
          report.blocks.push(block);
          const withinBudget = () => {
            block.controlElapsedMs = milliseconds(now() - blockStarted);
            if (block.controlElapsedMs > controlBudgetMs) throw fail('CONTROL_DEADLINE_EXCEEDED');
          };
          const cpu = process.cpuUsage(), memory = process.memoryUsage();
          await withConnection(client, report, 'block-' + blockIndex, async connection => {
            for (const [phase, count] of [['warmup', parameters.warmupCallsPerBlock], ['measured', parameters.measuredCallsPerBlock]])
              for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
                withinBudget();
                await observe({ client: connection, revision, variant, phase, epoch, report, pairIndex, blockIndex, sampleIndex });
                withinBudget();
              }
          });
          withinBudget();
          const samples = report.samples.filter(sample => sample.blockIndex === blockIndex && sample.phase === 'measured');
          Object.assign(block, distribution(samples.map(sample => sample.durationMs)), { status: 'PASS', warmups: parameters.warmupCallsPerBlock,
            processCpuMicroseconds: process.cpuUsage(cpu), memoryBefore: { rss: memory.rss, heapUsed: memory.heapUsed },
            memoryAfter: (() => { const end = process.memoryUsage(); return { rss: end.rss, heapUsed: end.heapUsed }; })() });
          await onProgress({ stage: 'block-complete', revision, pairIndex, blockIndex, variant, count: block.count });
        }
        const byVariant = Object.fromEntries(report.blocks.filter(block => block.pairIndex === pairIndex).map(block => [block.variant, block]));
        report.pairs.push({ pairIndex, order: [...PAIRS[pairIndex]], m1MinusM7: {
          p50Ms: byVariant.M1.p50Ms - byVariant.M7.p50Ms, p95Ms: byVariant.M1.p95Ms - byVariant.M7.p95Ms,
          maximumMs: byVariant.M1.maximumMs - byVariant.M7.maximumMs } });
      }
      for (const variant of ['M7', 'M1']) {
        const population = report.samples.filter(sample => sample.phase === 'measured' && sample.variant === variant);
        if (population.length !== parameters.samplesPerVariantPerSchema) throw fail('METADATA_SAMPLE_COUNT_MISMATCH');
        report.summary[variant] = distribution(population.map(sample => sample.durationMs));
      }
    }
    report.status = 'PASS';
    return report;
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: safeCode(error) };
    for (const block of report.blocks) if (block.status === 'RUNNING') block.status = 'FAIL';
    if (error && (typeof error === 'object' || typeof error === 'function'))
      Object.defineProperty(error, 'metadataReport', { value: report, configurable: true });
    throw error;
  } finally { report.totalDurationMs = milliseconds(now() - epoch); }
}

module.exports = { runMetadata, checkpointMetadata, nearestRank };
