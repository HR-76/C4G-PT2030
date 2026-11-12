'use strict';
const { Pool } = require('pg');
const { createFundingWorker } = require('../fundingTenders/worker');
const { createSource, LIMITS } = require('../fundingTenders/source');
const { collectionPolicy, EXPANDED_APPROVAL, OFFICIAL_APPROVAL } = require('../fundingTenders/programmes');
const { createPgBossQueueAdapter } = require('../async/adapters/pgBossQueueAdapter');
const { inspectPgBossSchema } = require('../async/pgBossSchemaInspection');
const { supportsCentralVersion } = require('../security/centralMigrationManifest');
// Staging is the only place besides the local rehearsal where live collection is admitted, and only against the
// staging Central reached by its network name over verified TLS, with an approval that names the scope.
const STAGING_CENTRAL = Object.freeze({ hostname: 'c4g-postgres', port: '5432', pathname: '/c4g_central_staging' });
function stagingTarget(env, target) {
  collectionPolicy(env.FUNDING_TENDERS_SOURCE, env.FUNDING_TENDERS_REHEARSAL_APPROVED);
  if (env.NODE_ENV !== 'production' || target.hostname !== STAGING_CENTRAL.hostname || target.port !== STAGING_CENTRAL.port
      || target.pathname !== STAGING_CENTRAL.pathname || target.searchParams.get('sslmode') !== 'verify-full') throw new Error('FUNDING_STAGING_TARGET_INVALID');
  return { target, live: true };
}
function fundingWorkerTarget(env) {
  if (env.FUNDING_TENDERS_RUNTIME !== 'central' || env.OPPORTUNITY_IMPORTS_RUNTIME === 'f12-xlsx') throw new Error('FUNDING_WORKER_REQUIRES_SEPARATE_PROCESS');
  const target = new URL(env.CENTRAL_DATABASE_URL);
  if (env.FUNDING_TENDERS_SOURCE === 'live-staging') return stagingTarget(env, target);
  const demo = env.FUNDING_TENDERS_SOURCE === 'live-demo';
  const local = env.FUNDING_TENDERS_SOURCE === 'live-local';
  const live = env.FUNDING_TENDERS_SOURCE === 'live-rehearsal' || demo || local;
  if ((!live && env.FUNDING_TENDERS_SOURCE !== 'fixture') || env.NODE_ENV !== 'development' || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('FUNDING_LOCAL_REHEARSAL_ONLY');
  const approved = env.FUNDING_TENDERS_REHEARSAL_APPROVED === 'five-public-records' || local && [EXPANDED_APPROVAL, OFFICIAL_APPROVAL].includes(env.FUNDING_TENDERS_REHEARSAL_APPROVED);
  if (live && (!approved || target.pathname !== (local ? '/c4g_central_dev' : demo ? '/c4g_f13_authority_synthetic_central' : '/funding_live_rehearsal') || target.port !== (local ? '5432' : demo ? '5561' : '5560'))) throw new Error('FUNDING_LIVE_REHEARSAL_NOT_AUTHORIZED');
  return {target,live};
}
async function loadFundingTendersWorker({ env = process.env } = {}) {
  const {target,live} = fundingWorkerTarget(env);
  const activation=require('../opportunities/v2/activationHttp');
  const euSourceControlEnabled=activation.runtimeEnabled(env);
  const euWriterV2=require('../fundingTenders/euWriterConfig').configuredEuWriter(env);
  const pool = require('./poolResilience').guardPool(new Pool({ connectionString: target.toString(), max: 4 }), 'funding-worker');
  let queue;
  try {
    const ready = await require('../security/centralMigrationPreflight').preflightCentral(pool);
    if(euSourceControlEnabled)await activation.assertActivationHttpCapability(pool);
    if(euWriterV2)await require('../fundingTenders/euWriterConfig').assertEuWriterCapability(pool,ready.currentVersion);
    const coverage=require('../fundingTenders/coverageConfig').coverageConfig(env.FUNDING_TENDERS_COVERAGE,ready.currentVersion,env.FUNDING_TENDERS_ENRICHMENT);
    const collection = collectionPolicy(env.FUNDING_TENDERS_SOURCE, env.FUNDING_TENDERS_REHEARSAL_APPROVED);
    // Opt-in daily collection (FUNDING_TENDERS_SCHEDULE=daily-v1); an invalid configuration fails the start.
    const schedule = require('../fundingTenders/scheduledRefresh').loadScheduleConfiguration(env, collection.sources);
    if (!supportsCentralVersion(ready.currentVersion, '015_funding_tenders_central')
      || collection.sources.length > 1 && !supportsCentralVersion(ready.currentVersion, '017_funding_programmes')
      || collection.sources.length > 3 && !supportsCentralVersion(ready.currentVersion, '018_official_programme_sources')) throw new Error('FUNDING_SCHEMA_REQUIRED');
    await require('../opportunities/preflight').opportunityPreflight(pool,'central');
    queue = await createPgBossQueueAdapter({ connectionString: target.toString(), queueMap: { 'funding_tenders.refresh': 'funding-tenders-refresh' }, inspectSchema: () => inspectPgBossSchema(pool, ['funding-tenders-refresh']) });
    const fundingSource = createSource({ enrichmentEnabled:coverage.enrichmentEnabled===true, canonicalV2Enabled:euWriterV2!==null, limits: { ...LIMITS, ...collection.limits }, fetchImpl: live ? globalThis.fetch : async () => new Response(JSON.stringify({ results: [
      { content: 'Oportunidade sintética Funding & Tenders', url: 'https://example.invalid/funding/synthetic', metadata: { identifier: ['SYNTHETIC-FT-LOCAL-1'], frameworkProgramme: ['43108390'], startDate: ['2026-01-01'], deadlineDate: ['2027-12-31'] } }
    ] })) });
    // Fixture mode only: label the synthetic record with an explicit synthetic funder,
    // because the persisted v1 contract requires one and the parser never asserts it.
    const syntheticFunder = record => ({ ...record, fields: { funderName: 'Financiador sintético (fixture local)', ...record.fields } });
    const euSource = live ? fundingSource : {
      async collect(input) { const batch = await fundingSource.collect(input); return { ...batch, records: batch.records.map(syntheticFunder) }; },
      async lookup(input) { const result = await fundingSource.lookup(input); return result.record ? { ...result, record: syntheticFunder(result.record) } : result; }
    };
    const official = require('../fundingTenders/officialSources').createOfficialSource({fetchImpl: live ? globalThis.fetch : async()=>{throw new Error('OFFICIAL_LIVE_TRANSPORT_REQUIRED');}, limits:{...LIMITS,...collection.limits}});
    const source = {lookup(input){if(!collection.sources.includes(input.source))throw new Error("INVALID_INPUT");return euSource.lookup(input);},collect(input) { if (!collection.sources.includes(input.source)) throw Object.assign(new Error('INVALID_INPUT'), {code:'INVALID_INPUT'}); return require('../fundingTenders/sourceIdentity').OFFICIAL.includes(input.source) ? official.collect(input) : euSource.collect(input); }};
    const repository=require('../fundingTenders/repository').createFundingRepository({pool,euSourceControlEnabled,euWriterV2,coverageEnabled:coverage.supported,startCoverage:coverage.enabled,refreshEnabled:coverage.temporalSupported===true,resolutionEnabled:coverage.resolutionSupported===true,enrichmentEnabled:coverage.enrichmentEnabled===true});
    const runtime = createFundingWorker({ pool, queue, source, repository,
      log: entry => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n') });
    const scheduled = schedule ? require('../fundingTenders/scheduledRefresh').createScheduledRefresh({ repository, userId: schedule.userId, sources: schedule.sources, at: schedule.at,
      log: entry => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}
`) }) : null;
    return { ...runtime,
      async start(...args) { const started = await runtime.start(...args); scheduled?.start(); return started; },
      async shutdown() { try { await scheduled?.shutdown(); await runtime.shutdown(); } finally { await pool.end(); } } };
  } catch (error) { if (queue) await queue.shutdown(); await pool.end(); throw error; }
}
module.exports = { loadFundingTendersWorker, fundingWorkerTarget };
