'use strict';
// Read-only full 391 receipt/ledger check. This never installs 045 or archives.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createEuLegacyArchiveBatchExecutor } = require('../backend/src/opportunities/v2/euLegacyArchiveBatchExecutor');

async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && path.isAbsolute(argv[0]));
  const bytes = fs.readFileSync(argv[0]);
  assert(bytes.length > 0 && bytes.length <= 512 * 1024);
  const receiptExport = JSON.parse(bytes.toString('utf8'));
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000' });
  try {
    const batch = createEuLegacyArchiveBatchExecutor({ pool, workspaceRoot: cfg.root,
      executor: { executeOne() { throw Error('READ_ONLY_PREFLIGHT'); } } });
    const result = await batch.preflight(receiptExport);
    console.log(JSON.stringify({ status: 'LIVE_LEDGER_PREFLIGHT_PASS', ...result,
      fileSha256: createHash('sha256').update(bytes).digest('hex'), databaseWrites: 0 }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_RECEIPTS_PREFLIGHT_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
