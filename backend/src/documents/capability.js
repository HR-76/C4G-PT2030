const crypto = require('node:crypto');
const { LIMITS } = require('./constants');
function digest(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function issueUploadCapability({ binding, clock = () => new Date(), randomBytes = crypto.randomBytes }) {
  const now = clock(); const token = randomBytes(32).toString('base64url');
  if (!binding || !binding.organizationId || !binding.actorId || !binding.documentId || !binding.versionId) throw new TypeError('Upload capability binding is invalid.');
  return Object.freeze({ token, persisted: Object.freeze({ digest: digest(token), ...binding, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + LIMITS.uploadCapabilityMs).toISOString(), consumedAt: null, revokedAt: null }) });
}
function verifyUploadCapability(token, record, { clock = () => new Date() } = {}) {
  const expiresAt=record&&Date.parse(record.expiresAt);
  if (typeof token !== 'string' || !record || !Number.isFinite(expiresAt) || record.consumedAt || record.revokedAt || expiresAt <= clock().getTime()) throw new Error('UPLOAD_CAPABILITY_INVALID');
  const actual = Buffer.from(digest(token), 'hex'); const expected = Buffer.from(record.digest, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error('UPLOAD_CAPABILITY_INVALID');
  return true;
}
module.exports = { digest, issueUploadCapability, verifyUploadCapability };
