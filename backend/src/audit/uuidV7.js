const crypto = require('node:crypto');
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createUuidV7({ now = Date.now, randomBytes = crypto.randomBytes } = {}) {
  const milliseconds = now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffffffff) throw new TypeError('UUIDv7 clock is invalid.');
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(milliseconds, 0, 6);
  randomBytes(10).copy(bytes, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuidV7(value) { return typeof value === 'string' && UUID_V7.test(value); }
module.exports = { createUuidV7, isUuidV7 };
