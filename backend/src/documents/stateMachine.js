const { DOCUMENT_STATES, TRANSITIONS } = require('./constants');
function transition(current, next, { scanState = null } = {}) {
  if (!DOCUMENT_STATES.includes(current) || !DOCUMENT_STATES.includes(next) || !TRANSITIONS[current].includes(next)) throw new Error('DOCUMENT_TRANSITION_NOT_ALLOWED');
  if (next === 'AVAILABLE' && scanState !== 'CLEAN') throw new Error('DOCUMENT_SCAN_CLEAN_REQUIRED');
  return next;
}
function isDownloadable(record) { return Boolean(record && record.state === 'AVAILABLE' && (record.scanState ?? record.scan_state) === 'CLEAN'); }
module.exports = { isDownloadable, transition };
