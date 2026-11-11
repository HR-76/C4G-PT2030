'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const checksum = 'b8a717d9db5753f85c2d6c0df0295ff79a955b339d63766cc3fa32e934425927';
// Prepared additive package only; application startup never applies database changes.
function load(readSql = file => fs.readFileSync(file, 'utf8')) {
  const sql = readSql(path.join(__dirname, '../../database/central/candidates/member_email_delivery.up.sql')).replace(/\r\n/g, '\n');
  if (crypto.createHash('sha256').update(sql).digest('hex') !== checksum) throw Error('MEMBER_EMAIL_SECURITY_CHECKSUM');
  return { sql, checksum };
}
module.exports = { load };
