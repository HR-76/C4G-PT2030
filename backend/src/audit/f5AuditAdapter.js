const { AUDIT_CLASSES } = require('../authorization/audit');
const { createAuditEvent } = require('./event');

function createF5AuditAdapter({ appendService, outboxPort, metrics, clock }) {
  if (!appendService || !outboxPort || !clock) throw new TypeError('F5 audit adapter dependencies are invalid.');
  async function accept({ trustedContext, input, transaction = null }) {
    const candidate = createAuditEvent({ trustedContext, input, clock });
    const category = candidate.event.auditClass;
    try {
      if (transaction) return await appendService.append(candidate, transaction);
      if (category === AUDIT_CLASSES.CRITICAL) {
        const receipt = await outboxPort.persistAuditIntent(candidate);
        if (!receipt || receipt.status !== 'ACCEPTED') throw new Error('AUDIT_CRITICAL_UNAVAILABLE');
        return receipt;
      }
      if (category === AUDIT_CLASSES.OBSERVATIONAL) return await outboxPort.persistAuditIntent(candidate, { deadlineSeconds: 300 });
      return outboxPort.persistAuditIntent(candidate).catch(() => Object.freeze({ status: 'DENY_AUDIT_UNAVAILABLE' }));
    } catch {
      metrics?.record?.({ operation: 'append', result: 'rejected', auditClass: category });
      if (category === AUDIT_CLASSES.CRITICAL) throw Object.assign(new Error('Critical audit evidence was not accepted.'), { code: 'AUDIT_CRITICAL_UNAVAILABLE' });
      return Object.freeze({ status: category === AUDIT_CLASSES.DENY ? 'DENY_AUDIT_UNAVAILABLE' : 'RECONCILIATION_REQUIRED' });
    }
  }
  function outside(eventCode) { return Object.freeze({ status: 'OUTSIDE_F7', eventCode, persistenceGuaranteed: false }); }
  return Object.freeze({ accept, outside });
}
module.exports = { createF5AuditAdapter };
