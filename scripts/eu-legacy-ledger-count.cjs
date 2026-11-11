'use strict';
// Read-only aggregate of real OIDC prearchive events. No actor or session data.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !/^[a-f0-9-]{36}$/.test(argv[0])) throw Error('PACKAGE_INVALID');
  const packageId = argv[0];
  const plan = JSON.parse(fs.readFileSync(path.join(cfg.root, 'output', `eu-legacy-preapproval-${packageId}`, 'plan.json')));
  if (plan.packageId !== packageId) throw Error('PACKAGE_INVALID');
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000' });
  try {
    const result = await pool.query(`SELECT count(*)::int AS events,
      count(DISTINCT event_data#>>'{resource,id}')::int AS identities,
      min(accepted_at) AS first_at,max(accepted_at) AS last_at
      FROM audit.event WHERE accepted_at >= $1 AND accepted_at <= $2
       AND event_code='SENSITIVE_ACTION_ALLOWED'
       AND event_data->>'source'='EU_LEGACY_PREARCHIVE'
       AND event_data#>>'{payload,detailCode}'='EU_LEGACY_PREARCHIVE_APPROVED'`,
    [plan.createdAt, plan.expiresAt]);
    console.log(JSON.stringify({ packageId, ...result.rows[0], databaseWrites: 0 }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_LEDGER_COUNT_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
