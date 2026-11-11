const { validateQuery } = require('./queryPort');

const LIMITS = Object.freeze({ maxRows: 100000, maxBytes: 100 * 1024 * 1024 });
function createAuditExportService({ authorization, audit, queue, sink }) {
  if (![authorization, audit, queue, sink].every(Boolean)) throw new TypeError('Audit export dependencies are invalid.');
  async function request(request, trustedContext) {
    const query = validateQuery(request, trustedContext);
    await authorization.require('audit_event.export', trustedContext);
    await audit.acceptCritical('EXPORT_ALLOWED', trustedContext);
    return queue.publish(Object.freeze({ type: 'audit.export.v1', organizationId: trustedContext.organizationId,
      limits: LIMITS, filters: query.filters, cursor: request.cursor || null }));
  }
  async function execute(job, trustedContext, signal) {
    await authorization.require('audit_event.export', trustedContext);
    await audit.acceptCritical('EXPORT_ALLOWED', trustedContext);
    if (signal?.aborted) throw Object.assign(new Error('Audit export cancelled.'), { code: 'CANCELLED' });
    return sink.consume({ ...job, limits: LIMITS, signal });
  }
  return Object.freeze({ execute, request });
}
module.exports = { LIMITS, createAuditExportService };
