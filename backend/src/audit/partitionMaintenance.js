'use strict';

// Monthly rotation of audit.event partitions, run per database (central and each tenant) by the
// audit migrator. Plain DDL on purpose: no new schema objects, and rotated partitions are
// ignored by the schema fingerprints (see security/auditPartitionPolicy.js).
const MIN_MONTHS_AHEAD = 1;
const MAX_MONTHS_AHEAD = 24;
const pad = value => String(value).padStart(2, '0');

function failure(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function planAuditPartitions(now, monthsAhead) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw failure('AUDIT_PARTITION_DATE_INVALID');
  if (!Number.isInteger(monthsAhead) || monthsAhead < MIN_MONTHS_AHEAD || monthsAhead > MAX_MONTHS_AHEAD) {
    throw failure('AUDIT_PARTITION_HORIZON_INVALID');
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const plan = [];
  for (let offset = 0; offset <= monthsAhead; offset += 1) {
    const from = new Date(Date.UTC(year, month + offset, 1));
    const to = new Date(Date.UTC(year, month + offset + 1, 1));
    plan.push({
      name: `event_${from.getUTCFullYear()}_${pad(from.getUTCMonth() + 1)}`,
      from: from.toISOString(),
      to: to.toISOString()
    });
  }
  return plan;
}

async function defaultPartitionRows(client) {
  const { rows } = await client.query('SELECT count(*)::int AS rows FROM audit.event_default');
  return rows[0].rows;
}

// `client` is a single connection (not a pool) logged in as a member of c4g_audit_migrator.
async function ensureAuditPartitions(client, { now = new Date(), monthsAhead = 3 } = {}) {
  const plan = planAuditPartitions(now, monthsAhead);
  const created = [];
  let defaultRows;
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SET LOCAL ROLE c4g_audit_owner');
    for (const { name, from, to } of plan) {
      const { rows: [{ present }] } = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`audit.${name}`]);
      if (present) continue;
      const { rows: [{ conflict }] } = await client.query(
        'SELECT EXISTS (SELECT 1 FROM audit.event_default WHERE accepted_at >= $1::timestamptz AND accepted_at < $2::timestamptz) AS conflict',
        [from, to]
      );
      // Rows already in DEFAULT would block the new partition and cannot be moved: append-only.
      if (conflict) throw failure('AUDIT_PARTITION_DEFAULT_CONFLICT', `AUDIT_PARTITION_DEFAULT_CONFLICT ${name}`);
      // Name and bounds are generated from validated integers above, never from input.
      await client.query(`CREATE TABLE audit.${name} PARTITION OF audit.event FOR VALUES FROM ('${from}') TO ('${to}')`);
      created.push(name);
    }
    // The migrator has no table privileges: read the alarm count while acting as the owner.
    defaultRows = await defaultPartitionRows(client);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* keep the original failure */ }
    throw error;
  }
  return Object.freeze({ created: Object.freeze(created), defaultRows });
}

module.exports = Object.freeze({
  MIN_MONTHS_AHEAD, MAX_MONTHS_AHEAD, planAuditPartitions, ensureAuditPartitions, defaultPartitionRows
});
