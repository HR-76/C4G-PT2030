const APPEND_METHODS = Object.freeze(['prepare', 'append']);
const QUERY_METHODS = Object.freeze(['listEvents', 'getEvent', 'verifyStream', 'requestExport']);
function assertPort(port, methods, label) { if (!port || methods.some(method => typeof port[method] !== 'function')) throw new TypeError(`${label} contract is incomplete.`); return port; }
function assertAuditAppendPort(port) { return assertPort(port, APPEND_METHODS, 'AuditAppendPort'); }
function assertAuditQueryPort(port) { return assertPort(port, QUERY_METHODS, 'AuditQueryPort'); }
module.exports = { APPEND_METHODS, QUERY_METHODS, assertAuditAppendPort, assertAuditQueryPort };
