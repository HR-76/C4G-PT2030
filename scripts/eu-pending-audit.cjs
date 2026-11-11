'use strict';
// Read-only factual inventory of the one habitual EU cycle. No approval or writer port.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createCandidateArchiveV2 } = require('../backend/src/fundingTenders/candidateRepositoryV2');
const CYCLE = '7266ad6b-8880-4ec1-9399-4751187831c5';
const ID11145 = 'CASCADE:11145';
const rawPath = 'context/references/opportunity-v2/evidence/eu-11145.json';
const metadataPath = 'context/references/opportunity-v2/evidence/eu-11145.metadata.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const count = (items, get) => Object.fromEntries([...items.reduce((map, item) => {
  const key = String(get(item)); map.set(key, (map.get(key) || 0) + 1); return map;
}, new Map())].sort((a, b) => a[0].localeCompare(b[0])));
const fact = value => ({ state: value?.state || null, value: value?.value ?? null, reason: value?.reason || null });

async function run() {
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000' });
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const control = (await client.query("SELECT state,fence,eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    assert.equal(control?.state, 'QUIESCED'); assert.equal(control.fence, 7);
    assert.equal(control.eu_writer_mode, 'CANONICAL_V2');
    const reviews = (await client.query(`SELECT d.*,r.source_code,r.status AS run_status,r.limited,r.observed_at,
      o.current_schema_version,o.current_revision_id,o.row_version AS current_row_version,
      f.opportunity_id,f.last_source_fields,f.corrections,f.conflicts,
      c.content_digest AS archive_content_digest,c.payload_digest AS archive_payload_digest,c.source_evidence
      FROM opportunity_catalog.eu_writer_decision_v2 d
      JOIN opportunity_catalog.funding_batch b USING(run_id)
      JOIN opportunity_catalog.funding_run r USING(run_id)
      JOIN opportunity_catalog.funding_candidate_v2 c USING(run_id,external_identifier)
      JOIN opportunity_catalog.funding_identity f USING(external_identifier)
      JOIN opportunity_catalog.opportunity o ON o.opportunity_id=f.opportunity_id
      WHERE b.cycle_id=$1 AND d.decision='REVIEW' ORDER BY d.external_identifier`, [CYCLE])).rows;
    assert.equal(reviews.length, 137);
    const verifier = createCandidateArchiveV2();
    const items = [];
    for (const row of reviews) {
      const checked = await verifier.verify(client, { run: { run_id: row.run_id, source_code: row.source_code, observed_at: row.observed_at }, externalIdentifier: row.external_identifier });
      assert.equal(checked.payloadDigest, row.payload_digest);
      assert.equal(checked.payloadDigest, row.archive_payload_digest);
      assert.equal(checked.contentDigest, row.archive_content_digest);
      assert.equal(row.expected.opportunityId, row.opportunity_id);
      assert.equal(row.expected.revisionId, row.current_revision_id);
      assert.equal(Number(row.expected.rowVersion), Number(row.current_row_version));
      assert.equal(row.current_schema_version, 1);
      assert.equal(row.run_status, 'SUCCESS'); assert.equal(row.limited, false);
      assert.deepEqual(row.reason_codes, ['LEGACY_MIGRATION_REQUIRES_REVIEW', 'MAPPING_BASELINE_UNAVAILABLE']);
      const s = checked.canonicalSnapshot;
      const sourceText = JSON.stringify(row.source_evidence?.variants?.map(v => v.metadata?.description || '') || []);
      items.push({ externalIdentifier: row.external_identifier, runId: row.run_id,
        opportunityId: row.opportunity_id, expectedRevisionId: row.current_revision_id,
        expectedRowVersion: Number(row.current_row_version), archivePayloadDigest: checked.payloadDigest,
        archiveContentDigest: checked.contentDigest, archivedObservedAt: row.observed_at.toISOString(),
        decision: 'REVIEW', reasons: row.reason_codes, archiveVerified: true,
        legacy: { schemaVersion: 1, funderName: row.last_source_fields?.funderName || null,
          correctionsEmpty: JSON.stringify(row.corrections) === '{}', conflictsEmpty: Array.isArray(row.conflicts) && row.conflicts.length === 0 },
        candidate: { title: fact(s.description.title), reference: fact(s.identity.references),
          programme: fact(s.programmes), parties: fact(s.parties), status: fact(s.status.published),
          opening: fact(s.schedule.opening), deadlineCount: s.schedule.deadlines?.value?.length || 0,
          deadlinesState: s.schedule.deadlines?.state || null,
          allocationState: s.financing.allocations?.state || null,
          allocationAmounts: (s.financing.allocations?.value || []).map(a => ({ amount: a.money.amount, currency: fact(a.money.currency), scope: a.scope })),
          projectAcronym: fact(s.relatedProject.acronym), grantAgreementNumber: fact(s.relatedProject.grantAgreementNumber),
          qualityCodes: s.quality.issues.map(i => i.code) },
        evidenceFlags: { explicitNonEuAction: /not an EU action/i.test(sourceText),
          ownResponsibility: /own responsibility/i.test(sourceText) },
        proposedDisposition: 'HUMAN_REVIEW_OF_V1_TO_V2_MIGRATION',
        decisionStatus: 'NOT_ACCEPTED' });
    }
    assert.equal(new Set(items.map(i => i.externalIdentifier)).size, 137);
    const conflicts = (await client.query(`SELECT t.external_identifier,t.run_id,t.state,
      r.status AS run_status,r.result_count,r.failed_count,r.error_code,
      b.input_cursor,b.next_cursor,f.opportunity_id,f.last_source_fields,
      h.snapshot->'sourceResolution' AS source_resolution,
      d.resolution_id,d.source_fingerprint,
      EXISTS(SELECT 1 FROM opportunity_catalog.funding_candidate_v2 c WHERE c.run_id=t.run_id AND c.external_identifier=t.external_identifier) AS archived
      FROM opportunity_catalog.funding_refresh_target t
      JOIN opportunity_catalog.funding_run r ON r.run_id=t.run_id
      JOIN opportunity_catalog.funding_batch b ON b.run_id=t.run_id
      JOIN opportunity_catalog.funding_identity f USING(external_identifier)
      JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision h ON h.revision_id=o.current_revision_id
      LEFT JOIN opportunity_catalog.funding_resolution d ON d.external_identifier=t.external_identifier AND d.opportunity_id=o.opportunity_id
      WHERE t.cycle_id=$1 AND t.state='CONFLICT' ORDER BY t.external_identifier`, [CYCLE])).rows.map(row => ({
      externalIdentifier: row.external_identifier, runId: row.run_id, opportunityId: row.opportunity_id,
      state: row.state, runStatus: row.run_status, lookupMatches: row.result_count,
      lookupFailedCount: row.failed_count, lookupPhase: row.input_cursor?.phase,
      archived: row.archived, previousResolutionId: row.resolution_id,
      previousResolutionFingerprint: row.source_fingerprint,
      previousResolutionInCurrentRevision: row.source_resolution?.resolutionId === row.resolution_id && Boolean(row.resolution_id),
      priorClosingDate: row.last_source_fields?.closingDate || null,
      reasonEstablished: false,
      proposedDisposition: row.resolution_id ? 'FRESH_OFFICIAL_LOOKUP_AND_COMPARE_WITH_PROTECTED_RESOLUTION' : 'FRESH_OFFICIAL_LOOKUP_AND_CLASSIFY_AMBIGUITY',
      decisionStatus: 'UNRESOLVED' }));
    assert.equal(conflicts.length, 5);
    assert(conflicts.every(c => c.archived === false && c.runStatus === 'SUCCESS' && c.lookupPhase === 'KNOWN'));
    const targetStates = (await client.query('SELECT state,count(*)::int AS count FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=$1 GROUP BY state ORDER BY state', [CYCLE])).rows;
    const db11145 = (await client.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.content_digest,r.snapshot,
      f.last_source_fields,f.source_review
      FROM opportunity_catalog.funding_identity f
      JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      WHERE f.external_identifier=$1`, [ID11145])).rows[0];
    assert.equal(db11145?.snapshot?.schemaVersion, 2);
    const alloc = (await client.query(`SELECT amount::text,pg_typeof(amount)::text AS sql_type,currency_state,currency_code
      FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1`, [db11145.current_revision_id])).rows;
    const deadlines = (await client.query('SELECT payload FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1 ORDER BY ordinal', [db11145.current_revision_id])).rows.map(r => r.payload);
    assert.equal(alloc.length, 1); assert.equal(alloc[0].sql_type, 'numeric');
    assert.equal(Number(alloc[0].amount), 120000); assert.equal(alloc[0].currency_state, 'NOT_FOUND');
    assert.equal(deadlines.length, 7); assert.deepEqual(deadlines, db11145.snapshot.schedule.deadlines.value);
    const accepted = (await client.query(`SELECT d.run_id,d.external_identifier,d.decision,d.reason_codes,d.payload_digest,
      r.source_code,r.observed_at,r.status,r.limited,c.content_digest,c.source_evidence
      FROM opportunity_catalog.eu_writer_decision_v2 d
      JOIN opportunity_catalog.funding_batch b USING(run_id)
      JOIN opportunity_catalog.funding_run r USING(run_id)
      JOIN opportunity_catalog.funding_candidate_v2 c USING(run_id,external_identifier)
      WHERE b.cycle_id=$1 AND d.external_identifier=$2`, [CYCLE, ID11145])).rows[0];
    assert.equal(accepted?.decision, 'ACCEPTED'); assert.deepEqual(accepted.reason_codes, []);
    assert.equal(accepted.status, 'SUCCESS'); assert.equal(accepted.limited, false);
    const acceptedVerified = await verifier.verify(client, { run: {
      run_id: accepted.run_id, source_code: accepted.source_code, observed_at: accepted.observed_at
    }, externalIdentifier: ID11145 });
    assert.equal(acceptedVerified.payloadDigest, accepted.payload_digest);
    assert.equal(acceptedVerified.contentDigest, accepted.content_digest);
    // UNCHANGED observations keep the accepted revision; provenance timestamps advance.
    assert.equal(acceptedVerified.contentDigest, db11145.content_digest);
    for (const key of ['identity', 'description', 'programmes', 'parties', 'publication',
      'schedule', 'status', 'financing', 'relatedProject', 'sourceRecords']) {
      assert.deepEqual(acceptedVerified.canonicalSnapshot[key], db11145.snapshot[key]);
    }
    const latestMetadata = accepted.source_evidence.variants[0].metadata;
    const rawBytes = fs.readFileSync(path.join(cfg.root, rawPath));
    const meta = JSON.parse(fs.readFileSync(path.join(cfg.root, metadataPath), 'utf8'));
    assert.equal(sha(rawBytes), meta.response.sha256);
    const official = JSON.parse(rawBytes).results[0], m = official.metadata, s = db11145.snapshot;
    assert.equal(m.callccm2Id[0], '11145');
    const originalDescription = m.description[0];
    assert(/not an EU action/i.test(originalDescription) && /directly/i.test(originalDescription) && /in its own name/i.test(originalDescription));
    const base = { sourceUrl: meta.officialUrl, observedAt: meta.observedAt, archivedSha256: meta.response.sha256,
      title: m.callTitle[0], programmeSourceId: m.frameworkProgramme[0], reference: m.identifier[0],
      opening: new Date(m.startDate[0].replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString(),
      statusCode: m.status[0], budget: m.budget[0], projectAcronym: m.projectAcronym[0], grantAgreementNumber: m.projectId[0],
      deadlines: m.deadlineDate.map(v => new Date(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString()),
      directAwarder: 'Gnomon Informatics SA', currencyPublishedInBudgetField: false,
      publisherIsAwarder: false };
    for (const [key, value] of [
      ['callTitle', base.title], ['identifier', base.reference], ['budget', base.budget],
      ['projectAcronym', base.projectAcronym], ['projectId', base.grantAgreementNumber],
      ['status', base.statusCode]
    ]) assert.equal(latestMetadata[key][0], value);
    assert.deepEqual(latestMetadata.deadlineDate, m.deadlineDate);
    const fieldChecks = {
      title: { official: base.title, app: s.description.title.value, equal: base.title === s.description.title.value },
      programme: { officialSourceId: base.programmeSourceId, app: s.programmes.value.map(p => ({ code: p.code, sourceId: p.sourceId })), equal: s.programmes.value.some(p => p.sourceId === base.programmeSourceId) },
      reference: { official: base.reference, app: s.identity.references.value.find(r => r.kind === 'TOPIC_REFERENCE')?.value, equal: s.identity.references.value.some(r => r.kind === 'TOPIC_REFERENCE' && r.value === base.reference) },
      source: { official: meta.officialUrl, app: s.sourceRecords[0].url, equal: meta.officialUrl === s.sourceRecords[0].url },
      opening: { official: base.opening, app: s.schedule.opening.value.value, equal: base.opening === s.schedule.opening.value.value },
      status: { officialCode: base.statusCode, appCode: s.status.publishedCode.value, appStatus: s.status.published.value, equal: base.statusCode === s.status.publishedCode.value },
      totalFundingAvailable: { official: base.budget, app: s.financing.allocations.value[0].money.amount, storedNumeric: alloc[0].amount, equal: base.budget === s.financing.allocations.value[0].money.amount },
      totalFundingCurrency: { official: 'NOT_DECLARED_IN_API_BUDGET_FIELD', app: s.financing.allocations.value[0].money.currency.state, stored: alloc[0].currency_state, equal: s.financing.allocations.value[0].money.currency.state === 'NOT_FOUND' },
      projectAcronym: { official: base.projectAcronym, app: s.relatedProject.acronym.value, equal: base.projectAcronym === s.relatedProject.acronym.value },
      grantAgreementNumber: { official: base.grantAgreementNumber, app: s.relatedProject.grantAgreementNumber.value, equal: base.grantAgreementNumber === s.relatedProject.grantAgreementNumber.value },
      cutOffDates: { official: base.deadlines, app: s.schedule.deadlines.value.map(d => d.at.value), equal: JSON.stringify(base.deadlines) === JSON.stringify(s.schedule.deadlines.value.map(d => d.at.value)) },
      awarder: { official: base.directAwarder, app: s.parties.value.find(p => p.role === 'DIRECT_AWARDER')?.name, legacyFunder: db11145.last_source_fields.funderName, equal: s.parties.value.some(p => p.role === 'DIRECT_AWARDER' && p.name === base.directAwarder), legacyIncorrect: db11145.last_source_fields.funderName === 'European Commission' }
    };
    assert(Object.values(fieldChecks).every(v => v.equal));
    result = {
      kind: 'eu-pending-factual-audit-v1', status: 'PASS_WITH_ACTIONS',
      cycleId: CYCLE, inspectedAt: new Date().toISOString(), database: config.centralDatabase,
      readOnly: true, sourceControl: control, targetStates,
      reviewCount: items.length, reviews: items,
      reviewSummary: {
        reasons: count(items, i => i.reasons.join('+')),
        schemaVersions: count(items, i => i.legacy.schemaVersion),
        archiveVerified: items.every(i => i.archiveVerified),
        expectedCASCurrent: true,
        correctionsEmpty: items.every(i => i.legacy.correctionsEmpty),
        conflictsEmpty: items.every(i => i.legacy.conflictsEmpty),
        legacyFunders: count(items, i => i.legacy.funderName),
        v2Parties: count(items, i => i.candidate.parties.state),
        v2Budget: count(items, i => i.candidate.allocationState),
        v2Acronyms: count(items, i => i.candidate.projectAcronym.state),
        v2Deadlines: count(items, i => i.candidate.deadlinesState),
        explicitNonEuActionCount: items.filter(i => i.evidenceFlags.explicitNonEuAction).length,
        qualityCodes: count(items.flatMap(i => i.candidate.qualityCodes), c => c)
      }, conflictCount: conflicts.length, conflicts,
      call11145: { archive: { path: rawPath, metadataPath, sha256: meta.response.sha256 },
        current: { opportunityId: db11145.opportunity_id, revisionId: db11145.current_revision_id,
          rowVersion: Number(db11145.row_version), contentDigest: db11145.content_digest,
          sourceReview: db11145.source_review }, official: base,
        habitualObservation: { runId: accepted.run_id, observedAt: accepted.observed_at.toISOString(),
          archiveVerified: true, payloadDigest: acceptedVerified.payloadDigest,
          contentDigest: acceptedVerified.contentDigest, domainFactsMatchCurrentRevision: true,
          provenanceObservedAtDiffersFromCurrentRevision: acceptedVerified.canonicalSnapshot.provenance.observations[0].observedAt !== db11145.snapshot.provenance.observations[0].observedAt,
          selectedOfficialFieldsMatchEarlierArchive: true,
          currencyKeyPresent: Object.keys(latestMetadata).some(key => /currency/i.test(key)) },
        fieldChecks },
      limitations: [
        'Official portal HTML is a JavaScript shell; comparison uses archived European Commission API observations, not a newly rendered portal session.',
        'The five CONFLICT lookups have no canonical archive and retain no per-variant cause. A new official lookup is required before factual adjudication.',
        'REVIEW is a policy outcome for v1 migration and missing mapping baseline; verified archive integrity does not authorize acceptance.',
        'A legacy funder label is not evidence that the Commission directly awards a cascade call.',
        'The budget field declares 120000 but no currency key. EUR in the monthly support narrative has a different scope.'
      ]
    };
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); await pool.end(); }
  const folder = path.join(cfg.root, 'output', 'eu-pending-audit-' + randomUUID());
  fs.mkdirSync(folder, { recursive: false });
  const file = path.join(folder, 'review-inventory.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  const columns = ['type', 'externalIdentifier', 'title', 'programme', 'legacySchemaVersion',
    'legacyFunder', 'directAwarder', 'budget', 'currencyState', 'deadlines',
    'projectAcronym', 'grantAgreementNumber', 'reasons', 'archiveVerified',
    'lookupMatches', 'previousResolution', 'proposedDisposition', 'decisionStatus'];
  const line = values => values.map(value => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(',');
  const rows = result.reviews.map(r => ({ type: 'REVIEW', externalIdentifier: r.externalIdentifier,
    title: r.candidate.title.value, programme: r.candidate.programme.value?.map(v => v.code).join(';'),
    legacySchemaVersion: r.legacy.schemaVersion, legacyFunder: r.legacy.funderName,
    directAwarder: r.candidate.parties.value?.filter(v => v.role === 'DIRECT_AWARDER').map(v => v.name).join(';'),
    budget: r.candidate.allocationAmounts.map(v => v.amount).join(';'),
    currencyState: r.candidate.allocationAmounts.map(v => v.currency.state).join(';'),
    deadlines: r.candidate.deadlineCount, projectAcronym: r.candidate.projectAcronym.value,
    grantAgreementNumber: r.candidate.grantAgreementNumber.value, reasons: r.reasons.join(';'),
    archiveVerified: r.archiveVerified, proposedDisposition: r.proposedDisposition, decisionStatus: r.decisionStatus
  })).concat(result.conflicts.map(r => ({ type: 'CONFLICT', externalIdentifier: r.externalIdentifier,
    lookupMatches: r.lookupMatches, previousResolution: r.previousResolutionId,
    archiveVerified: r.archived, proposedDisposition: r.proposedDisposition, decisionStatus: r.decisionStatus })));
  assert.equal(rows.length, 142);
  const csv = '\uFEFF' + [line(columns), ...rows.map(row => line(columns.map(column => row[column])))].join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(folder, 'decision-queue.csv'), csv, { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, evidence: path.relative(cfg.root, file).replaceAll('\\', '/'),
    queue: path.relative(cfg.root, path.join(folder, 'decision-queue.csv')).replaceAll('\\', '/'),
    reviews: result.reviewCount, verified: result.reviewSummary.archiveVerified,
    conflicts: result.conflictCount, source: result.sourceControl.state, fence: result.sourceControl.fence }));
  return result;
}
if (require.main === module) run().catch(e => { console.error(/^[A-Z0-9_]{3,100}$/.test(e.code || '') ? e.code : 'EU_PENDING_AUDIT_FAILED'); process.exitCode = 1; });
module.exports = { run };
