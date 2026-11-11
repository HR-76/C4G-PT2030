'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({databases,central,call}){
 const [a,b]=databases,refs=await require('./pq1-http-scenarios').seed(a);
 await require('./pq1-http-scenarios').seed({pool:a.pool,org:b.org});
 const command={draftId:id(),items:a.draft.items,idempotencyKey:id()};
 let r=await call('/drafts',a.maker,command);assert.equal(r.status,201,JSON.stringify(r));const receipt=r.value;
 assert.deepEqual((await call('/drafts',a.maker,command)).value,receipt);
 assert.equal((await call('/drafts',a.maker,{...command,items:[]})).status,409);
 assert.equal((await call('/drafts',a.checker,command)).status,409);
 const state=(await central.pool.query('SELECT grants,authorization_version FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2',[a.org,a.submitter.membershipId])).rows[0];
 const limited=state.grants.map(g=>g.permission==='organization_profile.read'?{...g,resourceType:'PROFILE_PROJECTION',resourceId:id()}:g);
 const version=await central.data.change({organizationId:a.org,membershipId:a.submitter.membershipId,expectedVersion:Number(state.authorization_version),grants:limited,assuranceRequirements:central.requirement});
 for(const path of ['/drafts/'+command.draftId,`/drafts/${command.draftId}/revisions/1`,`/drafts/${command.draftId}/experiences/${id()}/documents`])assert.equal((await call(path,a.submitter)).status,403,path);
 await central.data.change({organizationId:a.org,membershipId:a.submitter.membershipId,expectedVersion:version,grants:state.grants,assuranceRequirements:central.requirement});
 r=await call('/catalog?kind=COMPETENCY_CONCEPT',a.maker);assert.equal(r.status,200);assert.deepEqual(r.value.items.map(x=>x.entryId),[refs.concept]);
 for(const actor of [a.checker,b.maker]){const r=await call('/intentions/lookup',actor,{operation:'CREATE_DRAFT',resourceId:command.draftId,idempotencyKey:command.idempotencyKey});assert.equal(r.status,200);assert.equal(r.value.status,'UNKNOWN');assert.equal(r.value.receipt,null);}
 assert.equal((await call('/drafts/'+command.draftId,b.maker)).status,404);
 const c=await a.pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_organization_profile_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);assert.equal((await c.query('SELECT 1 FROM organization_profile.competency_catalog_entry WHERE organization_id=$1',[b.org])).rowCount,0);await assert.rejects(()=>c.query('SELECT object_id FROM document_storage.document_version'),/permission denied/);}finally{await c.query('ROLLBACK');c.release();}
 console.log('PQ1_HTTP_SCOPED_READ_SELECTOR_CATALOG_AB_IDEMPOTENCY_PASS');
}
module.exports={run};
