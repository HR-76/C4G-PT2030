const { decodeCursor } = require('./cursor');
const { assertAuditQueryPort } = require('./ports');

const FILTERS = new Set(['from', 'to', 'eventCode', 'actorType', 'outcome', 'resourceType', 'correlationId']);
const LIMITS = Object.freeze({ defaultPageSize: 50, maxPageSize: 100, maxWindowMs: 31 * 86400000, timeoutMs: 5000, maxResponseBytes: 1024 * 1024, maxExportRows: 100000, maxExportBytes: 100 * 1024 * 1024 });

function validateQuery(request, trustedContext) {
  if (!request || !trustedContext || typeof trustedContext.organizationId !== 'string') throw new TypeError('Audit query context is invalid.');
  const filters = request.filters || {};
  if (Object.keys(filters).some(key => !FILTERS.has(key))) throw new TypeError('Audit query filter is not allowlisted.');
  const from = new Date(filters.from); const to = new Date(filters.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to - from > LIMITS.maxWindowMs) throw new TypeError('Audit query window is invalid.');
  const pageSize = request.pageSize === undefined ? LIMITS.defaultPageSize : request.pageSize;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > LIMITS.maxPageSize) throw new TypeError('Audit page size is invalid.');
  const cursor = request.cursor ? decodeCursor(request.cursor, { organizationId: trustedContext.organizationId, filters }) : null;
  return Object.freeze({ organizationId: trustedContext.organizationId, filters: Object.freeze({ ...filters }), pageSize, cursor,
    order: Object.freeze(['accepted_at DESC', 'event_id DESC']), timeoutMs: LIMITS.timeoutMs, maxResponseBytes: LIMITS.maxResponseBytes });
}

function createAuditQueryService({ authorization, queryPort, auditCoordinator, telemetryPort = null }) {
  assertAuditQueryPort(queryPort);
  if (!authorization || !auditCoordinator) throw new TypeError('Audit query service dependencies are invalid.');
  async function list(request, trustedContext) {
    const query = validateQuery(request, trustedContext);
    await authorization.require('audit_event.read', trustedContext);
    await auditCoordinator.acceptCritical('SENSITIVE_ACTION_ALLOWED', trustedContext);
    const result = await queryPort.listEvents(query);
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LIMITS.maxResponseBytes) throw new Error('AUDIT_RESPONSE_TOO_LARGE');
    try { telemetryPort?.record('F7',1,{ledgerLocation:'TENANT',auditClass:'CRITICAL',result:'SUCCESS',reasonBucket:'none',source:'API',operation:'query'}); } catch { /* non-authoritative */ }
    return result;
  }
  return Object.freeze({ list });
}
module.exports = { FILTERS, LIMITS, createAuditQueryService, validateQuery };
