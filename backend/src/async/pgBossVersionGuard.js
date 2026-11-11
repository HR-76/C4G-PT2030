const EXPECTED = Object.freeze({ packageVersion:'12.37.0', schemaVersion:45, schema:'pgboss' });
function assertPgBossCompatibility(actual) { if (!actual || actual.packageVersion!==EXPECTED.packageVersion || actual.schemaVersion!==EXPECTED.schemaVersion || actual.schema!==EXPECTED.schema || actual.drift===true) throw new Error('ASYNC_QUEUE_SCHEMA_INCOMPATIBLE'); return true; }
module.exports = { EXPECTED, assertPgBossCompatibility };
