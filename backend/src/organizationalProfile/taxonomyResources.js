'use strict';
const { OrganizationalProfileContractError } = require('./errors');
const TYPES = Object.freeze({ readRelease: 'TAXONOMY_RELEASE', createRelease: 'TAXONOMY_RELEASE_DRAFT',
  createConcept: 'LOCAL_CONCEPT_DRAFT', approveConcept: 'LOCAL_CONCEPT_REVISION',
  createRelation: 'TAXONOMY_RELATION', createMapping: 'TAXONOMY_MAPPING', publishRelease: 'TAXONOMY_RELEASE' });
function missing() { throw new OrganizationalProfileContractError('F13_RESOURCE_NOT_AVAILABLE'); }

function createTaxonomyResourceLoader({ organizationId }) {
  return Object.freeze({ async load(client, method, command, replay) {
    const globalRead = method === 'readRelease';
    const parent = (await client.query(`SELECT release_id::text AS "releaseId",organization_id::text AS "organizationId",
      namespace,lifecycle,provenance FROM organization_profile.catalog_release
      WHERE release_id=$1 AND (organization_id=$2${globalRead ? ' OR organization_id IS NULL' : ''})${globalRead ? '' : ' FOR UPDATE'}`,
    [command.releaseId, organizationId])).rows[0];
    if (method !== 'createRelease' && !parent) missing();
    if (!globalRead && parent && (parent.organizationId !== organizationId || parent.namespace !== 'TENANT')) missing();
    if (!globalRead && parent && parent.lifecycle !== 'DRAFT' && !replay) missing();
    if (method === 'createRelease' && parent && !replay) missing();
    let id = command.releaseId;
    const distinctFromActorIds = [];
    if (method === 'publishRelease') {
      if (parent.provenance?.governance?.creatorSubjectId) distinctFromActorIds.push(parent.provenance.governance.creatorSubjectId);
      for (const [table, key] of [['concept', 'concept_id'], ['concept_relation', 'relation_id'], ['external_mapping', 'mapping_id']]) {
        const rows = await client.query(`SELECT provenance FROM organization_profile.${table} WHERE release_id=$1 ORDER BY ${key} FOR UPDATE`, [command.releaseId]);
        for (const row of rows.rows) {
          const governance = row.provenance?.governance;
          if (!governance?.creatorSubjectId || (table === 'concept' && !governance.approval?.approvedBySubjectId)) missing();
          distinctFromActorIds.push(governance.creatorSubjectId);
          if (governance.approval?.approvedBySubjectId) distinctFromActorIds.push(governance.approval.approvedBySubjectId);
        }
      }
    }
    if (['createConcept', 'createRelation', 'createMapping'].includes(method)) {
      const scheme = (await client.query(`SELECT scheme_code AS "schemeCode" FROM organization_profile.scheme
        WHERE scheme_id=$1 AND release_id=$2 AND organization_id=$3 FOR UPDATE`, [command.schemeId, command.releaseId, organizationId])).rows[0];
      if (!scheme || (command.schemeCode && scheme.schemeCode !== command.schemeCode)) missing();
      const ids = method === 'createConcept' ? [command.conceptId] : method === 'createRelation'
        ? [command.sourceConceptId, command.targetConceptId] : [command.conceptId];
      const rows = await client.query(`SELECT concept_id::text AS id,scheme_id::text AS "schemeId" FROM organization_profile.concept
        WHERE concept_id=ANY($1::uuid[]) AND release_id=$2 AND organization_id=$3 ORDER BY concept_id FOR UPDATE`, [ids, command.releaseId, organizationId]);
      if (method !== 'createConcept' && (rows.rows.length !== new Set(ids).size || rows.rows.some(row => row.schemeId !== command.schemeId))) missing();
      if (method === 'createConcept' && rows.rows.length && (!replay || rows.rows[0].schemeId !== command.schemeId)) missing();
      id = method === 'createConcept' ? command.conceptId : method === 'createRelation' ? command.relationId : command.mappingId;
      if (method !== 'createConcept') {
        const table = method === 'createRelation' ? 'concept_relation' : 'external_mapping';
        const key = method === 'createRelation' ? 'relation_id' : 'mapping_id';
        const existing = (await client.query(`SELECT release_id::text AS "releaseId",scheme_id::text AS "schemeId" FROM organization_profile.${table} WHERE ${key}=$1 FOR UPDATE`, [id])).rows[0];
        if (existing && (!replay || existing.releaseId !== command.releaseId || existing.schemeId !== command.schemeId)) missing();
      }
    }
    if (method === 'approveConcept') {
      const concept = (await client.query(`SELECT provenance FROM organization_profile.concept
        WHERE concept_id=$1 AND release_id=$2 AND organization_id=$3 FOR UPDATE`, [command.conceptId, command.releaseId, organizationId])).rows[0];
      if (!concept?.provenance?.governance?.creatorSubjectId) missing();
      distinctFromActorIds.push(concept.provenance.governance.creatorSubjectId);
      id = command.conceptId;
    }
    return Object.freeze({ id, resourceType: TYPES[method], organizationId, scopeType: 'ORGANIZATION', status: 'ACTIVE',
      global: parent?.organizationId === null, lifecycle: parent?.lifecycle || 'DRAFT',
      distinctFromActorIds: Object.freeze([...new Set(distinctFromActorIds)]), unitId: null,
      ancestorUnitIds: Object.freeze([]), teamIds: Object.freeze([]) });
  } });
}
module.exports = { createTaxonomyResourceLoader, TYPES };
