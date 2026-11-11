const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TENANT_MIGRATION_OWNERSHIP,
  boundedTask,
  createTenantMigrationRunner
} = require('../src/security/tenantMigrationRunner');
const { isTenantMigrationFailure } = require('../src/security/tenantMigrationErrors');
const { manifest, migrationSql, SUPPORTED_TENANT_DOWNGRADE } = require('../src/security/tenantMigrationManifest');
const { createTenantSchemaObservationPublisher } = require('../src/security/tenantSchemaObservationPublisher');
const { createManualClock, createManualScheduler } = require('./support/tenantRuntimeDoubles');

const request = Object.freeze({
  tenantId: '43000000-0000-4000-8000-000000000001',
  databaseGenerationId: '43000000-0000-4000-8000-000000000002',
  expectedRevision: 1,
  correlationId: 'f43-synthetic-correlation',
  idempotencyKey: 'f43-synthetic-idempotency'
});
function evidence() {
  return Object.freeze({
    tenantId: request.tenantId,
    databaseGenerationId: request.databaseGenerationId,
    currentVersion: manifest[0].version,
    schemaFingerprint: manifest[0].schemaFingerprint,
    capabilities: Object.freeze(['TENANT_CONTROL_BASELINE'])
  });
}

function ownershipFixture(ownerName = 'c4g_tenant_owner') {
  const entries = Object.freeze(manifest.slice(0, 6));
  const queries = [];
  let preflightCalls = 0;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (String(sql).includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
      if (String(sql).includes("to_regclass('c4g_system.tenant_identity')")) {
        return { rows: [{ marker_exists: true, ledger_exists: true }] };
      }
      if (String(sql).includes('SELECT migration_id')) {
        return { rows: entries.slice(0, 5).map(entry => ({
          migration_id: entry.version,
          ordinal: entry.ordinal,
          checksum_sha256: entry.sqlChecksum,
          irreversible: entry.irreversible,
          resulting_fingerprint: entry.schemaFingerprint
        })) };
      }
      if (String(sql).includes('FROM pg_catalog.pg_proc')) {
        return { rows: [{
          selected_role: 'c4g_tenant_owner',
          owner_name: ownerName,
          language: 'plpgsql',
          security_definer: false,
          configuration: 'search_path=pg_catalog, async_exec'
        }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const currentEvidence = () => {
    const entry = preflightCalls++ === 0 ? entries[4] : entries[5];
    return Object.freeze({
      tenantId: request.tenantId,
      databaseGenerationId: request.databaseGenerationId,
      currentVersion: entry.version,
      schemaFingerprint: entry.schemaFingerprint,
      capabilities: entry.capabilities
    });
  };
  const runner = createTenantMigrationRunner({
    pool: { async connect() { return client; } },
    entries,
    observationPublisher: { async publish() {} },
    timeoutMs: 1000,
    scheduler: { setTimeout, clearTimeout },
    runPreflightClient: async () => currentEvidence(),
    runPreflight: async () => currentEvidence(),
    fingerprintSchema: async () => entries[5].schemaFingerprint
  });
  return { queries, runner };
}

test('migration 005 ownership contract is exact, immutable and scoped to one function', () => {
  assert.equal(Object.isFrozen(TENANT_MIGRATION_OWNERSHIP), true);
  assert.deepEqual(TENANT_MIGRATION_OWNERSHIP, {
    '005_f9_execution_lineage': {
      alter: 'ALTER FUNCTION async_exec.guard_outbox_lineage_v1() OWNER TO c4g_tenant_owner',
      role: 'c4g_tenant_owner',
      functionIdentity: 'async_exec.guard_outbox_lineage_v1()'
    }
  });
});

test('migration 005 restores the migration role and rejects a non-canonical owner', async () => {
  const accepted = ownershipFixture();
  const result = await accepted.runner.migrate(request);
  assert.deepEqual(result.appliedVersions, ['005_f9_execution_lineage']);
  const alter = accepted.queries.indexOf(TENANT_MIGRATION_OWNERSHIP['005_f9_execution_lineage'].alter);
  const setRole = accepted.queries.indexOf('SET LOCAL ROLE c4g_tenant_owner', alter);
  const verification = accepted.queries.findIndex((query, index) => index > setRole
    && String(query).includes('FROM pg_catalog.pg_proc'));
  const resetRole = accepted.queries.indexOf('RESET ROLE', verification);
  const ledger = accepted.queries.findIndex((query, index) => index > resetRole
    && String(query).includes('INSERT INTO c4g_system.schema_migration'));
  assert.ok(alter >= 0 && alter < setRole && setRole < verification
    && verification < resetRole && resetRole < ledger);

  const rejected = ownershipFixture('c4g_f12_admin');
  await assert.rejects(() => rejected.runner.migrate(request), error =>
    error.internalCode === 'TENANT_MIGRATION_OWNER_MISMATCH');
  assert.ok(rejected.queries.indexOf('RESET ROLE') < rejected.queries.indexOf('ROLLBACK'));
  assert.equal(rejected.queries.some(query => String(query).includes(
    'INSERT INTO c4g_system.schema_migration')), false);
});

function downgradeFixture({ failDelete = false, uncertainCommit = false, corruptDown = false } = {}) {
  const queries = [], publications = [];
  let count = 8;
  const observed = () => ({ tenantId: request.tenantId, databaseGenerationId: request.databaseGenerationId,
    currentVersion: manifest[count - 1].version, schemaFingerprint: manifest[count - 1].schemaFingerprint });
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
    if (sql.includes('to_regclass')) return { rows: [{ marker_exists: true, ledger_exists: true }] };
    if (sql.includes('SELECT migration_id')) return { rows: manifest.slice(0, count).map(entry => ({
      migration_id: entry.version, ordinal: entry.ordinal, checksum_sha256: entry.sqlChecksum,
      irreversible: entry.irreversible, resulting_fingerprint: entry.schemaFingerprint })) };
    if (sql.startsWith('DELETE FROM')) { if (failDelete) throw new Error('synthetic'); count = 7; return { rows: [], rowCount: 1 }; }
    if (sql === 'COMMIT' && uncertainCommit) throw new Error('synthetic');
    return { rows: [] };
  }, release() {} };
  const runner = createTenantMigrationRunner({ pool: { async connect() { return client; } }, entries: Object.freeze(manifest.slice(0, 8)),
    observationPublisher: { async publish(value) { publications.push(value); } }, scheduler: { setTimeout, clearTimeout }, timeoutMs: 1000,
    runPreflightClient: async () => observed(), runPreflight: async () => observed(),
    fingerprintSchema: async () => manifest[6].schemaFingerprint,
    loadMigration(version, direction) { const loaded = migrationSql(version, direction);
      return corruptDown && version === manifest[7].version && direction === 'down' ? { ...loaded, checksum: '0'.repeat(64) } : loaded; } });
  return { runner, queries, publications };
}

test('canonical downgrade is limited to 007->006 and rejects other targets before connection', async () => {
  const state = downgradeFixture();
  for (const targetVersion of [undefined, manifest[5].version, manifest[7].version]) {
    await assert.rejects(() => state.runner.downgrade({ ...request, targetVersion }), /not supported/);
  }
  assert.deepEqual(state.queries, []);
  assert.equal(SUPPORTED_TENANT_DOWNGRADE.downChecksum, migrationSql(manifest[7].version, 'down').checksum);
});

test('canonical downgrade checks down source, locked ledger, target preflight and revision publication', async () => {
  const state = downgradeFixture();
  const result = await state.runner.downgrade({ ...request, targetVersion: manifest[6].version, expectedRevision: 3 });
  assert.deepEqual(result.revertedVersions, [manifest[7].version]);
  assert.equal(result.evidence.currentVersion, manifest[6].version);
  assert.equal(state.publications[0].expectedRevision, 3);
  assert.ok(state.queries.indexOf('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER schema_migration_append_only') < state.queries.indexOf('COMMIT'));
  const bad = downgradeFixture({ corruptDown: true });
  await assert.rejects(() => bad.runner.downgrade({ ...request, targetVersion: manifest[6].version }), error => error.internalCode === 'MIGRATION_CHECKSUM_MISMATCH');
  assert.equal(bad.queries.includes(migrationSql(manifest[7].version, 'down').sql), false);
  assert.equal(bad.publications.length, 0);
});

test('canonical downgrade rolls back ledger failures and reconciles uncertain commit at 006', async () => {
  const failed = downgradeFixture({ failDelete: true });
  await assert.rejects(() => failed.runner.downgrade({ ...request, targetVersion: manifest[6].version }));
  assert.ok(failed.queries.includes('ROLLBACK')); assert.equal(failed.publications.length, 0);
  const uncertain = downgradeFixture({ uncertainCommit: true });
  const result = await uncertain.runner.downgrade({ ...request, targetVersion: manifest[6].version });
  assert.equal(result.reconciled, true); assert.equal(result.evidence.currentVersion, manifest[6].version);
});

function setup({
  lock = true, failAt = null, postflight = evidence(), publishError = null, releaseError = null
} = {}) {
  const events = [];
  const client = {
    async query(sql) {
      const label = typeof sql === 'string' && sql.startsWith('-- C4G TENANT') ? 'MIGRATION_SQL' : sql;
      events.push(label);
      if (failAt && (label === failAt || (failAt === 'COMMIT' && sql === 'COMMIT'))) {
        throw new Error('postgresql://user:secret@private-host/private-db');
      }
      if (String(sql).includes('pg_try_advisory')) return { rows: [{ acquired: lock }] };
      if (String(sql).includes("to_regclass('c4g_system.tenant_identity')")) {
        return { rows: [{ marker_exists: false, ledger_exists: false }] };
      }
      return { rows: [] };
    },
    release(discardError) {
      events.push(discardError ? 'RELEASE_DISCARD' : 'RELEASE');
      if (releaseError) throw releaseError;
    }
  };
  const publications = [];
  const runner = createTenantMigrationRunner({
    pool: { async connect() { events.push('CONNECT'); return client; } },
    observationPublisher: { async publish(value) {
      events.push('PUBLISH');
      if (publishError) throw publishError;
      publications.push(value);
    } },
    timeoutMs: 25,
    scheduler: { setTimeout, clearTimeout },
    entries: Object.freeze([manifest[0]]),
    validateDatabase: async () => { events.push('DATABASE_CONTRACT'); },
    fingerprintSchema: async () => { events.push('FINGERPRINT'); return manifest[0].schemaFingerprint; },
    runPreflightClient: async () => { events.push('PREFLIGHT_LOCKED'); return evidence(); },
    runPreflight: async () => {
      events.push('POSTFLIGHT');
      if (postflight instanceof Error) throw postflight;
      return postflight;
    }
  });
  return { events, publications, runner };
}

test('runner applies the allowlisted baseline under lock and publishes only after post-check', async () => {
  const state = setup();
  const result = await state.runner.migrate(request);
  assert.deepEqual(result.appliedVersions, [manifest[0].version]);
  assert.equal(result.reconciled, false);
  assert.equal(state.publications.length, 1);
  assert.ok(state.events.indexOf('PREFLIGHT_LOCKED') < state.events.indexOf('COMMIT'));
  assert.ok(state.events.indexOf('COMMIT') < state.events.indexOf('POSTFLIGHT'));
  assert.ok(state.events.indexOf('POSTFLIGHT') < state.events.indexOf('PUBLISH'));
  assert.equal(state.events.filter(event => event === 'MIGRATION_SQL').length, 1);
});

test('runner preserves a closed candidate migration loader through locked and post-commit preflight', async () => {
  const marker = () => ({ entry: manifest[0], sql: migrationSql(manifest[0].version, 'up').sql,
    checksum: manifest[0].sqlChecksum });
  const seen = [];
  const state = setup();
  state.runner = createTenantMigrationRunner({
    pool: { async connect() { return {
      async query(sql) {
        if (String(sql).includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
        if (String(sql).includes("to_regclass('c4g_system.tenant_identity')")) return { rows: [{ marker_exists: false, ledger_exists: false }] };
        return { rows: [] };
      }, release() {}
    }; } },
    entries: Object.freeze([manifest[0]]), loadMigration: marker,
    observationPublisher: { async publish() {} }, scheduler: { setTimeout, clearTimeout }, timeoutMs: 25,
    validateDatabase: async () => {}, fingerprintSchema: async () => manifest[0].schemaFingerprint,
    runPreflightClient: async (_client, _expected, _entries, loader) => { seen.push(loader); return evidence(); },
    runPreflight: async (_pool, _expected, _entries, options) => { seen.push(options.loadMigration); return evidence(); }
  });
  await state.runner.migrate(request);
  assert.deepEqual(seen, [marker, marker]);
});

test('runner refuses lock contention and sanitizes failures before publication', async () => {
  const locked = setup({ lock: false });
  await assert.rejects(locked.runner.migrate(request), error => error.internalCode === 'LOCK_CONFLICT');
  assert.equal(locked.publications.length, 0);
  const failed = setup({ failAt: 'MIGRATION_SQL' });
  await assert.rejects(failed.runner.migrate(request), error => {
    assert.equal(error.internalCode, 'TENANT_MIGRATION_MIGRATION_SQL_FAILED');
    assert.doesNotMatch(JSON.stringify(error), /secret|private-host|private-db/);
    return true;
  });
  assert.equal(failed.publications.length, 0);
});

test('uncertain commit is reconciled by physical preflight and never presumed successful', async () => {
  const reconciled = setup({ failAt: 'COMMIT' });
  const result = await reconciled.runner.migrate(request);
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.appliedVersions, []);
  assert.ok(reconciled.events.indexOf('RELEASE') < reconciled.events.indexOf('POSTFLIGHT'));
  assert.ok(reconciled.events.indexOf('POSTFLIGHT') < reconciled.events.indexOf('PUBLISH'));
  const unknown = setup({ failAt: 'COMMIT', postflight: new Error('not observable') });
  await assert.rejects(unknown.runner.migrate(request), error => error.internalCode === 'RECONCILIATION_REQUIRED');
  assert.equal(unknown.publications.length, 0);
});

test('post-check and Central publication failures remain distinct and sanitized', async () => {
  const postcheck = setup({ postflight: new Error('postgresql://secret@private/tenant') });
  await assert.rejects(postcheck.runner.migrate(request), error => error.internalCode === 'POSTCHECK_FAILED');
  const publication = setup({ publishError: new Error('central-secret-canary') });
  await assert.rejects(publication.runner.migrate(request), error => {
    assert.equal(error.internalCode, 'CENTRAL_OBSERVATION_FAILED');
    assert.doesNotMatch(JSON.stringify(error), /central-secret-canary/);
    return true;
  });
});

test('schema observation publisher emits only the approved CAS/idempotent projection', async () => {
  const calls = [];
  const publisher = createTenantSchemaObservationPublisher({ async recordObservation(value) {
    calls.push(value);
    return { revision: value.expectedRevision + 1 };
  } });
  await publisher.publish({ expectedRevision: 7, correlationId: 'c', idempotencyKey: 'i', evidence: evidence() });
  await publisher.publish({ expectedRevision: 7, correlationId: 'c', idempotencyKey: 'i', evidence: evidence() });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0].verifiedCapabilities, {
    TENANT_CONTROL_BASELINE: true,
    schemaFingerprint: manifest[0].schemaFingerprint
  });
  assert.equal(calls[0].compatibilityState, 'COMPATIBLE');
  assert.equal(calls[0].targetVersion, manifest.at(-1).version);
  assert.equal(calls[0].migrationLockRef, null);
  assert.equal(JSON.stringify(calls[0]).includes('systemIdentifier'), false);
});

