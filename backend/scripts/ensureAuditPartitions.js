'use strict';

// Creates upcoming monthly audit.event partitions in ONE database. Run it monthly (or at deploy)
// against the central database and against each tenant database, logging in as a member of
// c4g_audit_migrator. Exit code 2 means rows are already in the DEFAULT partition.
//   AUDIT_PARTITION_DATABASE_URL        required connection string (never printed)
//   AUDIT_PARTITION_MONTHS_AHEAD        optional, 1-24, default 3
const { Client } = require('pg');
const { ensureAuditPartitions } = require('../src/audit/partitionMaintenance');

async function main(env = process.env) {
  const connectionString = env.AUDIT_PARTITION_DATABASE_URL;
  if (!connectionString) throw new Error('AUDIT_PARTITION_DATABASE_URL is required.');
  const monthsAhead = env.AUDIT_PARTITION_MONTHS_AHEAD === undefined ? 3 : Number(env.AUDIT_PARTITION_MONTHS_AHEAD);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await ensureAuditPartitions(client, { monthsAhead });
    console.log(JSON.stringify({ created: result.created, defaultRows: result.defaultRows }));
    return result.defaultRows > 0 ? 2 : 0;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`Audit partition maintenance failed: ${error.code || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
