'use strict';
const { types: { isProxy } } = require('node:util');
const { CONTRACT_VERSION, DUPLICATE_CLASSES, LIFECYCLE_STATES, LIMITS, NORMALIZATION_VERSION, QUALITY_BUCKETS, QUALITY_VERSION, SOURCE_TYPES, VALIDATION_STATES } = require('./constants');
const { OpportunityError } = require('./errors');
const { cloneFreeze, isPlain } = require('./immutability');
const { date, decimal, text, url } = require('./normalization');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const CURRENCY = /^[A-Z]{3}$/;
const FORBIDDEN = /(?:password|secret|token|dsn|connection|string|sql|query|handler|repository|policy|tenant|organization|owner|filesystem|path)/i;
const SNAPSHOT_KEYS = Object.freeze(['schemaVersion','title','funderName','provenanceId','lifecycleState','validationState','normalizationVersion','qualityRuleVersion','summary','programmeName','callReference','officialUrl','openingDate','closingDate','eligibilitySummary','thematicCodes','territoryCodes','beneficiaryTypeCodes','fundingAmountMin','fundingAmountMax','currencyCode','sourceTemporal','sourceResolution','sourceEnrichment','geographySummary','eligibleGroups','opportunityType','interventionArea']);
function fail(code = 'OPPORTUNITY_INVALID_INPUT') { throw new OpportunityError(code); }
function plain(value) { return isPlain(value) && !isProxy(value); }
function exact(value, allowed, required = allowed) { if (!plain(value)) fail(); const keys = Reflect.ownKeys(value); if (keys.some(key => typeof key !== 'string' || !allowed.includes(key) || FORBIDDEN.test(key))) fail('OPPORTUNITY_UNKNOWN_FIELD'); if (required.some(key => !Object.hasOwn(value, key))) fail(); }
function boundedPayload(value) { let encoded; try { encoded = JSON.stringify(value); } catch { fail(); } if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > LIMITS.payloadBytes) fail('OPPORTUNITY_LIMIT_EXCEEDED'); }
function string(value, min, max, formatter = text) { let out; try { out = formatter(value); } catch { fail(); } if ([...out].length < min || [...out].length > max) fail('OPPORTUNITY_LIMIT_EXCEEDED'); return out; }
function codes(value) { if (value === undefined) return undefined; if (!Array.isArray(value) || value.length > LIMITS.listItems || new Set(value).size !== value.length) fail(); return Object.freeze(value.map(item => string(item, 1, 64, text)).sort()); }
function validateSnapshot(input) {
  boundedPayload(input); exact(input, SNAPSHOT_KEYS, SNAPSHOT_KEYS.slice(0, 8));
  if (input.schemaVersion !== CONTRACT_VERSION || !UUID.test(input.provenanceId) || !LIFECYCLE_STATES.includes(input.lifecycleState) || !VALIDATION_STATES.includes(input.validationState) || input.normalizationVersion !== NORMALIZATION_VERSION || input.qualityRuleVersion !== QUALITY_VERSION) fail();
  const out = { schemaVersion: 1, title: string(input.title, 1, 300), funderName: string(input.funderName, 1, 200), provenanceId: input.provenanceId, lifecycleState: input.lifecycleState, validationState: input.validationState, normalizationVersion: input.normalizationVersion, qualityRuleVersion: input.qualityRuleVersion };
  for (const [key, max] of [['summary',4000],['programmeName',200],['callReference',128],['eligibilitySummary',4000]]) if (input[key] !== undefined) out[key] = string(input[key], key === 'summary' || key === 'eligibilitySummary' ? 0 : 1, max);
  // Optional editorial text remains distinct from verified geographic or
  // beneficiary codes. Omission must preserve historical snapshots/digests.
  for (const [key, max] of [['geographySummary',2000],['eligibleGroups',4000]]) if (input[key] !== undefined) out[key] = string(input[key], 0, max);
  if(input.opportunityType!==undefined){
    if(!require('./manualClassification').OPPORTUNITY_TYPES.includes(input.opportunityType))fail();
    out.opportunityType=input.opportunityType;
  }
  if(input.interventionArea!==undefined){
    if(!require('./interventionAreas').INTERVENTION_AREAS.some(a=>a.code===input.interventionArea))fail();
    out.interventionArea=input.interventionArea;
  }
  if (input.officialUrl !== undefined) out.officialUrl = string(input.officialUrl, 1, 2048, url);
  if (input.sourceTemporal !== undefined) { try { out.sourceTemporal = require('./temporal').validateTemporal(input.sourceTemporal); } catch { fail(); } }
  if (input.sourceResolution !== undefined) { try { out.sourceResolution = require('./sourceResolution').validateSourceResolution(input.sourceResolution); } catch { fail(); } }
  if (input.sourceEnrichment !== undefined) { try { out.sourceEnrichment = require('./sourceEnrichment').validateSourceEnrichment(input.sourceEnrichment); } catch { fail(); } }
  for (const key of ['openingDate','closingDate']) if (input[key] !== undefined) { try { out[key] = date(input[key]); } catch { fail(); } }
  if (out.openingDate && out.closingDate && out.closingDate < out.openingDate) fail();
  for (const key of ['thematicCodes','territoryCodes','beneficiaryTypeCodes']) if (input[key] !== undefined) out[key] = codes(input[key]);
  const money = ['fundingAmountMin','fundingAmountMax','currencyCode']; const present = money.filter(key => input[key] !== undefined);
  if (present.length !== 0 && present.length !== 3) fail();
  if (present.length) { try { out.fundingAmountMin = decimal(input.fundingAmountMin); out.fundingAmountMax = decimal(input.fundingAmountMax); } catch { fail(); } if (!CURRENCY.test(input.currencyCode) || compareDecimal(out.fundingAmountMin, out.fundingAmountMax) > 0) fail(); out.currencyCode = input.currencyCode; }
  const totalText = Object.values(out).filter(value => typeof value === 'string').reduce((sum, value) => sum + [...value].length, 0); if (totalText > LIMITS.textCharacters) fail('OPPORTUNITY_LIMIT_EXCEEDED');
  return cloneFreeze(out);
}
function compareDecimal(a, b) { const [aw, af=''] = a.split('.'), [bw, bf=''] = b.split('.'); if (aw.length !== bw.length) return aw.length - bw.length; const whole = aw.localeCompare(bw); if (whole) return whole; return af.padEnd(Math.max(af.length,bf.length),'0').localeCompare(bf.padEnd(Math.max(af.length,bf.length),'0')); }
function validateProvenanceInput(input) { boundedPayload(input); exact(input, ['schemaVersion','sourceType','sourceNamespace','externalIdentifier','sourceUrl','observedAt'], ['schemaVersion','sourceType','sourceNamespace','observedAt']); if (input.schemaVersion !== 1 || !SOURCE_TYPES.includes(input.sourceType) || !CODE.test(input.sourceNamespace)) fail(); const out = { schemaVersion:1, sourceType:input.sourceType, sourceNamespace:input.sourceNamespace, observedAt: instant(input.observedAt) }; if (input.externalIdentifier !== undefined) out.externalIdentifier=string(input.externalIdentifier,1,256); if (input.sourceUrl !== undefined) out.sourceUrl=string(input.sourceUrl,1,2048,url); return cloneFreeze(out); }
function instant(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) fail(); return new Date(value).toISOString(); }
function validateCreateCommand(input) { boundedPayload(input); exact(input,['schemaVersion','requestId','snapshot','provenance']); if (input.schemaVersion!==1 || typeof input.requestId!=='string' || input.requestId.length<8 || input.requestId.length>128) fail(); return cloneFreeze({schemaVersion:1,requestId:input.requestId,snapshot:validateSnapshot(input.snapshot),provenance:validateProvenanceInput(input.provenance)}); }
function validateUpdateCommand(input) { boundedPayload(input); exact(input,['schemaVersion','requestId','opportunityId','expectedRowVersion','snapshot','provenance']); if (input.schemaVersion!==1 || !UUID.test(input.opportunityId) || !Number.isSafeInteger(input.expectedRowVersion) || input.expectedRowVersion<1) fail(); const base=validateCreateCommand({schemaVersion:1,requestId:input.requestId,snapshot:input.snapshot,provenance:input.provenance}); return cloneFreeze({...base,opportunityId:input.opportunityId,expectedRowVersion:input.expectedRowVersion}); }
function validateLifecycleCommand(input) { boundedPayload(input); exact(input,['schemaVersion','requestId','opportunityId','expectedRowVersion','action']); if(input.schemaVersion!==1||!UUID.test(input.opportunityId)||!Number.isSafeInteger(input.expectedRowVersion)||input.expectedRowVersion<1||!['ARCHIVE','RESTORE'].includes(input.action))fail(); return cloneFreeze(input); }
function validateQuery(input) { boundedPayload(input); exact(input,['schemaVersion','kind','opportunityId','filters','sort','cursor','pageSize'],['schemaVersion','kind']); if(input.schemaVersion!==1||!['GET','LIST','SEARCH'].includes(input.kind))fail(); if(input.kind==='GET'&&!UUID.test(input.opportunityId))fail(); const filters=input.filters===undefined?{}:input.filters; exact(filters,['lifecycleState','validationState','programmeName','funderName','closingFrom','closingTo','qualityBucket','duplicateClass'],[]); if(filters.lifecycleState&&!LIFECYCLE_STATES.includes(filters.lifecycleState)||filters.validationState&&!VALIDATION_STATES.includes(filters.validationState)||filters.qualityBucket&&!QUALITY_BUCKETS.includes(filters.qualityBucket)||filters.duplicateClass&&!DUPLICATE_CLASSES.includes(filters.duplicateClass))fail(); const size=input.pageSize===undefined?LIMITS.pageDefault:input.pageSize;if(!Number.isInteger(size)||size<1||size>LIMITS.pageMax)fail(); const sort=input.sort||'UPDATED_DESC';if(!['UPDATED_DESC','CLOSING_ASC','CLOSING_DESC','TITLE_ASC'].includes(sort))fail(); return cloneFreeze({schemaVersion:1,kind:input.kind,...(input.opportunityId&&{opportunityId:input.opportunityId}),filters,sort,...(input.cursor&&{cursor:string(input.cursor,1,2048)}),pageSize:size}); }
function validateResult(input) { boundedPayload(input); exact(input,['schemaVersion','opportunityId','revisionId','revisionNumber','rowVersion','snapshot','quality','contentDigest']); if(input.schemaVersion!==1||!UUID.test(input.opportunityId)||!UUID.test(input.revisionId)||!Number.isSafeInteger(input.revisionNumber)||!Number.isSafeInteger(input.rowVersion)||!input.quality||!/^[a-f0-9]{64}$/.test(input.contentDigest))fail(); return cloneFreeze({...input,snapshot:validateSnapshot(input.snapshot)}); }
module.exports={ SNAPSHOT_KEYS, validateCreateCommand, validateLifecycleCommand, validateProvenanceInput, validateQuery, validateResult, validateSnapshot, validateUpdateCommand };
