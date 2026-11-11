'use strict';

const { isExternalMappingRelationAllowed, TAXONOMY_SCHEMES } = require('./constants');
const { OrganizationalProfileContractError } = require('./errors');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE=/^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$/;
const VERSION=/^[a-z0-9][a-z0-9._-]{0,127}$/;
const LOCALE=/^[a-z]{2}(?:-[A-Z]{2})?$/;
function fail(){throw new OrganizationalProfileContractError('F13_INVALID_INPUT');}
function record(value,keys){return value&&!require('node:util').types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'));}
function text(value,max=512){return typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max;}
function common(value,keys){if(!record(value,keys)||!UUID.test(value.idempotencyKey))fail();return value;}
function provenance(value){if(!record(value,['sourceType','observedAt'])||!['ORGANIZATION_MANUAL'].includes(value.sourceType)||Number.isNaN(Date.parse(value.observedAt)))fail();return Object.freeze({...value});}
function validateCreateRelease(v){common(v,['releaseId','thematicSchemeId','prioritySchemeId','releaseVersion','semanticDigest','defaultLocale','idempotencyKey','provenance']);if(![v.releaseId,v.thematicSchemeId,v.prioritySchemeId].every(UUID.test.bind(UUID))||new Set([v.releaseId,v.thematicSchemeId,v.prioritySchemeId]).size!==3||!VERSION.test(v.releaseVersion)||!/^[a-f0-9]{64}$/.test(v.semanticDigest)||!LOCALE.test(v.defaultLocale))fail();return Object.freeze({...v,provenance:provenance(v.provenance)});}
function validateCreateConcept(v){common(v,['releaseId','schemeId','schemeCode','conceptId','stableCode','labels','idempotencyKey','provenance']);if(![v.releaseId,v.schemeId,v.conceptId].every(x=>UUID.test(x))||!TAXONOMY_SCHEMES.includes(v.schemeCode)||!CODE.test(v.stableCode)||v.stableCode.length>128||!Array.isArray(v.labels)||v.labels.length===0)fail();const labels=v.labels.map(x=>{if(!record(x,['locale','kind','label'])||!LOCALE.test(x.locale)||!['PREFERRED','ALIAS'].includes(x.kind)||!text(x.label))fail();return Object.freeze({...x});});if(new Set(labels.filter(x=>x.kind==='PREFERRED').map(x=>x.locale)).size!==labels.filter(x=>x.kind==='PREFERRED').length)fail();return Object.freeze({...v,labels:Object.freeze(labels),provenance:provenance(v.provenance)});}
function validateApproveConcept(v){common(v,['conceptId','releaseId','idempotencyKey']);if(!UUID.test(v.conceptId)||!UUID.test(v.releaseId))fail();return Object.freeze({...v});}
function validateRelation(v){common(v,['relationId','releaseId','schemeId','sourceConceptId','targetConceptId','relationType','idempotencyKey','provenance']);if(![v.relationId,v.releaseId,v.schemeId,v.sourceConceptId,v.targetConceptId].every(x=>UUID.test(x))||!['PARENT','CONTAINS'].includes(v.relationType))fail();return Object.freeze({...v,provenance:provenance(v.provenance)});}
function validateMapping(v){common(v,['mappingId','releaseId','schemeId','schemeCode','conceptId','authority','externalScheme','externalVersion','externalCode','relationType','idempotencyKey','provenance']);if(![v.mappingId,v.releaseId,v.schemeId,v.conceptId].every(x=>UUID.test(x))||!TAXONOMY_SCHEMES.includes(v.schemeCode)||![v.authority,v.externalScheme,v.externalVersion,v.externalCode].every(x=>text(x,256))||!isExternalMappingRelationAllowed(v.schemeCode,v.relationType))fail();return Object.freeze({...v,provenance:provenance(v.provenance)});}
function validatePublish(v){common(v,['releaseId','expectedDigest','defaultLocale','idempotencyKey']);if(!UUID.test(v.releaseId)||!/^[a-f0-9]{64}$/.test(v.expectedDigest)||!LOCALE.test(v.defaultLocale))fail();return Object.freeze({...v});}
function validateRead(v){if(!record(v,['releaseId'])||!UUID.test(v.releaseId))fail();return Object.freeze({...v});}
module.exports={validateApproveConcept,validateCreateConcept,validateCreateRelease,validateMapping,validatePublish,validateRelation,validateRead};
