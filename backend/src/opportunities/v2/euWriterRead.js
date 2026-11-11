'use strict';
const { createActivationAuthorityV2 } = require('./activationAuthority');
const { cloneData } = require('./data');
const { bounded } = require('./activationRead');
const { locator } = require('./activationArchive');
function fail(code = 'OPPORTUNITY_V2_ACTIVATION_INVALID') { throw Object.assign(Error(code), { code }); }
function encode(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function reviewCursor(raw) {
  if (raw === undefined) return null;
  try {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(raw)) fail();
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (encode(parsed) !== raw) fail();
    const checked = locator({ kind: 'FUNDING', ...parsed });
    if (Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, 'runId') || !Object.hasOwn(parsed, 'externalIdentifier')) fail();
    return { runId: checked.runId, externalIdentifier: checked.externalIdentifier };
  } catch { fail(); }
}
function createEuWriterReadV2({ pool, policyVersion, recentMfaRequirement }) {
  const authority = createActivationAuthorityV2({ policyVersion, recentMfaRequirement });
  async function list(raw, context) {
    let query;
    try { query = cloneData(raw, { maxBytes: 2048 }); } catch { fail(); }
    if (!query || Array.isArray(query) || Object.keys(query).some(key => key !== 'cursor')) fail();
    const cursor = reviewCursor(query.cursor);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      await authority.assertAdministrator(client, context);
      const rows = (await client.query(`SELECT d.run_id,d.external_identifier,d.policy_version,d.mapping_digest,
        d.payload_digest,d.reason_codes,d.expected,d.result,d.recorded_at,r.status AS run_status,r.limited
        FROM opportunity_catalog.eu_writer_decision_v2 d JOIN opportunity_catalog.funding_run r USING(run_id)
        WHERE d.decision='REVIEW' AND ($1::uuid IS NULL OR (d.run_id,d.external_identifier)>($1::uuid,$2::text))
        ORDER BY d.run_id,d.external_identifier LIMIT 26`, [cursor?.runId || null, cursor?.externalIdentifier || null])).rows;
      const items = rows.slice(0, 25).map(row => ({ decision: 'REVIEW',
        archive: { kind: 'FUNDING', runId: row.run_id, externalIdentifier: row.external_identifier },
        policyVersion: row.policy_version, mappingDigest: row.mapping_digest, payloadDigest: row.payload_digest,
        reasons: row.reason_codes, expected: row.expected, result: row.result, recordedAt: row.recorded_at,
        canPrepare: row.run_status === 'SUCCESS' && row.limited === false }));
      const value = bounded({ items, nextCursor: rows.length > 25
        ? encode({ runId: rows[24].run_id, externalIdentifier: rows[24].external_identifier }) : null });
      await authority.assertAdministrator(client, context); await client.query('COMMIT'); return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code?.startsWith('OPPORTUNITY_V2_')) throw error;
      fail('OPPORTUNITY_V2_ACTIVATION_UNAVAILABLE');
    } finally { client.release(); }
  }
  return Object.freeze({ list });
}
module.exports = { createEuWriterReadV2, reviewCursor };
