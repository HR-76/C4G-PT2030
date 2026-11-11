'use strict';
const { randomUUID } = require('node:crypto');
const { intentDigest } = require('../security/tenantRepositorySupport');
const { createAuthoringRepository } = require('./authoringRepository');
const { loadEditorialAuthors, loadEditorialRevision } = require('./editorialSource');
const { loadPq1Material, documentAuthorizations } = require('./pq1Source');
const material = require('./pq1Material');
const { resolvePq1Release } = require('./pq1Release');
const { canonicalize } = require('./canonicalization');
const { OrganizationalProfileContractError } = require('./errors');
const OPERATIONS = Object.freeze({ submit: 'PQ1_SUBMIT', approve: 'PQ1_APPROVE', publish: 'PQ1_PUBLISH' });
function fail(code) { throw new OrganizationalProfileContractError(code); }
function createPq1Repository({ organizationId, auditWriter, clock = () => new Date() }) {
  const authoring = createAuthoringRepository({ organizationId, auditWriter, materialExtension: require('./competencyMaterial') });
  function intention(method, command) {
    if (!OPERATIONS[method]) return null;
    return { operation: OPERATIONS[method], digest: intentDigest({ organizationId, operation: OPERATIONS[method], command }) };
  }
  async function lockIntention(client, method, command) {
    if (!OPERATIONS[method]) return false;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-PQ1:' || $1 || ':' || $2 || ':' || $3,43001316))",
      [organizationId, OPERATIONS[method], command.idempotencyKey]);
    return Boolean((await client.query(`SELECT 1 FROM organization_profile.pq1_idempotency_record
      WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`, [organizationId, OPERATIONS[method], command.idempotencyKey])).rowCount);
  }
  async function reconcile(client, method, command) {
    const row = (await client.query(`SELECT intention_digest,result_projection FROM organization_profile.pq1_idempotency_record
      WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`, [organizationId, OPERATIONS[method], command.idempotencyKey])).rows[0];
    if (!row) return null;
    if (row.intention_digest !== intention(method, command).digest) fail('F13_IDEMPOTENCY_CONFLICT');
    return row.result_projection;
  }
  async function candidate(client, id) {
    const row = (await client.query(`SELECT * FROM organization_profile.pq1_candidate WHERE organization_id=$1 AND candidate_id=$2`, [organizationId, id])).rows[0];
    if (!row) fail('F13_RESOURCE_NOT_AVAILABLE');
    return row;
  }
  async function version(client, id) {
    const row = (await client.query(`SELECT v.*,p.publication_id FROM organization_profile.pq1_version v
      LEFT JOIN organization_profile.pq1_publication p USING(organization_id,version_id)
      WHERE v.organization_id=$1 AND v.version_id=$2`, [organizationId, id])).rows[0];
    if (!row) fail('F13_RESOURCE_NOT_AVAILABLE');
    return row;
  }
  async function resource(client, method, command, replay) {
    if (method === 'submit') {
      const loaded = await require('./authoringResources').createAuthoringResourceLoader({ organizationId }).load(client, 'submitDraft', command, replay);
      if (loaded.scopeType !== 'ORGANIZATION') fail('F13_RESOURCE_NOT_AVAILABLE');
      const source = await loadEditorialRevision(client, organizationId, command.draftId, Number(command.expectedRevision));
      const extracted = await loadPq1Material(client, organizationId, source, clock().toISOString());
      return { resource: loaded, content: extracted.content, additionalAuthorizations: extracted.additionalAuthorizations };
    }
    const v = command.versionId ? await version(client, command.versionId) : null;
    const c = await candidate(client, v ? v.candidate_id : command.candidateId);
    const authors = (await client.query(`SELECT subject_id FROM organization_profile.pq1_candidate_author
      WHERE organization_id=$1 AND candidate_id=$2 ORDER BY subject_id`, [organizationId, c.candidate_id])).rows.map(row => row.subject_id);
    if (canonicalize(authors) !== canonicalize(c.identity_record.authors.map(a => a.subjectId))) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    const additionalAuthorizations = await documentAuthorizations(client, organizationId, c.pq1_content.links);
    return { candidate: c, version: v, content: c.pq1_content, additionalAuthorizations, resource: Object.freeze({ id: command.versionId || command.candidateId,
      organizationId, resourceType: method === 'approve' ? 'PROFILE_DRAFT_REVISION' : method === 'publish' ? 'PROFILE_VERSION' : 'PROFILE_PROJECTION',
      scopeType: 'ORGANIZATION', scopeId: null, status: 'ACTIVE', unitId: null, ancestorUnitIds: [], teamIds: [],
      distinctFromActorIds: ['approve', 'publish'].includes(method) ? authors : [] }) };
  }
  async function validateCandidate(client, c) {
    const refs = await resolvePq1Release(client);
    if (Object.entries(refs).some(([key, value]) => canonicalize(value) !== canonicalize(c.identity_record[key]))) fail('F13_POLICY_UNAVAILABLE');
    const source = await loadEditorialRevision(client, organizationId, c.draft_id, Number(c.source_revision));
    const extracted = await loadPq1Material(client, organizationId, source, clock().toISOString());
    // Re-observe mutable support, but keep the capture instant pinned. A change
    // to verification status requires another explicit submission/approval.
    const pinned = { ...extracted.content, observedAt: c.pq1_content.observedAt };
    if (canonicalize(pinned.verifications) !== canonicalize(c.pq1_content.verifications)) fail('F13_APPROVAL_STALE');
    extracted.content = pinned;
    extracted.editorialDigest = material.digest(pinned);
    const completion = material.complete(pinned, refs.policyRef);
    const authors = await loadEditorialAuthors(client, organizationId, c.draft_id, Number(c.source_revision), material.createAuthorAccumulator(c.submitter_subject_id, extracted.content));
    if (source.digest !== c.source_digest || extracted.editorialDigest !== c.pq1_digest
      || canonicalize(extracted.content) !== canonicalize(c.pq1_content)
      || completion.completionDigest !== c.completion_digest || canonicalize(completion.record) !== canonicalize(c.completion_record)
      || canonicalize(authors) !== canonicalize(c.identity_record.authors)
      || material.candidateDigest(c.identity_record) !== c.candidate_digest) fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
    return completion;
  }
  async function audit(client, method, input, id, c, versionId) {
    const eventCode = method === 'approve' ? 'PROFILE_VERSION_APPROVED' : 'PROFILE_VERSION_PUBLISHED';
    const result = await auditWriter.append(client, { eventCode,
      operationCode: method === 'approve' ? 'F13_PROFILE_APPROVE' : 'F13_PROFILE_PUBLISH',
      resourceType: method === 'approve' ? 'PROFILE_DRAFT_REVISION' : 'PROFILE_VERSION', resourceId: id,
      actor: input.actor, authorizationEvidence: input.authorizationEvidence, correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey, detailCode: method === 'approve' ? 'APPROVED' : 'PUBLISHED',
      previousVersion: String(c.source_revision), newVersion: versionId, candidateRef: c.candidate_id,
      versionRef: versionId, completionResult: c.completion_record.result });
    if (!result || !['APPENDED', 'DUPLICATE', 'ACCEPTED'].includes(result.status)) fail('F13_PERSISTENCE_UNAVAILABLE');
  }
  async function execute(client, method, command, input, loaded) {
    if (method.startsWith('read')) {
      const c = loaded.candidate, v = loaded.version;
      if (material.digest(c.pq1_content) !== c.pq1_digest || material.candidateDigest(c.identity_record) !== c.candidate_digest)
        fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
      return Object.freeze({ ...(v ? { versionId: v.version_id, state: v.publication_id ? 'PUBLISHED' : 'APPROVED', active: false }
        : { candidateId: c.candidate_id, state: 'SUBMITTED' }), content: c.pq1_content,
      coverage: c.pq1_content.coverage, completion: c.completion_record });
    }
    const old = await reconcile(client, method, command);
    if (old) return old;
    let result;
    if (method === 'submit') {
      const refs = await resolvePq1Release(client);
      // Same prepared client and transaction: no intermediate commit or nested runtime.
      await authoring.lockIntention(client, 'submitDraft', command);
      const submitted = await authoring.submitDraft(client, { ...command, ...input, resource: loaded.resource });
      const source = await loadEditorialRevision(client, organizationId, command.draftId, submitted.revision);
      const extracted = await loadPq1Material(client, organizationId, source, clock().toISOString());
      const completion = material.complete(extracted.content, refs.policyRef);
      const authors = await loadEditorialAuthors(client, organizationId, command.draftId, submitted.revision, material.createAuthorAccumulator(input.actor.id, extracted.content));
      const scope = (await client.query(`SELECT profile_scope_id FROM organization_profile.profile_draft
        WHERE organization_id=$1 AND draft_id=$2`, [organizationId, command.draftId])).rows[0].profile_scope_id;
      const identity = { organizationId, profileScopeId: scope, source: { draftId: source.draftId, revision: source.revision,
        digest: source.digest, producerContract: source.producerContract }, editorialDigest: extracted.editorialDigest,
      ...refs, extractorVersion: material.EXTRACTOR, submitterSubjectId: input.actor.id, authors, completionDigest: completion.completionDigest };
      const id = randomUUID(), hash = material.candidateDigest(identity);
      await client.query(`INSERT INTO organization_profile.pq1_candidate
        (candidate_id,organization_id,profile_scope_id,draft_id,source_revision,source_digest,pq1_digest,candidate_digest,
        completion_digest,extractor_version,identity_record,pq1_content,completion_record,submitter_subject_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [id, organizationId, scope, source.draftId,
        source.revision, source.digest, extracted.editorialDigest, hash, completion.completionDigest, material.EXTRACTOR,
        JSON.stringify(identity), JSON.stringify(extracted.content), JSON.stringify(completion.record), input.actor.id]);
      for (const author of authors) await client.query(`INSERT INTO organization_profile.pq1_candidate_author
        (organization_id,candidate_id,subject_id,reasons,evidence_refs) VALUES($1,$2,$3,$4,$5)`,
      [organizationId, id, author.subjectId, author.reasons, JSON.stringify(author.evidenceRefs)]);
      result = { candidateId: id, sourceRevision: source.revision, candidateDigest: hash, coverage: material.COVERAGE, completion: completion.record };
    } else {
      const c = loaded.candidate;
      const completion = await validateCandidate(client, c);
      if (completion.record.result !== 'COMPLETE') fail('F13_COMPLETION_INCOMPLETE');
      if ((command.expectedCandidateDigest || command.expectedVersionDigest) !== c.candidate_digest) fail('F13_DIGEST_MISMATCH');
      if (method === 'approve') {
        if (!input.editorialAuthorityEvidence) fail('F13_AUTHORIZATION_REQUIRED');
        if ((await client.query(`SELECT 1 FROM organization_profile.pq1_version WHERE organization_id=$1 AND candidate_id=$2`, [organizationId, c.candidate_id])).rowCount) fail('F13_STATE_CONFLICT');
        const id = randomUUID();
        await client.query(`INSERT INTO organization_profile.pq1_version
          (version_id,organization_id,candidate_id,version_digest,approver_subject_id,approver_membership_id,approval_evidence)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, organizationId, c.candidate_id, c.candidate_digest,
          input.actor.id, input.actor.membershipId, JSON.stringify(input.editorialAuthorityEvidence)]);
        await audit(client, method, input, c.candidate_id, c, id);
        result = { versionId: id, versionDigest: c.candidate_digest, state: 'APPROVED' };
      } else {
        if (loaded.version.publication_id) fail('F13_STATE_CONFLICT');
        await client.query(`INSERT INTO organization_profile.pq1_publication
          (publication_id,organization_id,version_id,publisher_subject_id,publication_evidence) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), organizationId, loaded.version.version_id, input.actor.id, JSON.stringify(input.authorizationEvidence)]);
        await audit(client, method, input, loaded.version.version_id, c, loaded.version.version_id);
        result = { versionId: loaded.version.version_id, state: 'PUBLISHED', active: false };
      }
    }
    await client.query(`INSERT INTO organization_profile.pq1_idempotency_record
      (organization_id,operation,idempotency_key,intention_digest,result_projection) VALUES($1,$2,$3,$4,$5)`,
    [organizationId, OPERATIONS[method], command.idempotencyKey, intention(method, command).digest, JSON.stringify(result)]);
    return Object.freeze(result);
  }
  return Object.freeze({ intention, lockIntention, reconcile, resource, execute });
}
module.exports = { createPq1Repository };
