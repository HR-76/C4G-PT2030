const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const pkg = require('../node_modules/pg-boss/package.json');
  if (pkg.version !== '12.37.0') throw new Error('Unexpected pg-boss package version.');
  const { getConstructionPlans } = await import('pg-boss');
  const sql = getConstructionPlans('pgboss', { createSchema: true }).replace(/\r\n/g, '\n');
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  if (digest !== 'e0cc78ee2a2fed4b42d479a9ae2af65e2ca5b21f980afa41fb880e2eb6ffebbb') throw new Error('Unexpected pg-boss construction plan digest.');
  const target = path.resolve(__dirname, '../database/central/pgboss/045_pg_boss_12_37_0.sql');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const normalized = sql.split('\n').map(line => line.trimEnd()).join('\n').trimEnd() + '\n';
  fs.writeFileSync(target, `-- Generated from pg-boss 12.37.0 getConstructionPlans(); schema version 45.\n-- Upstream plan SHA-256 before whitespace normalization: ${digest}\n${normalized}`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode=1; });
