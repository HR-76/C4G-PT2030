const { canonicalizeJcs1, plain } = require('./canonicalJson');
const { sha256 } = require('./integrity');

function encodeCursor({ organizationId, acceptedAt, eventId, filters }) {
  const value = { version: 1, organizationId, acceptedAt, eventId, filtersDigest: sha256(canonicalizeJcs1(filters)) };
  return Buffer.from(canonicalizeJcs1(value), 'utf8').toString('base64url');
}
function decodeCursor(cursor, { organizationId, filters }) {
  if (typeof cursor !== 'string' || cursor.length > 1024) throw new TypeError('Audit cursor is invalid.');
  let value; try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new TypeError('Audit cursor is invalid.'); }
  if (!plain(value) || Reflect.ownKeys(value).length !== 5 || value.version !== 1 || value.organizationId !== organizationId
    || value.filtersDigest !== sha256(canonicalizeJcs1(filters)) || typeof value.acceptedAt !== 'string' || typeof value.eventId !== 'string') throw new TypeError('Audit cursor context mismatch.');
  return Object.freeze(value);
}
module.exports = { decodeCursor, encodeCursor };
