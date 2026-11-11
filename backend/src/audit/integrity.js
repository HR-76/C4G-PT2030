const crypto = require('node:crypto');
const { canonicalizeJcs1 } = require('./canonicalJson');

const CANONICALIZATION_VERSION = 'JCS-1';
const HASH_ALGORITHM = 'SHA-256';
const DOMAIN_SEPARATOR = Buffer.from('C4G-AUDIT-EVENT\0JCS-1\0SHA-256\0', 'utf8');
const GENESIS_HASH = '0'.repeat(64);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function inputDigest(event) { return sha256(Buffer.from(canonicalizeJcs1(event), 'utf8')); }
function eventHash(eventWithoutHash) {
  return sha256(Buffer.concat([DOMAIN_SEPARATOR, Buffer.from(canonicalizeJcs1(eventWithoutHash), 'utf8')]));
}
module.exports = { CANONICALIZATION_VERSION, DOMAIN_SEPARATOR, GENESIS_HASH, HASH_ALGORITHM, eventHash, inputDigest, sha256 };
