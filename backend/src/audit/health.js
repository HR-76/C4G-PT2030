const STATES = Object.freeze(['READY', 'CATALOG_INVALID', 'SCHEMA_INCOMPATIBLE', 'PREFLIGHT_FAILED', 'CHAIN_MISMATCH', 'RECONCILIATION_LATE', 'DEPENDENCY_UNAVAILABLE']);
function auditHealth(state, reasonCode = null) { if (!STATES.includes(state) || (reasonCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode))) throw new TypeError('Audit health state is invalid.'); return Object.freeze({ ready: state === 'READY', state, reasonCode }); }
module.exports = { STATES, auditHealth };
