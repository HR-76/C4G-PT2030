'use strict';
const { canonicalClone, canonicalize } = require('../organizationalProfile/canonicalization');
const { verificationState } = require('../organizationalProfile/pq1Material');
const { instant, uuid } = require('./materializer');
const { fail } = require('./release');
const iso = value => value instanceof Date ? value.toISOString() : value;
// Source-local reader; transaction ownership, authentication, F11, catalog
// compatibility and commit guards remain mandatory responsibilities of the
// composition. This reader is deliberately not an authorization endpoint.
async function observeVerifications(client, organizationId, content, clock = () => new Date()) {
  uuid(organizationId);
  if (!Array.isArray(content.verifications) || content.verifications.length > 100) fail('LIMIT_EXCEEDED');
  const locked = (await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301)), pg_current_xact_id()::text AS transaction_id", [organizationId])).rows[0]?.transaction_id;
  const isolation = (await client.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation;
  if (isolation !== 'read committed') fail('TRANSACTION_INCOMPATIBLE');
  const ids = content.verifications.map(v => v.verificationId);
  ids.forEach(uuid);
  if (new Set(ids).size !== ids.length) fail();
  const rows = (await client.query(`SELECT v.*,e.event_id,e.sequence,e.status AS revocation_status,
    e.reason_code,e.recorded_at AS revoked_at
    FROM organization_profile.competency_verification_result v
    LEFT JOIN organization_profile.pq1_verification_status_event e
      ON e.organization_id=v.organization_id AND e.verification_id=v.verification_id
    WHERE v.organization_id=$1 AND v.verification_id=ANY($2::uuid[])
    ORDER BY v.verification_id`, [organizationId, ids])).rows;
  if (rows.length !== ids.length) fail();
  const byId = new Map(rows.map(row => [row.verification_id, row]));
  if (byId.size !== ids.length) fail();
  // Observe time AFTER locks/reads. A wait must not backdate an evaluation.
  const observedAt = clock().toISOString(); instant(observedAt);
  const verifications = content.verifications.map(v => {
    const row = byId.get(v.verificationId);
    if (!row || v.organizationId !== organizationId || row.organization_id !== organizationId
      || row.assertion_version_id !== v.assertionVersionId || row.method_id !== v.method.methodId
      || row.material_digest !== v.materialDigest || row.status !== v.originalStatus
      || row.actor_subject_id !== v.actorSubjectId || iso(row.verified_at) !== v.verifiedAt
      || iso(row.valid_until) !== v.validUntil) fail();
    const revocation = row.event_id ? { eventId: row.event_id, verificationId: row.verification_id,
      status: row.revocation_status, recordedAt: iso(row.revoked_at) } : null;
    if (revocation && Number(row.sequence) !== 1) fail();
    if (v.revocation && (!revocation || v.revocation.eventId !== revocation.eventId)) fail();
    const status = verificationState(v, observedAt, revocation);
    return { verificationId: v.verificationId, assertionVersionId: v.assertionVersionId, status,
      validUntil: v.validUntil, revocation };
  });
  const current = (await client.query('SELECT pg_current_xact_id()::text AS transaction_id')).rows[0]?.transaction_id;
  if (!locked || locked !== current) fail('TRANSACTION_REQUIRED');
  return canonicalClone({ organizationId, observedAt, verifications });
}
function assertObservation(content, observation, organizationId, evaluatedAt) {
  if (observation.organizationId !== organizationId || observation.observedAt !== evaluatedAt) fail();
  const expected = content.verifications.map(v => v.verificationId).sort();
  if (canonicalize(expected) !== canonicalize(observation.verifications.map(v => v.verificationId).sort())) fail();
  for (const v of content.verifications) {
    const seen = observation.verifications.find(row => row.verificationId === v.verificationId);
    if (v.revocation && (!seen.revocation || seen.revocation.eventId !== v.revocation.eventId)) fail();
    if (seen.assertionVersionId !== v.assertionVersionId || seen.validUntil !== v.validUntil
      || seen.status !== verificationState(v, evaluatedAt, seen.revocation)) fail();
  }
}
module.exports = { observeVerifications, assertObservation };
