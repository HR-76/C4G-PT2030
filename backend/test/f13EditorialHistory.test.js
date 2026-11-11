'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, id} = require('./fixtures/pq1Activation');
const {loadEditorialRevision, loadEditorialAuthors, editorialRevisions} = require('../src/organizationalProfile/editorialSource');
const material = require('../src/organizationalProfile/editorialMaterial');
function database() {
  const f=fixture(), calls=[];
  const client={async query(sql,args) {
    calls.push({sql,args});
    assert.equal(args[0],id(1));assert.equal(args[1],f.source.draftId);
    if(sql.includes('FROM organization_profile.profile_draft_revision')) {
      assert(sql.includes('BETWEEN $3 AND $4'));
      return {rows:Array.from({length:args[3]-args[2]+1},(_,n)=>({revision:args[2]+n,
        semantic_digest:f.source.digest,actor_subject_id:id(2),scope_type:'ORGANIZATION',scope_id:null}))};
    }
    if(sql.includes('FROM organization_profile.profile_revision_item')) return {rows:f.source.items};
    if(sql.includes('FROM organization_profile.idempotency_record')) return {rows:[{operation:args[2]===1?'PROFILE_DRAFT_CREATE':args[2]===53?'PROFILE_SUBMIT':'PROFILE_DRAFT_EDIT'}]};
    if(sql.includes('FROM organization_profile.competency_revision_member')) return {rows:f.source.competencyMaterial};
    throw Error('Unexpected query');
  }};
  return {f,client,calls};
}
test('old revision reads only that exact revision, never the preceding history',async()=>{
  const {f,client,calls}=database();
  const row=await loadEditorialRevision(client,id(1),f.source.draftId,28);
  assert.equal(row.revision,28);assert.equal(calls.length,4);
  assert.deepEqual(calls[0].args.slice(2),[28,28]);
  assert(calls.slice(1).every(c=>c.args[2]===28));
});
test('streaming ancestry has fixed-size revision ranges, complete ordering and unchanged authors',async()=>{
  const {f,client,calls}=database(),history=[];
  for await(const row of editorialRevisions(client,id(1),f.source.draftId,53)) history.push(row);
  assert.deepEqual(history.map(r=>r.revision),Array.from({length:53},(_,n)=>n+1));
  assert.deepEqual(calls.filter(c=>c.sql.includes('BETWEEN')).map(c=>c.args.slice(2)),[[1,25],[26,50],[51,53]]);
  const actual=await loadEditorialAuthors(client,id(1),f.source.draftId,53,material.createAuthorAccumulator(id(2)));
  assert.deepEqual(actual,material.deriveAuthors(history,id(2)));
});
test('missing revision or invalid pinned upper revision fails closed',async()=>{
  const {f,client}=database();
  await assert.rejects(loadEditorialRevision(client,id(1),f.source.draftId,0),{code:'F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE'});
  const missing={query:async()=>({rows:[]})};
  await assert.rejects(loadEditorialAuthors(missing,id(1),f.source.draftId,53,material.createAuthorAccumulator(id(2))),{code:'F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE'});
});
