'use strict';
const {randomUUID}=require('node:crypto');
const {intentDigest}=require('../security/tenantRepositorySupport');
const {OrganizationalProfileContractError}=require('./errors');
const {mapError:mapFoundationError}=require('./taxonomyRepository');
function mapError(error){if(/F13_OPERATIONAL_INVALID_REFERENCE/.test(error?.message||''))return new OrganizationalProfileContractError('F13_RESOURCE_NOT_AVAILABLE');if(/F13_OPERATIONAL_(STATE_CONFLICT|INVALID_HEAD|ORG_ONLY)/.test(error?.message||''))return new OrganizationalProfileContractError('F13_STATE_CONFLICT');return mapFoundationError(error);}
const {OPS,STATES,effectiveState}=require('./operationalService');
function fail(code='F13_STATE_CONFLICT'){throw new OrganizationalProfileContractError(code);}
function createOperationalRepository({organizationId,auditWriter}){
 const intention=(method,input)=>{const keys=['assertionId','idempotencyKey',...(method==='create'||method==='read'?[]:['expectedRevision']),
  ...(method==='create'||method==='edit'?['quantity','unitId','metricId','capacityRole','organizationalScopeId','startDate','endDate','provenanceRef','documentVersionIds']:[]),
  ...(method==='verify'?['methodId','validFrom','validUntil']:[]),...(['reject','dispute','revoke','read'].includes(method)?['reasonId']:[]),...(method==='read'?['purposeId']:[])];
  return {operation:'OPERATIONAL_'+method.toUpperCase(),digest:intentDigest({organizationId,operation:method,command:Object.fromEntries(keys.map(key=>[key,input[key]]))})};};
 async function lockIntention(client,method,input){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-OPERATIONAL:' || $1 || ':' || $2 || ':' || $3,43001310))",[organizationId,method,input.idempotencyKey]);return Boolean((await client.query('SELECT 1 FROM organization_profile.operational_idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[organizationId,intention(method,input).operation,input.idempotencyKey])).rowCount);}
 async function entry(client,id,kind,method){if(!(await client.query('SELECT organization_profile.operational_entry_valid($1,$2,$3,$4) valid',[id,organizationId,kind,method.toUpperCase()])).rows[0]?.valid)fail('F13_RESOURCE_NOT_AVAILABLE');}
 async function catalogEvidence(client,id,kind,method){
  await entry(client,id,kind,method);
  const row=(await client.query('SELECT e.entry_id,e.release_id,r.release_version FROM organization_profile.operational_catalog_entry e JOIN organization_profile.operational_catalog_release r ON r.release_id=e.release_id WHERE e.entry_id=$1',[id])).rows[0];
  if(!row)fail('F13_RESOURCE_NOT_AVAILABLE');
  const prefix=kind==='REASON'?'reason':'purpose';
  return {[prefix+'Ref']:row.entry_id,[prefix+'ReleaseRef']:row.release_id,[prefix+'CatalogVersion']:row.release_version};
 }
 function projection(row,now){if(typeof row.start_date!=='string'||typeof row.end_date!=='string')fail('F13_PERSISTENCE_UNAVAILABLE');return Object.freeze({assertionId:row.assertion_id,revision:Number(row.revision),state:effectiveState(row,now),knowledgeStatus:'KNOWN',quantity:row.quantity,unitId:row.unit_id,metricId:row.metric_id,capacityRole:row.capacity_role,organizationalScopeId:row.organizational_scope_id,startDate:row.start_date,endDate:row.end_date,provenanceRef:row.provenance_ref,documentVersionIds:Object.freeze([...row.document_version_ids]),validFrom:row.valid_from?.toISOString()||null,validUntil:row.valid_until?.toISOString()||null});}
 async function replay(client,method,input){const stored=(await client.query('SELECT intention_digest,result_projection FROM organization_profile.operational_idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[organizationId,intention(method,input).operation,input.idempotencyKey])).rows[0];if(!stored)return null;if(stored.intention_digest!==intention(method,input).digest)fail('F13_IDEMPOTENCY_CONFLICT');return method==='read'?projection(input.state.row,input.state.now):Object.freeze(stored.result_projection);}
 async function mutate(client,method,input){const old=await replay(client,method,input);if(old)return old;
  let row=input.state.row,previous=Number(row?.revision||0),revision=previous;
  let catalogReferences={};
  if(input.reasonId)catalogReferences={...catalogReferences,...await catalogEvidence(client,input.reasonId,'REASON',method)};
  if(method==='read')catalogReferences={...catalogReferences,...await catalogEvidence(client,input.purposeId,'PURPOSE',method)};
  if(method!=='read'){
   if(method==='verify')await entry(client,input.methodId,'METHOD',method);
   if(['reject','dispute','revoke'].includes(method))await entry(client,input.reasonId,'REASON',method);
   const content=method==='create'||method==='edit'?{quantity_text:input.quantity,unit_id:input.unitId,metric_id:input.metricId,capacity_role:input.capacityRole,organizational_scope_id:input.organizationalScopeId,start_date:input.startDate,end_date:input.endDate,provenance_ref:input.provenanceRef,document_version_ids:input.documentVersionIds}:row;
   if(method==='create'||method==='edit')await entry(client,content.unit_id,'UNIT','create');
   let scope=input.state.head?.profile_scope_id;
   if(method==='create'){
    const existing=(await client.query("SELECT profile_scope_id FROM organization_profile.profile_scope WHERE organization_id=$1 AND scope_type='ORGANIZATION' AND scope_id IS NULL",[organizationId])).rows[0];scope=existing?.profile_scope_id||randomUUID();
    if(!existing)await client.query("INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id) VALUES($1,$2,'ORGANIZATION',NULL)",[scope,organizationId]);
    await client.query('INSERT INTO organization_profile.operational_assertion(assertion_id,organization_id,profile_scope_id,head_revision) VALUES($1,$2,$3,1)',[input.assertionId,organizationId,scope]);
   }
   revision=previous+1;
   row=(await client.query(`INSERT INTO organization_profile.operational_assertion_revision
    (organization_id,assertion_id,profile_scope_id,revision,operation,state,knowledge_status,quantity_text,unit_id,metric_id,capacity_role,organizational_scope_id,start_date,end_date,provenance_ref,document_version_ids,method_id,reason_id,valid_from,valid_until,actor_subject_id,membership_id,correlation_id,authorization_evidence)
    VALUES($1,$2,$3,$4,$5,$6,'KNOWN',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *,start_date::text AS start_date,end_date::text AS end_date`,
    [organizationId,input.assertionId,scope,revision,method.toUpperCase(),STATES[method],content.quantity_text,content.unit_id,content.metric_id,content.capacity_role,content.organizational_scope_id,content.start_date,content.end_date,content.provenance_ref,content.document_version_ids,
     method==='verify'?input.methodId:method==='edit'?null:row?.method_id||null,input.reasonId||null,method==='verify'?input.validFrom:method==='edit'?null:row?.valid_from||null,method==='verify'?input.validUntil:method==='edit'?null:row?.valid_until||null,input.actor.id,input.actor.membershipId,input.correlationId,JSON.stringify(input.authorizationEvidence)])).rows[0];
   if(previous){const updated=await client.query('UPDATE organization_profile.operational_assertion SET head_revision=$3 WHERE organization_id=$1 AND assertion_id=$2 AND head_revision=$4',[organizationId,input.assertionId,revision,previous]);if(updated.rowCount!==1)fail('F13_STALE_REVISION');}
  }
  const result=method==='read'?projection(row,input.state.now):Object.freeze({assertionId:input.assertionId,revision,state:row.state});
  const eventCode={create:'OPERATIONAL_ASSERTION_CREATED',edit:'OPERATIONAL_ASSERTION_EDITED',read:'OPERATIONAL_ASSERTION_READ',submit:'OPERATIONAL_ASSERTION_SUBMITTED',verify:'OPERATIONAL_ASSERTION_VERIFIED',reject:'OPERATIONAL_ASSERTION_REJECTED',dispute:'OPERATIONAL_ASSERTION_DISPUTED',revoke:'OPERATIONAL_ASSERTION_REVOKED'}[method];
  const audit=await auditWriter.append(client,{eventCode,operationCode:OPS[method],resourceType:'OPERATIONAL_ASSERTION',resourceId:input.assertionId,actor:input.actor,authorizationEvidence:input.authorizationEvidence,idempotencyKey:input.idempotencyKey,correlationId:input.correlationId,scopeType:'ORGANIZATION',detailCode:method.toUpperCase(),previousVersion:String(previous),newVersion:String(revision),...catalogReferences,semanticDigest:intentDigest({operation:method,assertionId:input.assertionId,previous,revision,state:row.state})});
  if(!audit||!['APPENDED','ACCEPTED','DUPLICATE'].includes(audit.status))throw new Error('F13_CRITICAL_AUDIT_UNAVAILABLE');
  // Only non-operational metadata is stored. READ reloads the original audited revision,
  // authorizes its exact document references, and derives expiration at access time.
  await client.query('INSERT INTO organization_profile.operational_idempotency_record(organization_id,operation,idempotency_key,intention_digest,assertion_id,revision,result_projection) VALUES($1,$2,$3,$4,$5,$6,$7)',[organizationId,intention(method,input).operation,input.idempotencyKey,intention(method,input).digest,input.assertionId,revision,JSON.stringify({assertionId:input.assertionId,revision,state:row.state})]);return result;
 }
 return Object.freeze({intention,lockIntention,reconcile:replay,...Object.fromEntries(Object.keys(OPS).map(method=>[method,(client,input)=>mutate(client,method,input)]))});
}
module.exports={createOperationalRepository,mapError};
