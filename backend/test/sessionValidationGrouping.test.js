'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authenticateSession,configureSessionAuthentication}=require('../src/security/sessionAuth');
const {createAdmissionBoundary}=require('../src/entityAdmission/http');

const policyVersion='policy-test';
function request(overrides={}){
 return {sessionID:'sid-1',session:{auth:{user:{id:'user-1'},absoluteExpiresAt:2000,identity:{},revocationVersion:1,policyVersion,
  evidence:{policyVersion},...overrides}}};
}
function response(){
 return {headersSent:false,code:null,body:null,status(code){this.code=code;return this;},set(){return this;},json(body){this.body=body;this.headersSent=true;return this;}};
}

test('a request validates its session against the registry once, and other requests are validated again',async()=>{
 let now=1000;const calls=[];
 configureSessionAuthentication({policyVersion,now:()=>now,sessionRegistry:{async validateSession(input){calls.push(input.sid);return true;},async expireSession(){}}});
 const first=request(),res=response();let passed=0;
 assert.equal(await authenticateSession(first,res,()=>{passed++;}),true);
 assert.equal(await authenticateSession(first,res,()=>{passed++;}),true);
 assert.equal(passed,2);assert.deepEqual(calls,['sid-1']);
 // Marks are per request object: an identical-looking request is validated.
 assert.equal(await authenticateSession(request(),response(),()=>{passed++;}),true);
 assert.deepEqual(calls,['sid-1','sid-1']);
});

test('policy and absolute expiry are still enforced for an already validated request',async()=>{
 let now=1000;
 configureSessionAuthentication({policyVersion,now:()=>now,sessionRegistry:{async validateSession(){return true;},async expireSession(){}}});
 const req=request();req.session.destroy=callback=>callback();
 await authenticateSession(req,response(),()=>{});
 now=2000;
 const expired=response();let passed=false;
 await authenticateSession(req,expired,()=>{passed=true;});
 assert.equal(passed,false);assert.equal(expired.code,401);assert.equal(expired.body.code,'SESSION_EXPIRED');
 now=1000;req.session.auth.policyVersion='other';
 const mismatch=response();
 await authenticateSession(req,mismatch,()=>{passed=true;});
 assert.equal(passed,false);assert.equal(mismatch.body.code,'SESSION_POLICY_VERSION_MISMATCH');
});

test('a revoked session is refused and never marked as validated',async()=>{
 let valid=false,calls=0;
 configureSessionAuthentication({policyVersion,now:()=>1000,sessionRegistry:{async validateSession(){calls++;return valid;},async expireSession(){}}});
 const req=request(),res=response();let passed=false;
 await authenticateSession(req,res,()=>{passed=true;});
 assert.equal(passed,false);assert.equal(res.body.code,'SESSION_REVOKED');
 valid=true;
 await authenticateSession(req,response(),()=>{passed=true;});
 assert.equal(passed,true);assert.equal(calls,2);
});

test('admission boundary validates the session and reads its context inside one shared unit',async()=>{
 const events=[];
 const service={async together(work){events.push('begin');try{return await work();}finally{events.push('end');}},
  async context(){events.push('context');return {limited:false,items:[]};}};
 const boundary=createAdmissionBoundary({service,authenticate:async(req,res,next)=>{events.push('authenticate');next();}});
 const req={path:'/api/organizations/x/dashboard/summary',method:'GET',session:{auth:{}}};
 await boundary(req,response(),()=>events.push('next'));
 assert.deepEqual(events,['begin','authenticate','context','end','next']);
 assert.deepEqual(req.admissionContext,{limited:false,items:[]});
});

test('admission boundary reads no context and continues nowhere when the session guard answers',async()=>{
 const events=[];
 const service={async together(work){return work();},async context(){events.push('context');return {limited:false};}};
 const boundary=createAdmissionBoundary({service,authenticate:async(req,res)=>{res.status(401).json({code:'SESSION_REQUIRED'});}});
 const res=response();
 await boundary({path:'/api/x',method:'GET',session:{auth:{}}},res,()=>events.push('next'));
 assert.deepEqual(events,[]);assert.equal(res.code,401);
});

test('admission boundary fails closed when the shared unit cannot complete',async()=>{
 const service={async together(work){await work();throw new Error('commit failed');},async context(){return {limited:false};}};
 const boundary=createAdmissionBoundary({service,authenticate:async(req,res,next)=>next()});
 const res=response();let continued=false;
 await boundary({path:'/api/x',method:'GET',session:{auth:{}}},res,()=>{continued=true;});
 assert.equal(continued,false);assert.equal(res.code,503);assert.equal(res.body.error.code,'ADMISSION_CONTEXT_UNAVAILABLE');
});

test('admission-only users remain limited to the allowed endpoints',async()=>{
 const service={async context(){return {limited:true,items:[]};}};
 const boundary=createAdmissionBoundary({service,authenticate:(req,res,next)=>next()});
 const res=response();let continued=false;
 await boundary({path:'/api/organizations/x/dashboard/summary',method:'GET',session:{auth:{}}},res,()=>{continued=true;});
 assert.equal(continued,false);assert.equal(res.code,403);assert.equal(res.body.error.code,'ADMISSION_REQUIRED');
});
