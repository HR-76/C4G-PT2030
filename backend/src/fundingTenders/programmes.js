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
// Staging collection, with the number of results the approval names. The EU Funding & Tenders source only, unless the approval
// names all of them: then the two EU programme selections (CORDIS, Erasmus+) and the two official programmes (Interreg Europe,
// POCTEP) are admitted as well, each with the same limits.
const STAGING_ALL_SOURCES = 'staging-all-sources-100';
const STAGING_APPROVALS = Object.freeze({ 'staging-eu-funding-tenders-5': 5, 'staging-eu-funding-tenders-100': 100, [STAGING_ALL_SOURCES]: 100 });
function validateSelection(code) {
  if (OFFICIAL.includes(code)) return code;
  selection(code); return code;
}
function selection(code = 'EU_FUNDING_TENDERS') {
  if (typeof code !== 'string' || !Object.hasOwn(PROGRAMMES, code)) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  return PROGRAMMES[code];
}
function collectionPolicy(sourceMode, approval) {
  if (sourceMode === 'live-staging') {
    if (!Object.hasOwn(STAGING_APPROVALS, approval)) throw Object.assign(new Error('FUNDING_STAGING_APPROVAL_INVALID'), { code: 'FUNDING_STAGING_APPROVAL_INVALID' });
    const results = STAGING_APPROVALS[approval];
    return { sources: approval === STAGING_ALL_SOURCES ? [...Object.keys(PROGRAMMES), ...OFFICIAL] : ['EU_FUNDING_TENDERS'], limits: { results, pageSize: results, pages: 1 } };
  }
  const official = sourceMode === 'live-local' && approval === OFFICIAL_APPROVAL;
  const expanded = official || sourceMode === 'live-local' && approval === EXPANDED_APPROVAL;
  return { sources: official ? [...Object.keys(PROGRAMMES), ...OFFICIAL] : expanded ? Object.keys(PROGRAMMES) : ['EU_FUNDING_TENDERS'],
    // One request of 100 (the provider maximum) instead of four of 25.
    limits: expanded ? { results: 100, pageSize: 100, pages: 1 } : { results: 5, pageSize: 5, pages: 1 } };
}
module.exports = { PROGRAMMES, EXPANDED_APPROVAL, OFFICIAL_APPROVAL, STAGING_APPROVALS, STAGING_ALL_SOURCES, selection, validateSelection, collectionPolicy };
