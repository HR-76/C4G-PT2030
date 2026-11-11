'use strict';
const { OpportunityError } = require('./errors');
const { validateQuery, validateUpdateCommand, validateCreateCommand, validateLifecycleCommand } = require('./contracts');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDITABLE = Object.freeze(['title','funderName','programmeName','summary','callReference','officialUrl',
  'openingDate','closingDate','fundingAmountMin','fundingAmountMax','currencyCode']);
const CENTRAL_CREATE_FIELDS = Object.freeze([...EDITABLE,'geographySummary','eligibleGroups','eligibilitySummary','opportunityType','interventionArea']);
function closed(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).some(key => !keys.includes(key))) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
}
function uuid(value) { if (!UUID.test(value)) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT'); return value; }
function listQuery(raw) {
  closed(raw, ['cursor','pageSize','sort','lifecycleState','validationState','programmeName','funderName','closingFrom','closingTo','qualityBucket']);
  const filters = {lifecycleState:'ACTIVE',...Object.fromEntries(Object.entries(raw).filter(([key]) => !['cursor','pageSize','sort'].includes(key)))};
  if (Object.values(raw).some(value => typeof value !== 'string')) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  return validateQuery({ schemaVersion:1, kind:'LIST', filters, sort:raw.sort || 'UPDATED_DESC',
    pageSize:raw.pageSize === undefined ? 20 : Number(raw.pageSize), ...(raw.cursor ? {cursor:raw.cursor} : {}) });
}
function editCommand(id, raw) {
  uuid(id); closed(raw, ['requestId','expectedRowVersion','changes']); uuid(raw.requestId);
  if (!Number.isSafeInteger(raw.expectedRowVersion) || raw.expectedRowVersion < 1) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  closed(raw.changes, EDITABLE);
  if (!Object.keys(raw.changes).length || Object.values(raw.changes).some(value => value !== null && typeof value !== 'string'))
    throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  return Object.freeze({opportunityId:id,requestId:raw.requestId,expectedRowVersion:raw.expectedRowVersion,changes:Object.freeze({...raw.changes})});
}
function materialize(command, base, observedAt) {
  const snapshot = {...base, provenanceId:command.requestId};
  for (const [key,value] of Object.entries(command.changes)) {
    if (value === null) delete snapshot[key]; else snapshot[key] = value;
  }
  return validateUpdateCommand({schemaVersion:1,requestId:command.requestId,opportunityId:command.opportunityId,
    expectedRowVersion:command.expectedRowVersion,snapshot,
    provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'F12_HTTP_AUTHORING',observedAt}});
}
function createCommand(raw, observedAt) {
  return createWithFields(raw, observedAt, EDITABLE);
}
// Called only from the central authoring service after its live C4G_ADMIN
// check. Private authoring retains its own closed, unchanged field allowlist.
function createCentralCommand(raw, observedAt) {
  return createWithFields(raw, observedAt, CENTRAL_CREATE_FIELDS);
}
function createWithFields(raw, observedAt, allowedFields) {
  closed(raw,['requestId','fields']);uuid(raw.requestId);closed(raw.fields,allowedFields);
  if(Object.values(raw.fields).some(value=>typeof value!=='string'))throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  return validateCreateCommand({schemaVersion:1,requestId:raw.requestId,
    snapshot:{...raw.fields,schemaVersion:1,provenanceId:raw.requestId,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',
      normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'},
    provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'F12_HTTP_AUTHORING',observedAt}});
}
function archiveCommand(id,raw) {
  uuid(id);closed(raw,['requestId','expectedRowVersion']);uuid(raw.requestId);
  return validateLifecycleCommand({schemaVersion:1,opportunityId:id,requestId:raw.requestId,
    expectedRowVersion:raw.expectedRowVersion,action:'ARCHIVE'});
}
function mutationReceipt(result) {
  const rowVersion=Number(result.rowVersion),revisionNumber=Number(result.revisionNumber);
  if(!Number.isSafeInteger(rowVersion)||rowVersion<1||!Number.isSafeInteger(revisionNumber)||revisionNumber<1)
    throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
  return Object.freeze({opportunityId:uuid(result.opportunityId),revisionId:uuid(result.revisionId),rowVersion,revisionNumber});
}
module.exports = { listQuery, editCommand, createCommand, createCentralCommand, archiveCommand, materialize, mutationReceipt, uuid, EDITABLE };
