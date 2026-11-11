'use strict';
// Closed programme selections. All observations retain the same canonical EU identity.
const PROGRAMMES = Object.freeze({
  EU_FUNDING_TENDERS: Object.freeze([]),
  CORDIS: Object.freeze(['HORIZON', '43108390', 'EURATOM', '43298916']),
  ERASMUS: Object.freeze(['ERASMUS', '43353764'])
});
const EXPANDED_APPROVAL = 'central-programmes-100';
const OFFICIAL_APPROVAL = 'central-official-sources-100';
const { OFFICIAL } = require('./sourceIdentity');
function validateSelection(code) {
  if (OFFICIAL.includes(code)) return code;
  selection(code); return code;
}
function selection(code = 'EU_FUNDING_TENDERS') {
  if (typeof code !== 'string' || !Object.hasOwn(PROGRAMMES, code)) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  return PROGRAMMES[code];
}
function collectionPolicy(sourceMode, approval) {
  const official = sourceMode === 'live-local' && approval === OFFICIAL_APPROVAL;
  const expanded = official || sourceMode === 'live-local' && approval === EXPANDED_APPROVAL;
  return { sources: official ? [...Object.keys(PROGRAMMES), ...OFFICIAL] : expanded ? Object.keys(PROGRAMMES) : ['EU_FUNDING_TENDERS'],
    // One request of 100 (the provider maximum) instead of four of 25.
    limits: expanded ? { results: 100, pageSize: 100, pages: 1 } : { results: 5, pageSize: 5, pages: 1 } };
}
module.exports = { PROGRAMMES, EXPANDED_APPROVAL, OFFICIAL_APPROVAL, selection, validateSelection, collectionPolicy };
