'use strict';
// Read-only measurement of existing metadata with the configured limited login.
// No fixture setup, migration, login data, SQL text or query parameters are logged.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const cfg = require('../../../backend/scripts/localPlatform/config');
const {Client} = require('../../../backend/node_modules/pg');
const sha = value => createHash('sha256').update(value).digest('hex');
const round = value => Math.round(value * 100) / 100;
const sourcePath = path.join(root, 'backend/src/security/tenantSchemaFingerprint.js');
const baselineSource = fs.readFileSync(path.join(__dirname, 'fixtures/tenantSchemaFingerprint-before.cjs'));
assert.equal(sha(baselineSource), 'd0baa7265dbf86ada926fe783cf52d110f84dbdbbfe415c1df4ab07f89a972bf');
const compiled = new Module(sourcePath, module);
compiled.filename = sourcePath;
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
compiled._compile(baselineSource.toString('utf8'), sourcePath);
const baseline = compiled.exports;
const candidateSource = fs.readFileSync(sourcePath);
const compiledCandidate = new Module(sourcePath, module);
compiledCandidate.filename = sourcePath;
compiledCandidate.paths = Module._nodeModulePaths(path.dirname(sourcePath));
compiledCandidate._compile(candidateSource.toString('utf8'), sourcePath);
const candidate = compiledCandidate.exports;
const compare = process.argv.includes('--compare');
const out = path.join(root, 'output/dashboard-tenant-cost', (compare ? 'snapshot-compare-' : 'snapshot-profile-') + new Date().toISOString().replaceAll(':', '-'));
fs.mkdirSync(out, {recursive: true});
const evidence = {mode: compare ? 'compare' : 'profile', startedAt: new Date().toISOString(), limitedLogin: false,
  readOnly: false, baselineSha256: sha(baselineSource), candidateSha256: sha(candidateSource), samples: [], warmups: [], cleanup: false};
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2) + '\n');
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return {n, median: round(n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / n), min: sorted[0], max: sorted.at(-1)};
}
(async () => {
  let client, opened = false;
  try {
    const statePath = path.join(cfg.folder, 'runtime.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const env = require('../../../backend/scripts/localPlatform/runtime').runtimeEnvironment(cfg.readConfig(), state);
    const [entry] = JSON.parse(env.OPPORTUNITY_API_CREDENTIALS_JSON);
    assert.equal(entry.login, 'c4g_local_api');
    const configHash = sha(fs.readFileSync(statePath));
    client = new Client({host: entry.host, port: entry.port, database: entry.database, user: entry.login,
      password: entry.password, ssl: entry.ssl ? {rejectUnauthorized: true} : false, connectionTimeoutMillis: 5000});
    await client.connect();
    const login = (await client.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=current_user')).rows;
    assert.equal(login.length, 1); assert.ok(Object.values(login[0]).every(value => value === false));
    evidence.limitedLogin = true;
    let fingerprint, reference;
    async function sample(variant, phase, pair) {
      await client.query('BEGIN TRANSACTION READ ONLY'); opened = true;
      await client.query("SET LOCAL statement_timeout='5s'");
      assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value, 'on');
      evidence.readOnly = true;
      const queries = [], snapshotModule = variant === 'baseline' ? baseline : candidate;
      const proxy = {async query(...args) {
        const start = performance.now();
        const result = await client.query(...args);
        queries.push({index: queries.length + 1, queryHash: sha(typeof args[0] === 'string' ? args[0] : args[0].text), ms: round(performance.now() - start)});
        return result;
      }};
      const start = performance.now();
      const snapshot = await snapshotModule.tenantSchemaSnapshot(proxy);
      const ms = round(performance.now() - start), observed = snapshotModule.tenantSchemaFingerprint(snapshot);
      evidence.latestObservation = {variant, fingerprint: observed, commands: queries.length,
        sectionHashes: Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, sha(JSON.stringify(value))]))}; save();
      fingerprint ||= observed; reference ||= snapshot;
      if (observed !== fingerprint) {
        const differences = [];
        function compareShape(left, right, location) {
          if (JSON.stringify(left) === JSON.stringify(right)) return;
          const type = value => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
          if (type(left) !== type(right) || !left || !right || typeof left !== 'object') {
            differences.push({path: location, beforeType: type(left), afterType: type(right)}); return;
          }
          for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) compareShape(left[key], right[key], location + '.' + key);
        }
        compareShape(reference, snapshot, 'snapshot'); evidence.parityDifferences = differences.slice(0, 40); save();
      }
      assert.equal(observed, fingerprint, 'SNAPSHOT_PARITY_OR_SCHEMA_DRIFT');
      await client.query('ROLLBACK'); opened = false;
      evidence[phase].push({variant, pair, ms, fingerprint: observed, commands: queries.length, queries}); save();
      console.log(JSON.stringify({phase, variant, pair, ms, commands: queries.length}));
    }
    for (const variant of compare ? ['baseline', 'candidate'] : ['baseline']) await sample(variant, 'warmups', 0);
    for (let pair = 1; pair <= (compare ? 10 : 5); pair++) {
      for (const variant of compare ? (pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) : ['baseline']) await sample(variant, 'samples', pair);
    }
    assert.equal(sha(fs.readFileSync(statePath)), configHash, 'CONFIGURATION_DRIFT');
    assert.equal(sha(fs.readFileSync(sourcePath)), evidence.candidateSha256, 'SOURCE_DRIFT');
    evidence.summary = Object.fromEntries((compare ? ['baseline', 'candidate'] : ['baseline']).map(variant =>
      [variant, distribution(evidence.samples.filter(row => row.variant === variant).map(row => row.ms))]));
    evidence.passed = true;
  } catch (error) { evidence.passed = false; evidence.error = 'SNAPSHOT_MEASUREMENT_FAILED';
    evidence.errorCode = /^[A-Z0-9_]{1,50}$/.test(error.code || '') ? error.code : 'UNCLASSIFIED';
    evidence.parityFailure = String(error.message).includes('SNAPSHOT_PARITY_OR_SCHEMA_DRIFT'); process.exitCode = 1; }
  finally {
    let cleanupFailed = false;
    try { if (opened) await client.query('ROLLBACK'); } catch { cleanupFailed = true; }
    try { await client?.end(); } catch { cleanupFailed = true; }
    evidence.cleanup = !cleanupFailed;
    if (cleanupFailed) process.exitCode = 1;
    save(); console.log(JSON.stringify({passed: evidence.passed, cleanup: evidence.cleanup, output: path.relative(root, out), summary: evidence.summary}));
  }
})();
