'use strict';
const {types:{isProxy}}=require('node:util');
const {canonicalClone}=require('./canonicalization');
const {OrganizationalProfileContractError}=require('./errors');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(){throw new OrganizationalProfileContractError('F13_INVALID_INPUT');}
function uuid(v){return typeof v==='string'&&UUID.test(v);}
function instant(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function exact(v,keys){if(!v||isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length
 ||keys.some(k=>!Object.hasOwn(v,k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))fail();}
function base(v,keys,revision=true){exact(v,['draftId',...(revision?['expectedRevision']:[]),...keys,'idempotencyKey']);
 if(!uuid(v.draftId)||!uuid(v.idempotencyKey)||(revision&&(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>=Number.MAX_SAFE_INTEGER)))fail();}
function list(v,keys,validate){if(!Array.isArray(v)||isProxy(v)||v.length>100)fail();let copy;try{copy=canonicalClone(v);}catch{fail();}
 for(const row of copy){exact(row,keys);if(!validate(row))fail();}
 if(new Set(copy.map(r=>r.versionId)).size!==copy.length||new Set(copy.map(r=>r.assertionId||r.experienceId)).size!==copy.length)fail();}
function setCompetencies(v){base(v,['assertions']);list(v.assertions,['assertionId','versionId','knowledgeStatus','conceptId','levelId'],r=>
 uuid(r.assertionId)&&uuid(r.versionId)&&((r.knowledgeStatus==='KNOWN'&&uuid(r.conceptId)&&(r.levelId===null||uuid(r.levelId)))
 ||(r.knowledgeStatus==='UNKNOWN'&&r.conceptId===null&&r.levelId===null)));return canonicalClone(v);}
function setExperiences(v){base(v,['experiences']);list(v.experiences,['experienceId','versionId','typeId','observedFrom','observedUntil','provenanceRef'],r=>
 uuid(r.experienceId)&&uuid(r.versionId)&&uuid(r.typeId)&&uuid(r.provenanceRef)&&instant(r.observedFrom)&&instant(r.observedUntil)&&r.observedUntil>=r.observedFrom);return canonicalClone(v);}
function attachEvidence(v){base(v,['linkId','assertionVersionId','experienceVersionId','documentVersionId']);
 if(!['linkId','assertionVersionId','experienceVersionId'].every(k=>uuid(v[k]))||(v.documentVersionId!==null&&!uuid(v.documentVersionId)))fail();return canonicalClone(v);}
function verifyCompetency(v){base(v,['verificationId','assertionVersionId','methodId','validUntil']);
 if(!['verificationId','assertionVersionId','methodId'].every(k=>uuid(v[k]))||(v.validUntil!==null&&!instant(v.validUntil)))fail();return canonicalClone(v);}
function readEvidenceLink(v){base(v,['linkId'],false);if(!uuid(v.linkId))fail();return canonicalClone(v);}
module.exports={setCompetencies,setExperiences,attachEvidence,verifyCompetency,readEvidenceLink};
