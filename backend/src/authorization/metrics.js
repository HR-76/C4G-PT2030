const ALLOWED_LABELS = new Set(['result', 'reasonCode', 'category']);

function createMetricsPort(sink) {
  if (typeof sink !== 'function') throw new TypeError('Metrics sink is invalid.');
  return Object.freeze({ record(labels) {
    if (!labels || typeof labels !== 'object' || Reflect.ownKeys(labels).some(key => !ALLOWED_LABELS.has(key))) {
      throw new TypeError('Authorization metric labels are invalid.');
    }
    sink(Object.freeze({ ...labels }));
  } });
}

module.exports = { ALLOWED_LABELS, createMetricsPort };
