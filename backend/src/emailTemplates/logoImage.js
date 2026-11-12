'use strict';

const { createHash } = require('node:crypto');
const { fail } = require('./contracts');

const LOGO_LIMITS = Object.freeze({ bytes: 512 * 1024, width: 1200, height: 600 });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function pngSize(bytes) {
  if (bytes.length < 8 + 25 + 12) return null;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  if (!bytes.subarray(bytes.length - 12).equals(PNG_END)) return null;
  return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start of scan: frame headers come before it, so none was found.
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const frameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frameHeader) {
      if (length < 7) return null;
      return { mime: 'image/jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

// Decides from the bytes, never from a file name or a declared type, whether
// an upload is an acceptable logo. The image is not re-encoded.
function inspectLogo(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) fail('EMAIL_LOGO_INVALID');
  if (input.length > LOGO_LIMITS.bytes) fail('EMAIL_LOGO_TOO_LARGE');
  const found = pngSize(input) || jpegSize(input);
  if (!found || found.width < 1 || found.height < 1) fail('EMAIL_LOGO_INVALID');
  if (found.width > LOGO_LIMITS.width || found.height > LOGO_LIMITS.height) fail('EMAIL_LOGO_DIMENSIONS');
  return Object.freeze({
    ...found,
    size: input.length,
    sha256: createHash('sha256').update(input).digest('hex')
  });
}

module.exports = { inspectLogo, LOGO_LIMITS };
