'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {httpCommand,approvePrepared}=require('../scripts/eu-writer-window-approve.cjs');
const {createUuidV7}=require('../backend/src/audit/uuidV7');
const id='12345678-1234-4123-8123-123456789012',actor='12345678-1234-4123-8123-123456789013',digest='a'.repeat(64),base='/api/admin/opportunity-activation/eu-writer/windows/'+id;
test('browser permit is restricted to authentication reads and exact window approval',()=>{
 httpCommand('GET','/api/auth/session',undefined,id);httpCommand('GET',base,undefined,id);httpCommand('POST',base+'/approve',{requestId:createUuidV7(),planDigest:digest},id);
 for(const input of [['POST','/api/admin/opportunity-activation/sources/eu/resume',{}],['POST',base+'/approve',{requestId:createUuidV7(),planDigest:digest,extra:true}],['GET',base+'?anything=1'],['GET','/api/admin/opportunity-activation/eu-writer/windows/'+actor]])assert.throws(()=>httpCommand(...input,id));
});
test('authenticated approval verifies exact server plan and duplicate receipt without source mutation',async()=>{
 const plan={windowId:id,source:{state:'QUIESCED',fence:3},expiresAt:new Date(Date.now()+3600000).toISOString()},calls=[];let receipt;
 const request=async(method,url,body)=>{calls.push({method,url});if(url==='/api/auth/session')return {user:{id:actor,platformRoles:['C4G_ADMIN']}};if(url.endsWith('/sources/eu'))return {state:'QUIESCED',fence:3,activeLeases:0,pendingRuns:0};if(method==='GET')return {scope:'PREPARATION_ONLY',plan,planDigest:digest};if(!receipt){receipt={windowId:id,planDigest:digest,requestId:body.requestId,actorId:actor,eventId:body.requestId,eventHash:'b'.repeat(64),expiresAt:plan.expiresAt,scope:'PREPARATION_ONLY',replayed:false};return receipt;}return {...receipt,replayed:true};};
 const result=await approvePrepared({loaded:{plan,planDigest:digest},request,authenticatedAt:Date.now()});assert.equal(result.approval.planDigest,digest);assert.equal(result.replayVerified,true);assert(calls.filter(x=>x.method==='POST').every(x=>x.url===base+'/approve'));
 await assert.rejects(approvePrepared({loaded:{plan,planDigest:'c'.repeat(64)},request,authenticatedAt:Date.now()}),/APPROVAL_PLAN_CHANGED/);
 await assert.rejects(approvePrepared({loaded:{plan,planDigest:digest},request,authenticatedAt:Date.now()-300000}),/APPROVAL_REAUTHENTICATION_REQUIRED/);
});
