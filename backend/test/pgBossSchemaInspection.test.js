'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectPgBossSchema } = require('../src/async/pgBossSchemaInspection');
const { EXPECTED, assertPgBossCompatibility } = require('../src/async/pgBossVersionGuard');

// Four workers used to inspect the pg-boss schema four different ways: only one of them checked that its
// queues exist, one hard-coded `drift:false`. A single inspection keeps them equally strict.
function db({ versionRows = [{ version: 45 }], queueRows = [] } = {}) {
  const statements = [];
  return {
    statements,
    async query(sql, values) {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (/FROM pgboss\.version/.test(sql)) return { rows: versionRows };
      if (/FROM pgboss\.queue/.test(sql)) return { rows: queueRows };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}
const compatible = inspection => assertPgBossCompatibility({ ...inspection, packageVersion: EXPECTED.packageVersion });

test('a complete schema is reported with its numeric version and no drift', async () => {
  const names = ['c4g.a', 'c4g.b'];
  const client = db({ queueRows: names.map(name => ({ name })) });
  const inspection = await inspectPgBossSchema(client, names);
  assert.deepEqual(inspection, { schema: 'pgboss', schemaVersion: 45, drift: false, missingQueues: [] });
  assert.deepEqual(client.statements[1].values, [names]);
  assert.doesNotThrow(() => compatible(inspection));
});

test('a missing queue is drift and is named, so startup can refuse instead of failing at publish time', async () => {
  const inspection = await inspectPgBossSchema(db({ queueRows: [{ name: 'c4g.a' }] }), ['c4g.a', 'c4g.b']);
  assert.equal(inspection.drift, true);
  assert.deepEqual(inspection.missingQueues, ['c4g.b']);
  assert.throws(() => compatible(inspection), /ASYNC_QUEUE_SCHEMA_INCOMPATIBLE/);
});

test('an absent, duplicated or non-numeric version row is drift, never a silent pass', async () => {
  for (const versionRows of [[], [{ version: 45 }, { version: 45 }], [{ version: 'abc' }], [{ version: null }]]) {
    const inspection = await inspectPgBossSchema(db({ versionRows }), []);
    assert.equal(inspection.drift, true, JSON.stringify(versionRows));
    assert.throws(() => compatible(inspection), /ASYNC_QUEUE_SCHEMA_INCOMPATIBLE/);
  }
});

test('an unsupported schema version is reported as is, for the guard to refuse', async () => {
  const inspection = await inspectPgBossSchema(db({ versionRows: [{ version: 44 }] }), []);
  assert.equal(inspection.schemaVersion, 44);
  assert.throws(() => compatible(inspection), /ASYNC_QUEUE_SCHEMA_INCOMPATIBLE/);
});

test('without queue names only the version is read', async () => {
  const client = db();
  const inspection = await inspectPgBossSchema(client, []);
  assert.equal(inspection.drift, false);
  assert.equal(client.statements.length, 1);
});

test('the inspection refuses invalid input before touching the database', async () => {
  const client = db();
  await assert.rejects(() => inspectPgBossSchema(null, []), TypeError);
  await assert.rejects(() => inspectPgBossSchema(client, 'c4g.a'), TypeError);
  await assert.rejects(() => inspectPgBossSchema(client, [42]), TypeError);
  assert.equal(client.statements.length, 0);
});

test('every pg-boss worker composition uses the shared inspection', () => {
  const root = path.resolve(__dirname, '../src');
  for (const file of ['config/documentWorkerInfrastructure.js', 'config/fundingTendersWorker.js',
    'config/opportunityImportWorkerInfrastructure.js', 'config/opportunityReceiptWorkerInfrastructure.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /inspectPgBossSchema\(/, file);
    assert.doesNotMatch(source, /SELECT version FROM pgboss\.version/, `${file} still inspects the schema by hand`);
    assert.doesNotMatch(source, /drift:\s*false/, `${file} still hard-codes drift`);
  }
});
