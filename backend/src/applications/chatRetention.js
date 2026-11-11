'use strict';
// Periodic deletion of team-chat history 90+ days after an application reached a final state.
// The database function is the authority (floor of 90 days, final states only, per-organization);
// this service only calls it with the dedicated retention role, in one transaction per batch.
const MIN_RETENTION_DAYS = 90;
const MAX_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE = 'c4g_chat_retention_runtime';

function createChatRetentionService({ pool, organizationId, retentionDays = MIN_RETENTION_DAYS, batchSize = 50 }) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Chat retention requires a tenant pool.');
  if (!UUID.test(organizationId || '')) throw new TypeError('Chat retention requires an organization.');
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_RETENTION_DAYS) throw new TypeError(`Chat retention cannot be shorter than ${MIN_RETENTION_DAYS} days.`);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) throw new TypeError('Chat retention batch size is invalid.');
  return Object.freeze({
    async runOnce() {
      const client = await pool.connect();
      let broken;
      try {
        await client.query('BEGIN');
        try {
          await client.query(`SET LOCAL ROLE ${ROLE}`);
          const { rows } = await client.query('SELECT purged_application_id, purged_message_count FROM opportunity_catalog.purge_closed_application_chat_v1($1,$2,$3)',
            [organizationId, retentionDays, batchSize]);
          await client.query('COMMIT');
          return Object.freeze({
            applications: rows.length,
            messages: rows.reduce((total, row) => total + Number(row.purged_message_count), 0),
            // A full batch means more may be waiting; the caller can run again.
            more: rows.length === batchSize
          });
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError; }
          throw error;
        }
      } finally { client.release(broken); }
    }
  });
}

module.exports = { MIN_RETENTION_DAYS, createChatRetentionService };
