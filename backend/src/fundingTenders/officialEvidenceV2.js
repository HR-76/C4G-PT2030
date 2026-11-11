'use strict';
const { createHash } = require('node:crypto');
const { cloneData, deepFreeze } = require('../opportunities/v2/data');
const { normalizers: n } = require('../opportunities/v2');
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCUMENTS = Object.freeze({
  INTERREG_EUROPE: [{ url: 'https://www.interregeurope.eu/sites/default/files/2024-08/Calls_planning_web.xlsx', mediaType: XLSX }],
  POCTEP: [{ url: 'https://www.poctep.eu/wp-json/wp/v2/pages/2831', mediaType: 'application/json' }, { url: 'https://www.poctep.eu/wp-json/wp/v2/pages/9396', mediaType: 'application/json' }]
});
const sha = value => createHash('sha256').update(value).digest('hex');
function invalid(code = 'OFFICIAL_V2_EVIDENCE_INVALID') { throw Object.assign(new Error('Official programme evidence is invalid.'), { code }); }
function keys(value, expected) { return value && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function createOfficialProgrammeEvidenceV2(input) {
  const data = cloneData(input, { maxBytes: MAX_EVIDENCE_BYTES });
  if (!keys(data, ['source', 'observedAt', 'documents']) || !Object.hasOwn(DOCUMENTS, data.source) || n.instant(data.observedAt) !== data.observedAt
    || !Array.isArray(data.documents) || !data.documents.length || data.documents.length > DOCUMENTS[data.source].length) invalid();
  const seen = new Set(), documents = data.documents.map(item => {
    if (!keys(item, ['url', 'mediaType', 'bodyBase64']) || seen.has(item.url)) invalid();
    const allowed = DOCUMENTS[data.source].find(document => document.url === item.url);
    if (!allowed || item.mediaType !== allowed.mediaType || typeof item.bodyBase64 !== 'string' || !item.bodyBase64.length) invalid();
    const bytes = Buffer.from(item.bodyBase64, 'base64');
    if (bytes.toString('base64') !== item.bodyBase64) invalid();
    seen.add(item.url);
    return { ...item, bytes: bytes.length, sha256: sha(bytes) };
  }).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  if (!seen.has(DOCUMENTS[data.source][0].url)) invalid();
  const result = { version: 1, source: data.source, observedAt: data.observedAt, documents };
  result.fingerprint = sha(JSON.stringify(result));
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_EVIDENCE_BYTES) invalid('OFFICIAL_V2_EVIDENCE_TOO_LARGE');
  return deepFreeze(result);
}
function verifyOfficialProgrammeEvidenceV2(input) {
  const value = cloneData(input, { maxBytes: MAX_EVIDENCE_BYTES });
  if (!keys(value, ['version', 'source', 'observedAt', 'documents', 'fingerprint']) || value.version !== 1 || !Array.isArray(value.documents)) invalid();
  for (const doc of value.documents) if (!keys(doc, ['url', 'mediaType', 'bodyBase64', 'bytes', 'sha256'])) invalid();
  const rebuilt = createOfficialProgrammeEvidenceV2({ source: value.source, observedAt: value.observedAt,
    documents: value.documents.map(({ url, mediaType, bodyBase64 }) => ({ url, mediaType, bodyBase64 })) });
  if (rebuilt.fingerprint !== value.fingerprint || rebuilt.documents.some((document, index) =>
    Object.keys(document).some(key => document[key] !== value.documents[index]?.[key]))) invalid();
  return rebuilt;
}
module.exports = { createOfficialProgrammeEvidenceV2, verifyOfficialProgrammeEvidenceV2, MAX_EVIDENCE_BYTES, DOCUMENTS, invalid };
