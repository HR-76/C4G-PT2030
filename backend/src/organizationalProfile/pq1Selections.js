'use strict';
const source = require('./pq1Source');
const { fail } = require('./pq1UiContracts');
async function catalog({ client, organizationId: org, input, context, tokens, allowed }) {
  const binding = { subjectId:context.actor.id,organizationId:org,kind:input.kind,releaseId:input.releaseId || null };
  let position = input.cursor ? tokens.openCursor(input.cursor,binding) : null;
  const items = [];
  for (let scanned = 0; scanned < 10000; scanned += 100) {
    const rows = (await client.query(`SELECT e.*,r.release_version FROM organization_profile.competency_catalog_entry e
      JOIN organization_profile.competency_catalog_release r ON r.release_id=e.release_id AND r.organization_id IS NOT DISTINCT FROM e.organization_id
      WHERE r.lifecycle='PUBLISHED' AND (e.organization_id IS NULL OR e.organization_id=$1) AND e.kind=$2
      AND ($3::uuid IS NULL OR e.release_id=$3) AND ($4::uuid IS NULL OR e.entry_id>$4) ORDER BY e.entry_id LIMIT 100`,
    [org,input.kind,input.releaseId || null,position])).rows;
    for (const row of rows) {
      position = row.entry_id;
      if (!await allowed('F13_TAXONOMY_READ',row.release_id,'TAXONOMY_RELEASE')) continue;
      let extra = {};
      try {
        if (input.kind === 'COMPETENCY_CONCEPT') extra = { conceptRef: await source.concept(client,org,row.entry_id) };
        if (input.kind === 'VERIFICATION_METHOD') extra = await source.method(client,org,row.entry_id);
      } catch (e) { if (e.code === 'F13_REFERENCE_INCOMPATIBLE') continue; throw e; }
      items.push({ entryId:row.entry_id,releaseId:row.release_id,releaseVersion:row.release_version,label:row.stable_code,...extra });
      if (items.length > input.limit) return { items:items.slice(0,input.limit),nextCursor:tokens.cursor(items[input.limit-1].entryId,binding) };
    }
    if (rows.length < 100) return { items,nextCursor:null };
  }
  fail('SERVICE_UNAVAILABLE');
}
async function documents({ client, organizationId: org, draftId, experienceId, input, context, tokens, allowed }) {
  if (!require('./editorialUiContracts').UUID.test(experienceId)) fail('INVALID_INPUT');
  const present = (await client.query(`SELECT 1 FROM organization_profile.profile_draft d
    JOIN organization_profile.competency_revision_member m ON m.organization_id=d.organization_id AND m.draft_id=d.draft_id AND m.revision=d.head_revision AND m.kind='EXPERIENCE'
    JOIN organization_profile.experience_evidence_version e ON e.organization_id=m.organization_id AND e.version_id=m.version_id
    WHERE d.organization_id=$1 AND d.draft_id=$2 AND e.experience_id=$3`,[org,draftId,experienceId])).rowCount;
  if (!present) fail('RESOURCE_NOT_AVAILABLE');
  const binding = { subjectId:context.actor.id,organizationId:org,draftId,experienceId };
  let position = input.cursor ? tokens.openCursor(input.cursor,binding) : null;
  const items = [];
  for (let scanned = 0; scanned < 10000; scanned += 100) {
    const rows = (await client.query('SELECT * FROM document_storage.list_pq1_experience_references($1,$2,$3)',[org,experienceId,position])).rows;
    for (const row of rows) {
      position = row.version_id;
      if (!await allowed('DOCUMENT_READ',row.document_id,'DOCUMENT')) continue;
      items.push({ documentId:row.document_id,documentVersionId:row.version_id });
      if (items.length > input.limit) return { items:items.slice(0,input.limit),nextCursor:tokens.cursor(items[input.limit-1].documentVersionId,binding) };
    }
    if (rows.length < 100) return { items,nextCursor:null };
  }
  fail('SERVICE_UNAVAILABLE');
}
module.exports = { catalog, documents };
