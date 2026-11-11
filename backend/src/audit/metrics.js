const LABELS = Object.freeze(['ledgerLocation', 'auditClass', 'result', 'reasonBucket', 'source', 'operation']);
function auditMetric(labels) {
  if (!labels || Object.keys(labels).some(key => !LABELS.includes(key)) || Object.values(labels).some(value => typeof value !== 'string' || value.length > 64 || /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value))) throw new TypeError('Audit metric labels are invalid.');
  return Object.freeze({ ...labels });
}
module.exports = { LABELS, auditMetric };
