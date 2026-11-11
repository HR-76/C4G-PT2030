'use strict';
const { OrganizationalScopeError, mapDatabaseError } = require('./errors');
const { intentDigest } = require('../security/tenantRepositorySupport');

const SELECT = `scope_id::text AS "scopeId",organization_id::text AS "organizationId",scope_type AS "scopeType",label,stable_code AS "stableCode",parent_scope_id::text AS "parentScopeId",lifecycle,revision,provenance,created_at AS "createdAt",updated_at AS "updatedAt",archived_at AS "archivedAt"`;
function digest(value) { return intentDigest(value); }
function freeze(row) { if (!row) return null; const out = {}; for (const [key,value] of Object.entries(row)) out[key] = value instanceof Date ? value.toISOString() : value; return Object.freeze(out); }

function createRepository({ organizationId, identityFactory, auditWriter, participantRegistry }) {
  if (typeof organizationId !== 'string' || !identityFactory || typeof identityFactory.next !== 'function'
      || !auditWriter || typeof auditWriter.append !== 'function' || !participantRegistry
      || typeof participantRegistry.beforeArchive !== 'function') throw new TypeError('Organizational scope repository configuration is invalid.');

  async function lockOrganization(client) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text, 43001301))", [organizationId]);
  }
  async function replay(client, operation, idempotencyKey, intentionDigest) {
    const row = (await client.query(`SELECT intention_digest,result_projection FROM organizational_scope.idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`, [organizationId,operation,idempotencyKey])).rows[0];
    if (!row) return null;
    if (row.intention_digest !== intentionDigest) throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_IDEMPOTENCY_CONFLICT');
    return freeze(row.result_projection);
  }
  async function persist(client, operation, input, intentionDigest, result) {
    await client.query(`INSERT INTO organizational_scope.idempotency_record(organization_id,operation,idempotency_key,intention_digest,scope_id,result_projection) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [organizationId,operation,input.idempotencyKey,intentionDigest,result.scopeId,JSON.stringify(result)]);
  }
  async function resource(client, scopeId, { lock = false, operational = true } = {}) {
    const row = (await client.query(`SELECT ${SELECT} FROM organizational_scope.scope WHERE organization_id=$1 AND scope_id=$2${lock ? ' FOR UPDATE' : ''}`, [organizationId,scopeId])).rows[0];
    if (!row || (operational && row.lifecycle !== 'ACTIVE')) throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_NOT_AVAILABLE');
    return freeze(row);
  }
  async function audit(client, eventCode, input, scope, detailCode) {
    const result = await auditWriter.append(client, Object.freeze({ eventCode, scopeId: scope.scopeId, scopeType: scope.scopeType,
      revision: Number(scope.revision), detailCode, actor: input.actor, idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId }));
    if (!result || !['APPENDED','DUPLICATE','ACCEPTED'].includes(result.status)) throw new Error('ORGANIZATIONAL_SCOPE_CRITICAL_AUDIT_UNAVAILABLE');
  }
  async function parent(client, id) {
    if (id === null) return null;
    const value = await resource(client,id,{lock:true,operational:true});
    if (value.scopeType !== 'UNIT') throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_DEPENDENCY_CONFLICT');
    return value;
  }
  async function loadAuthorizationResource(client, { resourceType, resourceId }) {
    if (resourceType === 'ORGANIZATION' && resourceId === organizationId) {
      return Object.freeze({ id: organizationId, organizationId, scopeType: 'ORGANIZATION', status: 'ACTIVE', unitId: null,
        ancestorUnitIds: Object.freeze([]), teamIds: Object.freeze([]) });
    }
    if (resourceType !== 'ORGANIZATIONAL_SCOPE') return null;
    const value = await resource(client, resourceId, { operational: false });
    return Object.freeze({ id: value.scopeId, organizationId: value.organizationId, scopeType: value.scopeType,
      status: value.lifecycle, unitId: value.scopeType === 'UNIT' ? value.scopeId : null,
      ancestorUnitIds: Object.freeze([]), teamIds: Object.freeze(value.scopeType === 'TEAM' ? [value.scopeId] : []) });
  }
  async function createScope(client, input) {
    const intention = digest({ operation:'CREATE', organizationId, scopeType:input.scopeType, label:input.label, stableCode:input.stableCode, parentScopeId:input.parentScopeId, actor:input.actor, provenance:input.provenance });
    await lockOrganization(client);
    const previous = await replay(client,'CREATE',input.idempotencyKey,intention); if (previous) return previous;
    await parent(client,input.parentScopeId);
    const scopeId = identityFactory.next();
    const row = (await client.query(`INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,stable_code,parent_scope_id,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$8,$9) RETURNING ${SELECT}`, [scopeId,organizationId,input.scopeType,input.label,input.stableCode,input.parentScopeId,JSON.stringify(input.provenance),input.actor.type,input.actor.id])).rows[0];
    const result=freeze(row); await audit(client,'ORGANIZATIONAL_SCOPE_CREATED',input,result,'CREATED'); await persist(client,'CREATE',input,intention,result); return result;
  }
  async function renameLabel(client,input) {
    const intention=digest({operation:'RENAME_LABEL',organizationId,scopeId:input.scopeId,expectedRevision:input.expectedRevision,label:input.label,actor:input.actor,provenance:input.provenance});
    await lockOrganization(client);
    const previous=await replay(client,'RENAME_LABEL',input.idempotencyKey,intention);if(previous)return previous;
    const current=await resource(client,input.scopeId,{lock:true}); if(Number(current.revision)!==input.expectedRevision)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STALE_REVISION');
    const row=(await client.query(`UPDATE organizational_scope.scope SET label=$1,revision=revision+1,provenance=$2::jsonb,updated_at=transaction_timestamp(),updated_by_actor_type=$3,updated_by_actor_id=$4 WHERE organization_id=$5 AND scope_id=$6 AND revision=$7 RETURNING ${SELECT}`,[input.label,JSON.stringify(input.provenance),input.actor.type,input.actor.id,organizationId,input.scopeId,input.expectedRevision])).rows[0];
    if(!row)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STALE_REVISION');const result=freeze(row);await audit(client,'ORGANIZATIONAL_SCOPE_RENAMED',input,result,'LABEL_RENAMED');await persist(client,'RENAME_LABEL',input,intention,result);return result;
  }
  async function reparentScope(client,input) {
    const intention=digest({operation:'REPARENT',organizationId,scopeId:input.scopeId,expectedRevision:input.expectedRevision,parentScopeId:input.parentScopeId,actor:input.actor,provenance:input.provenance});
    await lockOrganization(client);
    const previous=await replay(client,'REPARENT',input.idempotencyKey,intention);if(previous)return previous;
    const ids=[input.scopeId,input.parentScopeId].filter(Boolean).sort();
    await client.query(`SELECT scope_id FROM organizational_scope.scope WHERE organization_id=$1 AND scope_id=ANY($2::uuid[]) ORDER BY scope_id FOR UPDATE`,[organizationId,ids]);
    const current=await resource(client,input.scopeId);if(Number(current.revision)!==input.expectedRevision)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STALE_REVISION');await parent(client,input.parentScopeId);
    if(input.parentScopeId){const cycle=await client.query(`WITH RECURSIVE d AS (SELECT scope_id FROM organizational_scope.scope WHERE organization_id=$1 AND parent_scope_id=$2 UNION ALL SELECT s.scope_id FROM organizational_scope.scope s JOIN d ON s.parent_scope_id=d.scope_id WHERE s.organization_id=$1) SELECT 1 FROM d WHERE scope_id=$3 LIMIT 1`,[organizationId,input.scopeId,input.parentScopeId]);if(cycle.rowCount)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_DEPENDENCY_CONFLICT');}
    const row=(await client.query(`UPDATE organizational_scope.scope SET parent_scope_id=$1,revision=revision+1,provenance=$2::jsonb,updated_at=transaction_timestamp(),updated_by_actor_type=$3,updated_by_actor_id=$4 WHERE organization_id=$5 AND scope_id=$6 AND revision=$7 AND lifecycle='ACTIVE' RETURNING ${SELECT}`,[input.parentScopeId,JSON.stringify(input.provenance),input.actor.type,input.actor.id,organizationId,input.scopeId,input.expectedRevision])).rows[0];
    if(!row)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STALE_REVISION');const result=freeze(row);await audit(client,'ORGANIZATIONAL_SCOPE_REPARENTED',input,result,'REPARENTED');await persist(client,'REPARENT',input,intention,result);return result;
  }
  async function archiveScope(client,input) {
    const intention=digest({operation:'ARCHIVE',organizationId,scopeId:input.scopeId,expectedRevision:input.expectedRevision,reasonCode:input.reasonCode,actor:input.actor,provenance:input.provenance});
    await lockOrganization(client);
    const previous=await replay(client,'ARCHIVE',input.idempotencyKey,intention);if(previous)return previous;
    const current=await resource(client,input.scopeId,{lock:true});if(Number(current.revision)!==input.expectedRevision)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STALE_REVISION');
    const descendants=await client.query(`WITH RECURSIVE d AS (SELECT scope_id,lifecycle FROM organizational_scope.scope WHERE organization_id=$1 AND parent_scope_id=$2 UNION ALL SELECT s.scope_id,s.lifecycle FROM organizational_scope.scope s JOIN d ON s.parent_scope_id=d.scope_id WHERE s.organization_id=$1) SELECT s.scope_id,s.lifecycle FROM organizational_scope.scope s JOIN d ON d.scope_id=s.scope_id ORDER BY s.scope_id FOR UPDATE OF s`,[organizationId,input.scopeId]);
    if(descendants.rows.some(row=>row.lifecycle==='ACTIVE'))throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_DEPENDENCY_CONFLICT');
    await participantRegistry.beforeArchive(client,{organizationId,scopeId:input.scopeId,expectedRevision:input.expectedRevision,actor:input.actor});
    const row=(await client.query(`UPDATE organizational_scope.scope SET lifecycle='ARCHIVED',revision=revision+1,provenance=$1::jsonb,updated_at=transaction_timestamp(),updated_by_actor_type=$2,updated_by_actor_id=$3,archived_at=transaction_timestamp(),archived_by_actor_id=$3,archive_reason_code=$4 WHERE organization_id=$5 AND scope_id=$6 AND revision=$7 AND lifecycle='ACTIVE' RETURNING ${SELECT}`,[JSON.stringify(input.provenance),input.actor.type,input.actor.id,input.reasonCode,organizationId,input.scopeId,input.expectedRevision])).rows[0];
    if(!row)throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STALE_REVISION');const result=freeze(row);await audit(client,'ORGANIZATIONAL_SCOPE_ARCHIVED',input,result,input.reasonCode);await persist(client,'ARCHIVE',input,intention,result);return result;
  }
  return Object.freeze({ archiveScope, createScope, getHistorical:(client,id)=>resource(client,id,{operational:false}),
    getOperational:(client,id)=>resource(client,id), loadAuthorizationResource, renameLabel, reparentScope });
}

module.exports = { createRepository, digest, mapDatabaseError };
