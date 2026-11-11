'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDocumentApiPorts}=require('../src/documents/apiPorts');
const {createUuidV7}=require('../src/audit/uuidV7');
function fixture(){
 const organizationId=crypto.randomUUID(),entries=new Map(),statements=[];let sequence=0,released=0;
 const client={tenantId:crypto.randomUUID(),async query(sql,values){statements.push(sql);
  if(sql.includes('audit.prepare_append_v1'))return{rows:[{stream_id:'synthetic-stream',sequence:++sequence,previous_hash:'0'.repeat(64),accepted_at:new Date()}]};
  if(sql.includes('audit.append_event_v1')){const key=values[18],digest=values[19];if(entries.has(key)&&entries.get(key).digest!==digest)throw Object.assign(Error('AUDIT_DIGEST_MISMATCH'),{code:'23505'});entries.set(key,{digest,event:JSON.parse(values[22])});return{rows:[{status:'APPENDED',event_id:values[0],event_hash:values[21]}]};}
  return{rows:[]};},release(){released++;}};
 return{organizationId,entries,statements,released:()=>released,ports:createDocumentApiPorts({organizationId,pool:{async connect(){return client;}}})};
}
test('separate authorized intent attempts on the same version have separate audit identities',async()=>{
 const f=fixture(),versionId=crypto.randomUUID(),actor={id:crypto.randomUUID(),membershipId:crypto.randomUUID(),organizationId:f.organizationId};
 for(let i=0;i<2;i++)await f.ports.audit.accept('DOCUMENT_UPLOAD_INTENT_ACCEPTED',{versionId,context:{actor,correlationId:createUuidV7()}});
 assert.equal(f.entries.size,2);assert.equal(f.released(),2);assert.equal(f.statements.filter(x=>x==='COMMIT').length,2);
 assert([...f.entries.values()].every(x=>x.event.resource.id===versionId));
});
test('repeated verified download grants do not collide even without a request context',async()=>{
 const f=fixture(),versionId=crypto.randomUUID();
 for(let i=0;i<2;i++)await f.ports.audit.accept('DOCUMENT_ALLOWED',{organizationId:f.organizationId,versionId,result:'VERIFIED_DOWNLOAD'});
 assert.equal(f.entries.size,2);assert.equal(f.released(),2);
});
test('foreign audit context still rolls back and releases without appending',async()=>{
 const f=fixture();await assert.rejects(()=>f.ports.audit.accept('DOCUMENT_UPLOAD_INTENT_ACCEPTED',{context:{actor:{organizationId:crypto.randomUUID()}}}),/ORGANIZATION_MISMATCH/);
 assert.equal(f.entries.size,0);assert.equal(f.statements.at(-1),'ROLLBACK');assert.equal(f.released(),1);
});
