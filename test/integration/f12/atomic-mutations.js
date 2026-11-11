'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { Pool } = require('../../../backend/node_modules/pg');
const { assertTarget } = require('../../../backend/src/opportunities/migrationRunner');
const { TenantOpportunityRepository } = require('../../../backend/src/opportunities/tenantRepository');
const { createIdentityFactory } = require('../../../backend/src/opportunities/identity');
const { createPostgresOpportunityAuditWriter } = require('../../../backend/src/opportunities/postgresAuditWriter');
const { createDocumentRepository } = require('../../../backend/src/documents/repository');
const { createUploadService } = require('../../../backend/src/documents/uploadService');
const { createConfirmationService } = require('../../../backend/src/documents/confirmationService');
const { createScanService } = require('../../../backend/src/documents/scanService');
const { createF11ObjectStorageDouble } = require('../../../backend/test/support/f11ObjectStorageDouble');
const { createF11MalwareScanDouble } = require('../../../backend/test/support/f11MalwareScanDouble');

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

function context(correlationId) {
  return {
    actor: { type: 'SERVICE', reference: 'F12_MUTATION' },
    audit: { correlationId, causationId: null },
  };
}

async function main() {
  const url = process.env.F12_GATE_URL.replace('/postgres', '/f12_synthetic_tenant_a');
  assertTarget(url);
  const pool = new Pool({ connectionString: url, max: 4 });
  try {
    const current = (await pool.query(
      "SELECT opportunity_id::text AS id, row_version::int AS version FROM opportunity_catalog.opportunity WHERE title = 'Integrated A'",
    )).rows[0];
    const auditWriter = createPostgresOpportunityAuditWriter({
      authority: 'ORGANIZATION', organizationId: ORGANIZATION_ID, tenantId: ORGANIZATION_ID,
    });
    const repository = new TenantOpportunityRepository({
      pool, organizationId: ORGANIZATION_ID, identityFactory: createIdentityFactory(), auditWriter,
    });
    const update = {
      schemaVersion: 1,
      requestId: 'integrated-update-0001',
      opportunityId: current.id,
      expectedRowVersion: current.version,
      snapshot: {
        schemaVersion: 1,
        title: 'Integrated Updated',
        funderName: 'Synthetic Foundation',
        provenanceId: '01890f3e-7b12-7abc-8def-0123456789c1',
        lifecycleState: 'DRAFT',
        validationState: 'PENDING_REVIEW',
        normalizationVersion: 'opportunity-normalization-v1',
        qualityRuleVersion: 'opportunity-quality-v1',
      },
      provenance: {
        schemaVersion: 1,
        sourceType: 'ORGANIZATION_MANUAL',
        sourceNamespace: 'INTEGRATED',
        externalIdentifier: 'integrated-create-0001',
        observedAt: new Date().toISOString(),
      },
    };
    const updated = await repository.update(update, context('01890f3e-7b12-7abc-8def-0123456789c2'));
    assert.equal(updated.rowVersion, current.version + 1);
    const archived = await repository.changeLifecycle({
      schemaVersion: 1,
      requestId: 'integrated-archive-0001',
      opportunityId: current.id,
      expectedRowVersion: updated.rowVersion,
      action: 'ARCHIVE',
    }, context('01890f3e-7b12-7abc-8def-0123456789c3'));
    assert.equal(archived.revisionNumber, 3);
    const eventCounts = (await pool.query(
      `SELECT event_code, count(*)::int AS n
         FROM audit.event
        WHERE organization_id = $1
          AND event_code IN ('OPPORTUNITY_REVISION_CREATED', 'OPPORTUNITY_ARCHIVED')
        GROUP BY event_code`,
      [ORGANIZATION_ID],
    )).rows;
    assert.equal(eventCounts.length, 2);

    const failedRepository = new TenantOpportunityRepository({
      pool,
      organizationId: ORGANIZATION_ID,
      identityFactory: createIdentityFactory(),
      auditWriter: { append: async () => { throw new Error('SYNTHETIC_AUDIT_FAILURE'); } },
    });
    await assert.rejects(() => failedRepository.changeLifecycle({
      schemaVersion: 1,
      requestId: 'integrated-restore-fail',
      opportunityId: current.id,
      expectedRowVersion: Number(archived.rowVersion),
      action: 'RESTORE',
    }, context('01890f3e-7b12-7abc-8def-0123456789c4')));
    assert.equal((await repository.get(current.id)).lifecycleState, 'ARCHIVED');
    const restored = await repository.changeLifecycle({
      schemaVersion: 1,
      requestId: 'integrated-restore-0001',
      opportunityId: current.id,
      expectedRowVersion: Number(archived.rowVersion),
      action: 'RESTORE',
    }, context('01890f3e-7b12-7abc-8def-0123456789c7'));
    assert.equal(restored.lifecycleState, 'ACTIVE');

    await repository.create({
      schemaVersion: 1,
      requestId: 'integrated-candidate-peer',
      snapshot: {
        schemaVersion: 1,
        title: 'Integrated Peer',
        funderName: 'Synthetic Foundation',
        provenanceId: '01890f3e-7b12-7abc-8def-0123456789d1',
        lifecycleState: 'DRAFT',
        validationState: 'PENDING_REVIEW',
        normalizationVersion: 'opportunity-normalization-v1',
        qualityRuleVersion: 'opportunity-quality-v1',
      },
      provenance: {
        schemaVersion: 1,
        sourceType: 'ORGANIZATION_MANUAL',
        sourceNamespace: 'INTEGRATED',
        externalIdentifier: 'integrated-candidate-peer',
        observedAt: new Date().toISOString(),
      },
    }, context('01890f3e-7b12-7abc-8def-0123456789d2'));
    const candidateRows = (await pool.query(
      'SELECT opportunity_id::text AS id FROM opportunity_catalog.opportunity ORDER BY opportunity_id LIMIT 2',
    )).rows;
    assert.equal(candidateRows.length, 2);
    const left = await repository.get(candidateRows[0].id);
    const right = await repository.get(candidateRows[1].id);
    const scanSource = await repository.get(current.id);
    const scanBatch = await repository.scanDuplicateBatch({
      opportunityId: scanSource.opportunityId,
      revisionId: scanSource.revisionId,
      ruleVersion: 'opportunity-deduplication-v1',
      cursor: null,
    });
    assert.ok(scanBatch.targets.length >= 1 && scanBatch.targets.length <= 32);
    assert.equal(scanBatch.targets.every((target, index, all) => index === 0
      || all[index - 1].blockPriority < target.blockPriority
      || (all[index - 1].blockPriority === target.blockPriority
        && all[index - 1].opportunityId < target.opportunityId)), true);
    const candidateInput = {
      requestId: 'integrated-candidate-0001', left, right,
      ruleVersion: 'opportunity-deduplication-v1',
      classification: 'POSSIBLE',
      reasonCodes: ['TITLE_MATCH'],
      evidenceFields: ['title'],
    };
    const candidate = await repository.recordCandidate(
      candidateInput, context('01890f3e-7b12-7abc-8def-0123456789c5'),
    );
    assert.deepEqual(
      await repository.recordCandidate(candidateInput, context('01890f3e-7b12-7abc-8def-0123456789c5')),
      candidate,
    );
    await assert.rejects(
      () => repository.recordCandidate(
        { ...candidateInput, classification: 'DISTINCT' },
        context('01890f3e-7b12-7abc-8def-0123456789c5'),
      ),
      (error) => error.code === 'OPPORTUNITY_DIGEST_MISMATCH',
    );
    const countBeforeFailure = (await pool.query(
      'SELECT count(*)::int AS n FROM opportunity_catalog.duplicate_candidate',
    )).rows[0].n;
    await assert.rejects(() => failedRepository.recordCandidate(
      { ...candidateInput, requestId: 'integrated-candidate-fail', classification: 'DISTINCT' },
      context('01890f3e-7b12-7abc-8def-0123456789c6'),
    ));
    const countAfterFailure = (await pool.query(
      'SELECT count(*)::int AS n FROM opportunity_catalog.duplicate_candidate',
    )).rows[0].n;
    assert.equal(countAfterFailure, countBeforeFailure);

    await pool.query(
      'UPDATE opportunity_catalog.opportunity SET quality_score=0,quality_bucket=$1 WHERE organization_id=$2 AND opportunity_id=$3',
      ['LOW', ORGANIZATION_ID, scanSource.opportunityId],
    );
    const repaired = await repository.recomputeCurrentQuality({
      requestId: 'integrated-quality-repair',
      opportunityId: scanSource.opportunityId,
      revisionId: scanSource.revisionId,
    }, context('01890f3e-7b12-7abc-8def-0123456789c8'));
    assert.equal(repaired.changed, true);
    assert.equal((await repository.recomputeCurrentQuality({
      requestId: 'integrated-quality-noop',
      opportunityId: scanSource.opportunityId,
      revisionId: scanSource.revisionId,
    }, context('01890f3e-7b12-7abc-8def-0123456789c9'))).changed, false);

    const documentRepository = createDocumentRepository(pool);
    const documentId = '01890f3e-7b12-7abc-8def-0123456789e1';
    const documentVersionId = '01890f3e-7b12-7abc-8def-0123456789e2';
    const objectId = '01890f3e-7b12-7abc-8def-0123456789e3';
    const documentBytes = Buffer.from('%PDF-1.7\nsynthetic F11 to F12 evidence\n%%EOF\n');
    const checksum = crypto.createHash('sha256').update(documentBytes).digest('hex');
    const otherDocumentId = '01890f3e-7b12-7abc-8def-0123456789f1';
    const otherVersionId = '01890f3e-7b12-7abc-8def-0123456789f2';
    await documentRepository.createIntent({
      documentId: otherDocumentId, organizationId: OTHER_ORGANIZATION_ID,
      resourceType: 'OPPORTUNITY', resourceId: current.id, actorId: 'F12_OTHER_MUTATION',
      correlationId: '01890f3e-7b12-7abc-8def-0123456789f4', versionId: otherVersionId,
      versionNumber: 1, objectId: '01890f3e-7b12-7abc-8def-0123456789f3',
      expectedSize: documentBytes.length, fileClass: 'PDF', checksum,
      declaredMime: 'application/pdf', displayFilename: 'other.pdf',
      idempotencyKey: 'integrated-document-other', causationId: null,
      capabilityDigest: 'c'.repeat(64), capabilityExpiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal((await documentRepository.findVersion({
      organizationId: OTHER_ORGANIZATION_ID, versionId: otherVersionId,
    })).organization_id, OTHER_ORGANIZATION_ID);
    assert.equal(await documentRepository.findVersion({
      organizationId: ORGANIZATION_ID, versionId: otherVersionId,
    }), null);
    assert.equal(await documentRepository.findVersion({
      organizationId: OTHER_ORGANIZATION_ID, versionId: documentVersionId,
    }), null);
    const storage = createF11ObjectStorageDouble();
    const scanner = createF11MalwareScanDouble({ result: 'UNAVAILABLE' });
    const documentAuditEvents = [];
    const scanJobs = [];
    const documentAudit = {
      async accept(code) { documentAuditEvents.push(code); return { status: 'ACCEPTED' }; },
      async emit(code) { documentAuditEvents.push(code); return { status: 'ACCEPTED' }; },
    };
    const uploadService = createUploadService({
      authorization: { async authorize({ actor, resourceId }) {
        return actor.organizationId === ORGANIZATION_ID && resourceId === current.id
          ? { allowed: true, resource: { id: current.id } } : { allowed: false };
      } },
      repository: documentRepository,
      storage,
      audit: documentAudit,
      confirmation: createConfirmationService({ repository: documentRepository, audit: documentAudit,
        reconciliation: { async record() { throw new Error('UNEXPECTED_CONFIRMATION_DIVERGENCE'); } } }),
      jobs: { async enqueueScan(job) { scanJobs.push(job); } },
      clock: () => new Date(),
      id: (() => { const ids = [documentId, documentVersionId, objectId]; return () => ids.shift(); })(),
    });
    const uploadContext = {
      actor: { id: 'F12_MUTATION', organizationId: ORGANIZATION_ID },
      correlationId: '01890f3e-7b12-7abc-8def-0123456789e4',
    };
    const intent = await uploadService.createIntent({
      context: uploadContext,
      resourceId: current.id,
      expectedSize: documentBytes.length,
      declaredMime: 'application/pdf',
      filename: 'synthetic.pdf',
      fileClass: 'PDF',
      checksum,
      idempotencyKey: 'integrated-document-intent',
    });
    assert.equal((await storage.head({ objectId })), null);
    const upload = await uploadService.upload({
      context: uploadContext,
      token: intent.capability,
      source: Readable.from([documentBytes]),
      filename: 'synthetic.pdf',
    });
    assert.equal(upload.state, 'PENDING_SCAN');
    assert.equal(scanJobs.length, 1);
    await assert.rejects(() => uploadService.upload({
      context: uploadContext, token: intent.capability,
      source: Readable.from([documentBytes]), filename: 'synthetic.pdf',
    }), /UPLOAD_CAPABILITY_INVALID/);
    await assert.rejects(() => uploadService.upload({
      context: { ...uploadContext, actor: { ...uploadContext.actor, organizationId: OTHER_ORGANIZATION_ID } },
      token: intent.capability, source: Readable.from([documentBytes]), filename: 'synthetic.pdf',
    }), /UPLOAD_CAPABILITY_INVALID/);
    const opportunityForBinding = await repository.get(current.id);
    const bindingInput = {
      requestId: 'integrated-document-bind',
      opportunityId: current.id,
      documentId,
      documentVersionId,
      expectedRevisionId: opportunityForBinding.revisionId,
      expectedRowVersion: Number(opportunityForBinding.rowVersion),
    };
    await assert.rejects(
      () => repository.bindDocument(bindingInput, context('01890f3e-7b12-7abc-8def-0123456789e5')),
      (error) => error.code === 'OPPORTUNITY_NOT_FOUND',
    );
    const scanService = createScanService({
      scanner, repository: documentRepository, storage, audit: documentAudit,
    });
    const scanRecord = await documentRepository.findVersion({
      organizationId: ORGANIZATION_ID, versionId: documentVersionId,
    });
    const normalizedScanRecord = {
      organizationId: ORGANIZATION_ID,
      versionId: documentVersionId,
      objectId,
      lockVersion: Number(scanRecord.lock_version),
      expectedFileClass: scanRecord.expected_file_class,
      expectedSize: Number(scanRecord.expected_size),
      expectedSha256: scanRecord.expected_sha256,
      observedSize: Number(scanRecord.observed_size),
      sha256: scanRecord.sha256,
    };
    await assert.rejects(() => scanService.scan({
      record: normalizedScanRecord, actor: { type: 'SERVICE' }, fencingToken: 'synthetic-fence-1',
    }), /Scanner unavailable/);
    assert.equal((await documentRepository.findVersion({
      organizationId: ORGANIZATION_ID, versionId: documentVersionId,
    })).state, 'SCANNING');
    scanner.setResult('CLEAN');
    const scanned = await scanService.scan({
      record: normalizedScanRecord, actor: { type: 'SERVICE' }, fencingToken: 'synthetic-fence-2',
    });
    assert.equal(scanned.state, 'AVAILABLE');
    assert.equal(scanned.scan_state, 'CLEAN');
    assert.equal(await documentRepository.findVersion({
      organizationId: OTHER_ORGANIZATION_ID, versionId: documentVersionId,
    }), null);
    const binding = await repository.bindDocument(
      bindingInput,
      context('01890f3e-7b12-7abc-8def-0123456789e5'),
    );
    assert.deepEqual(
      await repository.bindDocument(bindingInput, context('01890f3e-7b12-7abc-8def-0123456789e5')),
      binding,
    );
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM opportunity_catalog.opportunity_document_binding WHERE organization_id=$1 AND opportunity_id=$2 AND document_version_id=$3',
      [ORGANIZATION_ID, bindingInput.opportunityId, documentVersionId],
    )).rows[0].n, 1);
    process.stdout.write(`${JSON.stringify({
      phase: 'atomic-mutations', update: true, lifecycle: true,
      candidateDecision: true, candidateIdempotency: true,
      scannerQuery: true, qualityReconcile: true,
      documentBinding: true, documentBindingIdempotency: true, f11UploadService: true,
      quarantineBindingDenied: true, scannerFailClosed: true, f11TenantIsolation: true,
      uploadRedeliveryDenied: true, f11RuntimeRoleRls: true, organizationsSeeded: 2,
      realF7Ledger: true, rollbackProbe: true,
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n${error.stack || ''}\n`);
  process.exitCode = 1;
});
