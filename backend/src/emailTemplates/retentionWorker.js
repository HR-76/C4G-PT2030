'use strict';
// Separate capability, no HTTP listener and no provider credentials. Scheduling belongs to the operator.
async function run({ env = process.env, Pool = require('pg').Pool } = {}) {
  if (!env.CENTRAL_EMAIL_RETENTION_DATABASE_URL) throw Error('EMAIL_RETENTION_DATABASE_REQUIRED');
  const raw = new Pool({ ...require('../config/databaseConfig').databasePoolOptions(env,'CENTRAL_EMAIL_RETENTION_DATABASE_URL','CENTRAL_DB'), max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  const pool = require('../security/productionCentralProfile').createRolePool(raw, 'retention');
  try {
    await require('../security/centralMigrationPreflight').preflightCentral(pool);
    const result = await pool.query('SELECT public.email_delivery_retention() AS affected');
    return { affected: Number(result.rows[0].affected) };
  } finally { await raw.end(); }
}
if (require.main === module) run().then(result => process.stdout.write(JSON.stringify(result) + '\n'))
  .catch(() => { process.stderr.write('EMAIL_RETENTION_FAILED\n'); process.exitCode = 1; });
module.exports = { run };
