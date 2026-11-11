const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../database');
const manifest = Object.freeze({
  central: Object.freeze({ version: '005_f7_append_only_audit', checksum: 'e8f6525bf4b69bc5c0c9a44f06b832c7ce979e1b72ac8b1b89ce475d5a6b62ff', schemaFingerprint: 'f7-audit-schema-v1-e8f6525bf4b69bc5' }),
  tenant: Object.freeze({ version: '002_f7_append_only_audit', checksum: 'e8f6525bf4b69bc5c0c9a44f06b832c7ce979e1b72ac8b1b89ce475d5a6b62ff', schemaFingerprint: 'f7-audit-schema-v1-e8f6525bf4b69bc5' })
});
function canonical(sql) { return sql.replace(/\r\n/g, '\n'); }
function digest(sql) { return crypto.createHash('sha256').update(canonical(sql), 'utf8').digest('hex'); }
function load(scope, direction = 'up') {
  if (!['central', 'tenant'].includes(scope) || !['up', 'down'].includes(direction)) throw new TypeError('F7 migration key is invalid.');
  const entry = manifest[scope];
  const sql = canonical(fs.readFileSync(path.join(ROOT, scope, 'migrations', `${entry.version}.${direction}.sql`), 'utf8'));
  if (direction === 'up' && digest(sql) !== entry.checksum) throw new Error('F7 migration checksum mismatch.');
  return Object.freeze({ entry, sql, checksum: digest(sql) });
}
module.exports = { canonical, digest, load, manifest };
