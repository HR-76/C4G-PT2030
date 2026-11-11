'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {loadArchivedDescription}=require('../src/opportunities/catalogRead/archivedDescription');
const {loadStoredCatalog}=require('../src/opportunities/catalogRead/storedEvidence');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const {createReadService}=require('../src/opportunities/catalogRead/readService');
const {validate}=require('../src/opportunities/catalogRead/contractValidation');
const at='2026-11-02T00:00:00.000Z';
const rows=loadStoredCatalog(path.resolve(__dirname,'../../context/references/opportunity-v2/evidence')).records.map(r=>buildProjection(r.snapshot,emptyExtension(r.snapshot,{opportunityId:r.opportunityId,revisionId:r.revisionId,extensionId:stableId(r.revisionId),acceptanceDigest:'a'.repeat(64),recordedAt:at}),{asOf:at}));
const eu=rows.find(r=>r.detail.summary.sources.some(s=>s.namespace==='EU_FUNDING_TENDERS'));
test('full archived description preserves immutable summary and resolves only evidence for this revision',()=>{
 const before=structuredClone(eu),describe=loadArchivedDescription(),detail=describe(eu);
 assert(detail.description.value.length>2000);assert.match(detail.description.value,/SUSA/);
 assert.deepEqual(eu,before);assert.deepEqual(detail.summary,eu.detail.summary);
 assert(detail.description.evidenceIds.every(id=>eu.collections.evidence.some(e=>e.id===id)));
 assert.equal(describe({...eu,sourceDigest:'0'.repeat(64)}),eu.detail);
 assert.equal(describe({...eu,collections:{...eu.collections,evidence:[]}}),eu.detail);
 const pt=rows.find(r=>r!==eu);assert.equal(describe(pt),pt.detail);
});
test('enriched response satisfies contract and is withheld if access is revoked during description resolution',async()=>{
 let allowed=true,revoke=false;const describe=loadArchivedDescription();
 const service=createReadService({key:randomBytes(32),clock:()=>Date.parse(at),authorize:async()=>{if(!allowed)throw Object.assign(Error('Denied'),{status:403});return {scope:'test',expiresAt:Date.parse(at)+900000};},repository:{load:async()=>({id:stableId('description-generation'),asOf:at,rows:[eu]})},describe:p=>{if(revoke)allowed=false;return describe(p);}});
 const result=await service.request({principal:'test',path:'/opportunities/'+eu.opportunityId});
 assert.equal(validate('DetailResponse',result).valid,true);assert(result.data.description.value.length>2000);
 revoke=true;await assert.rejects(service.request({principal:'test',path:'/opportunities/'+eu.opportunityId}),{status:403});
});
test('tampered archived bytes fail closed before enrichment',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gcni-description-'));
 try{fs.writeFileSync(path.join(dir,'eu-11145.json'),'{}');assert.throws(()=>loadArchivedDescription(dir),/EVIDENCE_MISMATCH/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

