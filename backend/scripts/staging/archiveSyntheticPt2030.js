'use strict';
// One explicitly authorized staging fixture. Never a general catalogue writer.
const assert = require('node:assert/strict');
const ID = '5d00f752-d40d-46ea-9757-9194a2b10005';
const REVISION = '8b81b819-9d3c-41fe-8b5c-510aa3a25c69';
const REFERENCE = 'STAGING-TEST-20261115-065EE2E7';
const TITLE = 'TESTE SINTÉTICO — STAGING — NÃO É UM AVISO REAL';
async function archiveSynthetic(pool, { apply = false, audit } = {}) {
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    assert.equal((await client.query('SELECT current_database() AS name')).rows[0]?.name, 'c4g_central_staging');
    const selected = await client.query(`SELECT o.* FROM opportunity_catalog.opportunity o
      JOIN opportunity_catalog.source_identity_v2 s ON s.opportunity_id=o.opportunity_id
      WHERE o.opportunity_id=$1 AND s.source_namespace='PORTUGAL2030_PLAN' AND s.external_identifier=$2
      ${apply ? 'FOR UPDATE OF o' : ''}`, [ID, REFERENCE]);
    assert.equal(selected.rows.length, 1);
    const row = selected.rows[0];
    assert.equal(row.title, TITLE);
    assert.equal(row.current_revision_id, REVISION);
    assert.equal(row.current_schema_version, 2);
    const counts = async () => (await client.query(`SELECT
      (SELECT count(*)::int FROM opportunity_catalog.revision WHERE opportunity_id=$1) AS revisions,
      (SELECT count(*)::int FROM opportunity_catalog.accepted_receipt_v2 WHERE opportunity_id=$1) AS receipts,
      (SELECT count(*)::int FROM opportunity_catalog.source_identity_v2 WHERE opportunity_id=$1) AS identities`, [ID])).rows[0];
    const before = await counts();
    assert.deepEqual(before, {revisions:1, receipts:1, identities:1});
    const already = row.lifecycle_state === 'ARCHIVED';
    assert.equal(Number(row.row_version), already ? 2 : 1);
    assert.equal(row.lifecycle_state, already ? 'ARCHIVED' : 'ACTIVE');
    if (already) assert.ok(row.archived_at);
    else assert.equal(row.archived_at, null);
    if (apply && !already) {
      const append = audit || require('../../src/fundingTenders/audit').createPlatformAudit({source:'STAGING_MAINTENANCE'});
      await append(client, {actor:{type:'SERVICE',id:'STAGING_MAINTENANCE'},eventCode:'OPPORTUNITY_ARCHIVED',
        requestId:'archive-synthetic-pt2030-065ee2e7-v1',resourceId:ID,detailCode:'SYNTHETIC_STAGING_TEST_COMPLETED'});
      const updated = await client.query(`UPDATE opportunity_catalog.opportunity
        SET lifecycle_state='ARCHIVED',archived_at=transaction_timestamp(),updated_at=transaction_timestamp(),row_version=row_version+1
        WHERE opportunity_id=$1 AND current_revision_id=$2 AND row_version=1 AND lifecycle_state='ACTIVE'`, [ID, REVISION]);
      assert.equal(updated.rowCount, 1);
      assert.deepEqual(await counts(), before);
    }
    await client.query('COMMIT');
    return {status:already ? 'ALREADY_ARCHIVED' : apply ? 'ARCHIVED' : 'READY_TO_ARCHIVE', opportunityId:ID,reference:REFERENCE,...before};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
module.exports = { archiveSynthetic };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw Error('INVALID_ARGUMENTS');
  const pool = require('../../src/config/centralDb');
  archiveSynthetic(pool, {apply:args[0] === '--apply'})
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({status:'NOT_COMPLETED',code:error.code || error.name})); process.exitCode=1; })
    .finally(() => pool.end());
}
