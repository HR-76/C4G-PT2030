'use strict';

// One definition of "the pg-boss schema is usable" for every worker composition: exactly one version row
// that the adapter's guard can compare, and every queue the worker publishes to or consumes from present.
// `drift` is true for anything the guard must refuse; the adapter then fails closed at startup.
async function inspectPgBossSchema(db, queueNames) {
  if (!db || typeof db.query !== 'function' || !Array.isArray(queueNames) || queueNames.some(name => typeof name !== 'string' || !name)) {
    throw new TypeError('pg-boss schema inspection input is invalid.');
  }
  const versionRows = (await db.query('SELECT version FROM pgboss.version')).rows;
  const version = versionRows.length === 1 && versionRows[0].version !== null ? Number(versionRows[0].version) : Number.NaN;
  let missingQueues = [];
  if (queueNames.length) {
    const present = new Set((await db.query('SELECT name FROM pgboss.queue WHERE name=ANY($1::text[])', [queueNames])).rows.map(row => row.name));
    missingQueues = queueNames.filter(name => !present.has(name));
  }
  const validVersion = Number.isSafeInteger(version);
  return Object.freeze({
    schema: 'pgboss',
    schemaVersion: validVersion ? version : null,
    drift: !validVersion || missingQueues.length > 0,
    missingQueues: Object.freeze(missingQueues)
  });
}

module.exports = Object.freeze({ inspectPgBossSchema });
