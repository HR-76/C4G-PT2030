'use strict';
// Read-only, per-identity preview over verified offline evidence. No plan creation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { verifyEvidence } = require('../backend/src/fundingTenders/sourceEvidence');
const { adaptEuOpportunityV2 } = require('../backend/src/fundingTenders/adapterV2');
const { contentDigestV2 } = require('../backend/src/opportunities/v2/digests');
const { previewReconciliation } = require('../backend/src/opportunities/v2/reconciliation');
const { euWriterConfiguration } = require('../backend/src/fundingTenders/euWriter');
const { implementationDigest } = require('../backend/src/opportunities/v2/activationArchive');

const root = cfg.root;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function manifestPath(argv) {
  assert(argv.length === 1 && /^--manifest=output\/eu-legacy-evidence-[a-f0-9-]{36}\/manifest\.json$/.test(argv[0]));
  const file = path.resolve(root, argv[0].slice('--manifest='.length));
  assert(file.startsWith(path.join(root, 'output') + path.sep));
  return file;
}

async function main() {
  const file = manifestPath(process.argv.slice(2));
  const manifestBytes = fs.readFileSync(file);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.kind, 'eu-legacy-official-evidence-v1');
  assert.equal(manifest.status, 'OBSERVED_REVIEW_REQUIRED');
  assert.equal(manifest.readOnly, true);
  assert.equal(manifest.databaseWrites, 0);
  assert.equal(manifest.entries.length, 398);
  assert.equal(manifest.inventory.sourceFence, 7);
  const inventoryBytes = fs.readFileSync(path.join(root, manifest.inventory.path));
  assert.equal(sha(inventoryBytes), manifest.inventory.sha256);
  const inventory = JSON.parse(inventoryBytes);
  const expected = new Map(inventory.items.filter(item => item.proposedPath === 'FRESH_SOURCE_EVIDENCE_AND_REVIEW')
    .map(item => [item.externalIdentifier, item]));
  assert.equal(expected.size, 398);
  const artifacts = new Map();
  for (const entry of manifest.entries) {
    const target = expected.get(entry.externalIdentifier);
    assert(target);
    assert.deepEqual(entry.expected, { opportunityId: target.opportunityId,
      revisionId: target.currentRevisionId, rowVersion: target.rowVersion });
    assert(entry.artifact.path.startsWith(relative(path.dirname(file)) + '/'));
    const bytes = fs.readFileSync(path.join(root, entry.artifact.path));
    assert.equal(sha(bytes), entry.artifact.sha256);
    const observation = JSON.parse(bytes);
    assert.equal(observation.externalIdentifier, entry.externalIdentifier);
    assert.equal(observation.outcome, entry.outcome);
    if (observation.evidence) {
      assert(verifyEvidence(observation.evidence));
      assert.equal(observation.evidence.fingerprint, entry.evidenceFingerprint);
    }
    if (entry.outcome === 'FOUND') {
      assert(observation.evidence && observation.snapshot);
      assert(isDeepStrictEqual(observation.snapshot,
        adaptEuOpportunityV2(observation.evidence, { observedAt: observation.observedAt })));
      assert.equal(contentDigestV2(observation.snapshot), entry.contentDigest);
      assert.equal(observation.mappingDigest, entry.mappingDigest);
    } else assert(!observation.snapshot);
    artifacts.set(entry.externalIdentifier, observation);
  }
  assert.equal(artifacts.size, 398);

  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000' });
  const client = await pool.connect();
  let report;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const control = (await client.query("SELECT state,fence,eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    assert.equal(control?.state, 'QUIESCED');
    assert.equal(control.fence, manifest.inventory.sourceFence);
    assert.equal(control.eu_writer_mode, 'CANONICAL_V2');
    const ids = manifest.entries.map(entry => entry.externalIdentifier);
    const heads = (await client.query(`SELECT f.external_identifier,f.corrections,f.conflicts,
      o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version,o.lifecycle_state,
      r.snapshot,
      (SELECT count(*)::int FROM opportunity_catalog.funding_resolution d
        WHERE d.opportunity_id=o.opportunity_id) AS resolution_count
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      WHERE f.external_identifier=ANY($1::text[])`, [ids])).rows;
    assert.equal(heads.length, 398);
    const byId = new Map(heads.map(row => [row.external_identifier, row]));
    assert.equal(byId.size, 398);
    const entries = [];
    for (const source of manifest.entries) {
      const head = byId.get(source.externalIdentifier), observation = artifacts.get(source.externalIdentifier);
      assert(head);
      const expectedHead = source.expected;
      assert.equal(head.opportunity_id, expectedHead.opportunityId);
      assert.equal(head.current_revision_id, expectedHead.revisionId);
      assert.equal(Number(head.row_version), expectedHead.rowVersion);
      assert.equal(head.current_schema_version, 1);
      let item;
      if (source.outcome === 'FOUND') {
        const currentMappingDigest = implementationDigest('EU_FUNDING_TENDERS', observation.snapshot.provenance.mappingVersion);
        const accepted = { opportunityId: head.opportunity_id, revisionId: head.current_revision_id,
          rowVersion: Number(head.row_version), snapshot: head.snapshot,
          identities: [{ namespace: 'EU_FUNDING_TENDERS', externalId: source.externalIdentifier }],
          mappingDigest: null, corrections: head.corrections || {},
          resolutions: head.resolution_count ? [{ count: head.resolution_count }] : [], privateReferences: [] };
        const candidateId = 'offline:' + sha(source.externalIdentifier);
        const preview = previewReconciliation({ accepted: [accepted], candidates: [{ candidateId,
          snapshot: observation.snapshot, mappingDigest: currentMappingDigest }] });
        const decision = preview.items[0];
        item = { externalIdentifier: source.externalIdentifier, expected: expectedHead,
          outcome: 'FOUND', action: decision.action, reasonCodes: decision.reasonCodes,
          previewDigest: preview.previewDigest, itemDigest: decision.itemDigest,
          candidateId, contentDigest: source.contentDigest, mappingDigest: currentMappingDigest,
          observedMappingDigest: source.mappingDigest,
          evidenceFingerprint: source.evidenceFingerprint, artifact: source.artifact,
          title: observation.snapshot.description.title.value,
          programmeCodes: observation.snapshot.programmes.state === 'PRESENT'
            ? observation.snapshot.programmes.value.map(value => value.code || value.sourceId) : [],
          status: observation.snapshot.status.published.value,
          opening: observation.snapshot.schedule.opening.value?.value || null,
          projectAcronym: observation.snapshot.relatedProject.acronym.value,
          grantAgreementNumber: observation.snapshot.relatedProject.grantAgreementNumber.value,
          amount: source.amount, deadlineCount: source.deadlineCount, directAwarders: source.directAwarders,
          approvalState: 'NOT_REQUESTED' };
      } else item = { externalIdentifier: source.externalIdentifier, expected: expectedHead,
        outcome: source.outcome, action: 'NO_CANDIDATE', reasonCodes: source.conflictReasons || [source.errorCode || source.outcome],
        evidenceFingerprint: source.evidenceFingerprint, artifact: source.artifact,
        approvalState: 'NOT_ELIGIBLE' };
      entries.push(item);
    }
    const actions = Object.fromEntries([...new Set(entries.map(item => item.action))].sort()
      .map(action => [action, entries.filter(item => item.action === action).length]));
    const writer = euWriterConfiguration();
    const writerMappingAligned = control.eu_writer_mapping_digest === writer.mappingDigest
      && control.eu_writer_policy === writer.policyVersion;
    report = { kind: 'eu-legacy-migration-preview-v1',
      status: writerMappingAligned ? 'REVIEW_ONLY' : 'BLOCKED_MAPPING_DRIFT',
      generatedAt: new Date().toISOString(), readOnly: true, databaseWrites: 0,
      sourceControl: control, writerMappingAligned,
      evidenceManifest: { path: relative(file), sha256: sha(manifestBytes) },
      scope: { expected: 398, matchedCurrentHeads: heads.length, actions }, entries,
      approval: { state: 'NOT_REQUESTED', provider: 'OIDC', mode: 'PER_IDENTITY',
        existingRoute: '/api/admin/opportunity-v2/plans',
        prerequisite: 'Writer mapping alignment, verified durable candidate archive, current CAS, source fence, backup/restore and authenticated administrator preview.',
        note: 'Offline item digests are advisory; the server must recompute its own previewDigest after archive registration.' } };
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  const output = path.join(root, 'output', `eu-legacy-migration-preview-${randomUUID()}.json`);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const queue = output.replace(/\.json$/, '.csv');
  const columns = ['externalIdentifier','title','programmeCodes','status','opening','projectAcronym','grantAgreementNumber',
    'action','reasonCodes','amounts','currencyStates','deadlineCount','directAwarders','expectedOpportunityId',
    'expectedRevisionId','expectedRowVersion','evidenceFingerprint','artifactPath','approvalState'];
  const csvCell = value => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csvRows = report.entries.map(item => ({ ...item,
    programmeCodes: item.programmeCodes?.join(';'), reasonCodes: item.reasonCodes?.join(';'),
    amounts: item.amount?.map(value => value.amount).join(';'),
    currencyStates: item.amount?.map(value => value.currencyState).join(';'),
    directAwarders: item.directAwarders?.join(';'),
    expectedOpportunityId: item.expected.opportunityId, expectedRevisionId: item.expected.revisionId,
    expectedRowVersion: item.expected.rowVersion, artifactPath: item.artifact.path }));
  fs.writeFileSync(queue, '\uFEFF' + [columns.join(','),
    ...csvRows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, evidence: relative(output),
    queue: relative(queue),
    matched: report.scope.matchedCurrentHeads, actions: report.scope.actions,
    source: report.sourceControl.state, fence: report.sourceControl.fence,
    writerMappingAligned: report.writerMappingAligned,
    approval: report.approval.state, databaseWrites: 0 }));
}
main().catch(error => { console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_PREVIEW_FAILED'); process.exitCode = 1; });
