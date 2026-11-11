const { validateEventCatalog } = require('./eventCatalog');
const { auditHealth } = require('./health');

function validateProductionAuditBootstrap({ preflight = null } = {}) {
  validateEventCatalog();
  if (preflight && preflight.ready !== true) throw new Error('AUDIT_PREFLIGHT_REQUIRED');
  return Object.freeze({ health: auditHealth(preflight ? 'READY' : 'DEPENDENCY_UNAVAILABLE', preflight ? null : 'AUDIT_LEDGER_NOT_CONFIGURED'),
    exportConsumerEnabled: false, externalSink: null });
}
module.exports = { validateProductionAuditBootstrap };
