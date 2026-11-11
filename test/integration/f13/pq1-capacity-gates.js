'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({db,central,ok,root}){
 const release=id(),themeScheme=id(),competencyScheme=id(),framework=id();
 await db.pool.query(`INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT','capacity-fixture-v1','DRAFT',$3,'{}')`,[release,db.org,'c'.repeat(64)]);
 for(const [scheme,code,domain] of [[themeScheme,'THEMATIC_AREA','THEMATIC'],[competencyScheme,'COMPETENCY','NONE']])await db.pool.query('INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,$4,$5)',[scheme,release,db.org,code,domain]);
 const themes=[],competencies=[];
 for(let n=0;n<100;n++)for(const [scheme,list] of [[themeScheme,themes],[competencyScheme,competencies]]){const concept=id();await db.pool.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,$5,'{}')",[concept,release,scheme,db.org,'SYNTHETIC_'+n]);list.push(concept);}
 for(const concept of themes)await db.pool.query("INSERT INTO organization_profile.concept_label(concept_id,locale,label_kind,label) VALUES($1,'pt-PT','PREFERRED','Synthetic capacity theme')",[concept]);
 await db.pool.query("UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE release_id=$1",[release]);
 await db.pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,organization_id,release_version,lifecycle,semantic_digest) VALUES($1,$2,'capacity-fixture-v1','PUBLISHED',$3)",[release,db.org,'c'.repeat(64)]);
 for(let n=0;n<100;n++)await db.pool.query("INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,organization_id,kind,stable_code,framework_id,framework_version) VALUES($1,$2,$3,'COMPETENCY_CONCEPT',$4,$5,'capacity-fixture-v1')",[competencies[n],release,db.org,'C_'+n,framework]);
 const call=async(method,input,resource,actor=db.maker)=>db.pq1.execute(method,require('../../../backend/src/organizationalProfile/pq1UiContracts').validate(method,input,resource),resource,actor.request,id());
 const items=themes.slice(0,99).map(conceptId=>({itemId:id(),itemVersionId:id(),domain:'THEMATIC_AREA',knowledgeStatus:'KNOWN',conceptId}));items.push({itemId:id(),itemVersionId:id(),domain:'STRATEGIC_PRIORITY',knowledgeStatus:'UNKNOWN',conceptId:null});
 const counts=async()=> (await db.pool.query(`SELECT (SELECT count(*) FROM organization_profile.profile_draft_revision) AS revisions,(SELECT count(*) FROM organization_profile.pq1_effective_snapshot) AS snapshots,(SELECT count(*) FROM organization_profile.pq1_activation) AS activations`)).rows[0];
 const before=await counts();await assert.rejects(call('create',{draftId:id(),items:[...items,{...items[0],itemId:id(),itemVersionId:id()}],idempotencyKey:id()}));assert.deepEqual(await counts(),before);
 const draftId=id();await call('create',{draftId,items,idempotencyKey:id()});
 const assertions=competencies.map(conceptId=>({assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId,levelId:null}));
 const preAssertions=await counts();await assert.rejects(call('competencies',{expectedRevision:1,assertions:[...assertions,{...assertions[0],assertionId:id(),versionId:id()}],idempotencyKey:id()},draftId));assert.deepEqual(await counts(),preAssertions);
 await call('competencies',{expectedRevision:1,assertions,idempotencyKey:id()},draftId);
 const candidate=await call('submit',{expectedRevision:2,idempotencyKey:id()},draftId);
 // A separate eligible actor is fixture setup, not a new segregation requirement.
 const approver=await central.user(db.org,id(),id());await central.data.change({organizationId:db.org,membershipId:approver.membershipId,expectedVersion:1,grants:['organization_profile.approve','organization_profile.publish','organization_profile.read','organization_profile.activate'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})),assuranceRequirements:central.requirement});
 const c=await call('candidate',{},candidate.candidateId,approver),version=await call('approve',{concurrencyToken:c.actions[0].concurrencyToken,idempotencyKey:id()},candidate.candidateId,approver),v=await call('version',{},version.versionId,approver);
 await call('publish',{concurrencyToken:v.actions[0].concurrencyToken,idempotencyKey:id()},version.versionId,approver);
 const active=(await db.effective.execute('active',{},db.checker.request)).active,start=performance.now();
 const result=await db.effective.execute('activate',{versionId:version.versionId,expectedActivationId:active?.activationId||null,expectedGeneration:active?.generation||0,reason:'Capacity fixture within joint limits',idempotencyKey:id()},approver.request);
 const elapsed=performance.now()-start;
 const snapshot=(await db.pool.query('SELECT content FROM organization_profile.pq1_effective_snapshot WHERE snapshot_id=$1',[result.snapshotId])).rows[0].content;
 assert.equal(snapshot.material.items.length,100);assert.equal(snapshot.material.assertions.length,100);assert(elapsed<10000);
 const bytes=Buffer.byteLength(require('../../../backend/src/organizationalProfile/canonicalization').canonicalize(snapshot));assert(bytes<=262144);
 console.log('PQ1_CAPACITY_COMBINED_100_ITEMS_100_ASSERTIONS PASS '+JSON.stringify({items:100,assertions:100,bytes,elapsedMs:Math.round(elapsed),aboveLimitNoEffects:true}));
 if(process.env.PQ1_CAPACITY_EXTENDED==='1')await require('./pq1-capacity-extended').run({db,central,call,items,assertions,counts});
}
module.exports={run};
