const path = require('node:path');
const { FILE_CLASSES } = require('./constants');
function sanitizeFilename(value) {
  const normalized = String(value || '').toWellFormed().normalize('NFC').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[";=]/g, '_').replace(/[\\/]+/g, '_').replace(/\.\.+/g, '.').trim();
  const base = path.win32.basename(path.posix.basename(normalized)).slice(0, 120).toWellFormed();
  return base && base !== '.' ? base : 'document';
}
function detectContent(prefix) {
  if (!Buffer.isBuffer(prefix)) throw new TypeError('Content prefix must be a buffer.');
  if (prefix.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) return Object.freeze({ fileClass: 'PDF', mime: 'application/pdf' });
  if (prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return Object.freeze({ fileClass: 'IMAGE', mime: 'image/png' });
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return Object.freeze({ fileClass: 'IMAGE', mime: 'image/jpeg' });
  if (prefix.length >= 4 && prefix.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) return Object.freeze({ fileClass: 'OOXML', mime: null, deepInspectionRequired: true });
  throw new Error('DOCUMENT_CONTENT_TYPE_UNKNOWN');
}
function validateContent({ prefix, declaredMime, filename, expectedClass }) {
  const detected = expectedClass === 'CSV' && Buffer.isBuffer(prefix) && !prefix.includes(0)
    ? Object.freeze({ fileClass: 'CSV', mime: 'text/csv', deepInspectionRequired: false }) : detectContent(prefix);
  const policy = FILE_CLASSES[expectedClass];
  if (!policy || detected.fileClass !== expectedClass || !policy.mime.includes(declaredMime)) throw new Error('DOCUMENT_CONTENT_TYPE_MISMATCH');
  const extension = sanitizeFilename(filename).split('.').pop().toLowerCase();
  if (!policy.extensions.includes(extension)) throw new Error('DOCUMENT_EXTENSION_MISMATCH');
  return Object.freeze({ ...detected, declaredMime, filename: sanitizeFilename(filename), maxBytes: policy.maxBytes });
}
module.exports = { detectContent, sanitizeFilename, validateContent };
