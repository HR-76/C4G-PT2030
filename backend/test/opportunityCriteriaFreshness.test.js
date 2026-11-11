"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createCriteriaRepository}=require('../src/opportunityCriteria/repository');
const {digest}=require('../src/opportunityCriteria/contracts');
function fixture(){
 const org=randomUUID(),id=randomUUID(),current=randomUUID(),old=randomUUID(),ref={conceptId:randomUUID(),schemeId:randomUUID(),releaseId:randomUUID()};
 const sourceId=randomUUID(),content={criteria:[{criterionId:randomUUID(),kind:'THEMATIC_AFFINITY',conceptRef:ref,interpretationText:'Synthetic',temporalBasis:null,evidence:{sourceId,locator:'1',excerpt:'Theme',justification:'Explicit'}}],sources:[{sourceId,label:'Synthetic',sourceKind:'SYNTHETIC',reference:'urn:synthetic',versionLabel:'1',capturedText:'Theme'}]};
 const row={set_id:id,revision_id:randomUUID(),revision_number:1,opportunity_revision_id:current,content,content_digest:digest(content),author_subject_id:randomUUID(),created_at:new Date()};
 const queries=[];let compatible=true,failCatalogue=false;
 const client={async query(sql,params){queries.push({sql,params});if(sql.startsWith('SET LOCAL ROLE'))return {rows:[]};if(sql.includes('jsonb_to_recordset')){if(failCatalogue)throw Error('catalogue unavailable');return {rows:compatible?JSON.parse(params[0]).filter(r=>r.concept_id===ref.conceptId).map(r=>({reference_index:r.reference_index})):[]};}if(sql.includes('criteria_receipt'))return {rows:[]};if(sql.includes('criteria_revision'))return {rows:rows};throw Error('Unexpected SQL: '+sql);}};
 let rows=[row];const repo=createCriteriaRepository({organizationId:org,actor:{id:row.author_subject_id},tokens:{},audit:async()=>{throw Error('Unexpected mutation');}});
 const run=(method)=>repo.run(client,{method,id,revisionId:row.revision_id,input:{limit:50,requestId:randomUUID(),expectedHeadRevision:1,opportunityRevisionId:current},loaded:{opportunity:{current_revision_id:current,lifecycle_state:'ACTIVE'},set:{set_id:id,head_revision_id:row.revision_id,head_revision:1}},actions:{canEdit:true,canConfirm:true}});
 return {row,ref,current,old,queries,run,setCompatible:v=>compatible=v,setRows:v=>rows=v,fail:()=>failCatalogue=true};
}
for(const [stale,compatible,expected] of [[false,true,'CURRENT'],[false,false,'UNAVAILABLE'],[true,true,'REVIEW_REQUIRED'],[true,false,'UNAVAILABLE']])test(`freshness coherent: stale=${stale}, compatible=${compatible}`,async()=>{
 const f=fixture();if(stale)f.row.opportunity_revision_id=f.old;f.setCompatible(compatible);
 assert.equal((await f.run('head')).head.freshness,expected);assert.equal((await f.run('list')).items[0].freshness,expected);const detail=await f.run('get');assert.equal(detail.freshness,expected);assert.equal(detail.actions.canConfirm,!stale&&compatible);
});
test('history batches and deduplicates references, without changing historical content',async()=>{
 const f=fixture(),bad=structuredClone(f.row);bad.revision_id=randomUUID();bad.content.criteria[0].conceptRef.conceptId=randomUUID();bad.content_digest=digest(bad.content);
 const stale={...f.row,revision_id:randomUUID(),opportunity_revision_id:f.old},rows=[f.row,bad,stale,...Array.from({length:47},()=>({...f.row,revision_id:randomUUID()}))];f.setRows(rows);const before=JSON.stringify(rows);
 const result=await f.run('list');assert.deepEqual(result.items.slice(0,3).map(r=>r.freshness),['CURRENT','UNAVAILABLE','REVIEW_REQUIRED']);assert.equal(JSON.stringify(rows),before);
 const reads=f.queries.filter(q=>q.sql.includes('jsonb_to_recordset'));assert.equal(reads.length,1);assert.equal(JSON.parse(reads[0].params[0]).length,2);
});
test('missing draft reference remains incomplete rather than incompatible',async()=>{const f=fixture();delete f.row.content.criteria[0].conceptRef;f.row.content_digest=digest(f.row.content);const r=await f.run('get');assert.equal(r.freshness,'CURRENT');assert.equal(r.actions.canConfirm,false);assert(r.findings.some(x=>x.code==='REFERENCE_REQUIRED'));assert.equal(f.queries.filter(q=>q.sql.includes('jsonb_to_recordset')).length,0);});
test('confirmation rejects incompatible references before any mutation',async()=>{const f=fixture();f.setCompatible(false);await assert.rejects(()=>f.run('confirm'),{code:'REFERENCE_INCOMPATIBLE'});assert(!f.queries.some(q=>/^(INSERT|UPDATE)/.test(q.sql)));});
test('catalogue failure restores role and propagates, never returning CURRENT',async()=>{const f=fixture();f.fail();await assert.rejects(()=>f.run('head'),/catalogue unavailable/);assert.equal(f.queries.at(-1).sql,'SET LOCAL ROLE c4g_opportunity_tenant_runtime');});