test('migration async deadlines reject promptly and observe late physical completion', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let resolveLate;
  const late = new Promise(resolve => { resolveLate = resolve; });
  let releases = 0;
  const bounded = boundedTask(() => late, {
    timeoutMs: 10,
    scheduler,
    timeoutCode: 'TENANT_MIGRATION_CONNECT_TIMEOUT',
    onLateSuccess: client => client.release()
  });
  await scheduler.advance(10);
  await assert.rejects(bounded, error => error.internalCode === 'TENANT_MIGRATION_CONNECT_TIMEOUT');
  resolveLate({ release() { releases += 1; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 1);
  assert.equal(scheduler.size, 0);
});

test('runner never publishes success when rollback or client cleanup cannot be observed', async () => {
  const canary = 'postgresql://cleanup-secret@private/tenant';
  const rollback = setup({ failAt: 'ROLLBACK' });
  rollback.runner = createTenantMigrationRunner({
    pool: {
      async connect() {
        return {
          async query(sql) {
            if (String(sql).includes('pg_try_advisory')) return { rows: [{ acquired: false }] };
            if (sql === 'ROLLBACK') throw new Error(canary);
            return { rows: [] };
          },
          release() {}
        };
      }
    },
    observationPublisher: { async publish() { throw new Error('must not publish'); } },
    timeoutMs: 25,
    scheduler: { setTimeout, clearTimeout }
    , entries: Object.freeze([manifest[0]])
  });
  await assert.rejects(rollback.runner.migrate(request), error => {
    assert.equal(isTenantMigrationFailure(error), true);
    assert.deepEqual(error.errors.map(item => item.internalCode), [
      'LOCK_CONFLICT', 'TENANT_MIGRATION_ROLLBACK_FAILED'
    ]);
    assert.doesNotMatch(JSON.stringify(error), /cleanup-secret|private|tenant/);
    return true;
  });

  const release = setup({ releaseError: new Error(canary) });
  await assert.rejects(release.runner.migrate(request), error => {
    assert.equal(error.internalCode, 'TENANT_MIGRATION_CLIENT_CLEANUP_FAILED');
    assert.doesNotMatch(JSON.stringify(error), /cleanup-secret|private|tenant/);
    return true;
  });
  assert.equal(release.publications.length, 0);
});
