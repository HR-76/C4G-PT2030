'use strict';

// audit.event is partitioned by month. The pinned schema fingerprints cover the partitions
// created by the baseline migrations; every later monthly partition is operational rotation
// and must not read as schema drift. The audit preflight separately proves that any table
// with a monthly name is really a partition of audit.event.
const BASELINE_PARTITIONS = Object.freeze(['event_2026_10', 'event_2026_11']);
const MONTHLY_NAME = /^event_\d{4}_(?:0[1-9]|1[0-2])$/;

function isRotatingAuditPartition(name) {
  return typeof name === 'string' && MONTHLY_NAME.test(name) && !BASELINE_PARTITIONS.includes(name);
}

function isRotatingAuditTable(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('audit.')) return false;
  return isRotatingAuditPartition(reference.slice('audit.'.length));
}

// `reference` maps a row to its "schema.table" text (default: the central table_name column).
function omitRotatingAuditPartitions(rows, reference = row => row.table_name) {
  return rows.filter(row => !isRotatingAuditTable(reference(row)));
}

module.exports = Object.freeze({
  BASELINE_PARTITIONS, MONTHLY_NAME, isRotatingAuditPartition, isRotatingAuditTable, omitRotatingAuditPartitions
});
