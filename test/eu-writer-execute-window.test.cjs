'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {args,validateApproval,validateConfiguration}=require('../scripts/eu-writer-execute-window.cjs');
const id=randomUUID(),actor=randomUUID(),sha='a'.repeat(64);
test('043 execution requires a prepared window and fixed approval artifact, not arbitrary targets',()=>{
 assert.deepEqual(args(['--execute-window','--window='+id,'--approval=approval-'+id+'.json']),{windowId:id,approvalFile:'approval-'+id+'.json'});
 for(const a of [[],['--execute-window'],['--execute-window','--window=../other','--approval=approval-'+id+'.json'],['--execute-window','--window='+id,'--approval=../../secret']])assert.throws(()=>args(a));
});
test('execution cannot reuse synthetic, stale, mismatched or unsuccessful approvals',()=>{
 const expiresAt=new Date(Date.now()+3600000).toISOString(),loaded={planDigest:sha,plan:{windowId:id,expiresAt}},value={status:'PASS',windowId:id,planDigest:sha,sessionFabricated:false,scope:'PREPARATION_ONLY',authentication:{provider:'OIDC',actorId:actor,administrator:true},result:{replayVerified:true,sourceUnchanged:true,approval:{windowId:id,planDigest:sha,actorId:actor,eventId:id,eventHash:sha,scope:'PREPARATION_ONLY',expiresAt}}};
 validateApproval(value,loaded);for(const delta of [{status:'FAIL'},{windowId:randomUUID()},{sessionFabricated:true},{planDigest:'b'.repeat(64)},{authentication:{provider:'SYNTHETIC',actorId:actor,administrator:true}}])assert.throws(()=>validateApproval({...value,...delta},loaded));
 assert.throws(()=>validateApproval(value,loaded,Date.now()+7200000));
});
test('configuration update permits only the exact registered writer descriptor',()=>{
 const before={some:'preserved',opportunityActivation:{runtime:'authenticated-v2'}};
 const descriptor={packageId:'opportunity-eu-writer-v2',...require('../backend/src/fundingTenders/euWriter').euWriterConfiguration()};
 validateConfiguration(before,{...before,opportunityEuWriter:descriptor});
 assert.throws(()=>validateConfiguration(before,{...before,some:'changed',opportunityEuWriter:descriptor}));assert.throws(()=>validateConfiguration(before,{...before,opportunityEuWriter:{...descriptor,mappingDigest:sha}}));
});
