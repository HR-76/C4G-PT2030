'use strict';
const { createHash } = require('node:crypto');
const { createUuidV7 } = require('../audit/uuidV7');
const { CentralOpportunityRepository } = require('../opportunities/centralRepository');
const { createIdentityFactory } = require('../opportunities/identity');
const { normaliseProgramme } = require('../utils/programmeMapping');
const { mergeSource, FIELDS } = require('./merge');
const { cascadeKeyFromUrl, CASCADE_PREFIX } = require('./identity');
const { createPlatformAudit } = require('./audit');
const VERSION = 'funding-identity-v2';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Only the last source observation identifies the currently represented call.
// Old observations and all opportunity UUIDs remain untouched.
function reconciliationPlan(rows, programmeCorrections = []) {
  const destinations = new Set(), changes = [];
  for (const row of rows) {
    let target;
    try { target = cascadeKeyFromUrl(row.last_source_fields.officialUrl) || row.external_identifier; }
    catch { fail('FUNDING_IDENTITY_AMBIGUOUS'); }
    if (row.external_identifier.startsWith(CASCADE_PREFIX) && target !== row.external_identifier) fail('FUNDING_IDENTITY_AMBIGUOUS');
    if (destinations.has(target)) fail('FUNDING_IDENTITY_COLLISION');
    destinations.add(target);
    const incoming = { ...row.last_source_fields };
    const evidence = programmeCorrections.filter(c => c.callReference === incoming.callReference && c.sourceUrl === incoming.officialUrl);
    if (evidence.length > 1) fail('FUNDING_PROGRAMME_EVIDENCE_INVALID');
    if (evidence.length) {
      const c = evidence[0], programme = normaliseProgramme(c.rawProgrammeCode);
      if (!/^[0-9]+$/.test(c.rawProgrammeCode || '') || !programme || programme === c.rawProgrammeCode || typeof c.from !== 'string') fail('FUNDING_PROGRAMME_EVIDENCE_INVALID');
      if (incoming.programmeName !== c.from && incoming.programmeName !== programme) fail('FUNDING_PROGRAMME_EVIDENCE_STALE');
      incoming.programmeName = programme;
    }
    if (target !== row.external_identifier || incoming.programmeName !== row.last_source_fields.programmeName) {
      const current = Object.fromEntries(FIELDS.filter(k => Object.hasOwn(row.snapshot, k)).map(k => [k, row.snapshot[k]]));
      changes.push({ row, target, incoming, merged: mergeSource({ previousSource: row.last_source_fields, current, incoming, corrections: row.corrections }) });
    }
  }
  return { version: VERSION, digest: digest({ rows, programmeCorrections }), changes };
}

async function reconcileFunding({ pool, programmeCorrections = [], apply = false, expectedDigest = null }) {
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    if (apply) await client.query("SELECT pg_advisory_xact_lock(hashtextextended('EU_FUNDING_TENDERS',150001))");
    if ((await client.query("SELECT 1 FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING') LIMIT 1")).rowCount) fail('FUNDING_BUSY');
    const rows = (await client.query(`SELECT f.*,o.row_version,o.current_revision_id,r.snapshot FROM opportunity_catalog.funding_identity f
      JOIN opportunity_catalog.opportunity o USING(opportunity_id) JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      ORDER BY f.external_identifier${apply ? ' FOR UPDATE OF f,o' : ''}`)).rows;
    const plan = reconciliationPlan(rows, programmeCorrections);
    if (apply && (!expectedDigest || expectedDigest !== plan.digest)) fail('FUNDING_RECONCILIATION_STALE');
    const audit = createPlatformAudit();
    const catalog = new CentralOpportunityRepository({ pool, identityFactory: createIdentityFactory() });
    if (apply) for (const change of plan.changes) {
      const { row, target, incoming, merged } = change;
      const snapshot = { ...row.snapshot, ...merged.fields, provenanceId: createUuidV7(),
        validationState: merged.conflicts.length ? 'CONFLICT' : row.snapshot.validationState };
      for (const key of FIELDS) if (!Object.hasOwn(merged.fields, key)) delete snapshot[key];
      const requestId = digest({ version: VERSION, opportunityId: row.opportunity_id, previousRevision: row.current_revision_id, target, incoming });
      await catalog.withTransactionClient(client, () => catalog.update({ schemaVersion: 1, requestId,
        opportunityId: row.opportunity_id, expectedRowVersion: Number(row.row_version), snapshot,
        provenance: { schemaVersion: 1, sourceType: 'EU_FUNDING_API', sourceNamespace: 'EU_FUNDING_TENDERS',
          externalIdentifier: target, ...(incoming.officialUrl ? { sourceUrl: incoming.officialUrl } : {}), observedAt: new Date(row.observed_at).toISOString() }
      }, { actor: { type: 'SERVICE', reference: 'FUNDING_TENDERS_CENTRAL' } }));
      await client.query('RESET ROLE');
      await client.query('UPDATE opportunity_catalog.funding_identity SET external_identifier=$2,last_source_fields=$3,corrections=$4,conflicts=$5 WHERE opportunity_id=$1',
        [row.opportunity_id, target, incoming, merged.corrections, JSON.stringify(merged.conflicts)]);
      await audit(client, { actor: { type: 'SERVICE', id: 'FUNDING_TENDERS_CENTRAL' }, eventCode: 'OPPORTUNITY_REVISION_CREATED',
        requestId, resourceId: row.opportunity_id, detailCode: 'FUNDING_IDENTITY_RECONCILED' });
    }
    await client.query('COMMIT');
    return { version: VERSION, digest: plan.digest, applied: apply, changes: plan.changes.map(({ row, target, incoming, merged }) => ({
      opportunityId: row.opportunity_id, from: row.external_identifier, to: target,
      previousProgramme: row.last_source_fields.programmeName, sourceProgramme: incoming.programmeName,
      effectiveProgramme: merged.fields.programmeName, conflicts: merged.conflicts
    })) };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
module.exports = { reconciliationPlan, reconcileFunding };
