'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOpportunityInterestRouter,publicInterestError}=require('../src/routes/opportunityInterestRoutes');

function fixture(){
 const handlers=new Map(),calls=[];
 const router={use(){}};for(const verb of ['get','post','put'])router[verb]=(path,fn)=>handlers.set(`${verb} ${path}`,fn);
 createOpportunityInterestRouter({express:{Router:()=>router},authenticate(){},organizationMiddleware:{requireOrganizationContext(){}},
  service:{async execute(...args){calls.push(args);return {interestId:'created'};}}});
 return {handlers,calls};
}
function response(){return {statusCode:null,result:null,status(n){this.statusCode=n;return this;},json(body){this.result=body;return this;},set(){return this;}};}

test('interest HTTP resolves the selected organization from the server session before requiring it',async()=>{
 const middleware=[],calls=[],router={use(...fns){middleware.push(...fns)},get(){},post(){},put(){}};
 createOpportunityInterestRouter({express:{Router:()=>router},service:{},
  authenticate(req,res,next){calls.push('authenticate');req.session={auth:{}};next();},
  organizationMiddleware:{
   requireServerSession(req,res,next){assert(req.session.auth);calls.push('session');next();},
   resolveOrganizationContext(req,res,next){calls.push('resolve');req.organizationContext={organizationId:'selected'};next();},
   requireOrganizationContext(req,res,next){calls.push('require');assert.equal(req.organizationContext?.organizationId,'selected');next();}
  }});
 const req={},res=response();
 // Exclude only the final 405 fallback, which is after the actual route handlers.
 for(const fn of middleware.slice(0,-1)){let passed=false;await fn(req,res,()=>{passed=true});assert(passed);}
 assert.deepEqual(calls,['authenticate','session','resolve','require']);
});

test('HTTP interest registration delegates authenticated request and returns 201',async()=>{
 const f=fixture(),req={body:{opportunityId:'fixture'},query:{},params:{},headers:{}},res=response();
 await f.handlers.get('post /')(req,res);
 assert.equal(res.statusCode,201);assert.equal(f.calls[0][0],'register');assert.equal(f.calls[0][3],req);
});

test('HTTP rejects mixed query/body transports before a write',async()=>{
 const f=fixture(),res=response();await f.handlers.get('post /')({body:{},query:{organizationId:'foreign'},params:{}},res);
 assert.equal(res.statusCode,400);assert.equal(f.calls.length,0);
 const read=response();await f.handlers.get('get /')({body:{authority:'forged'},query:{},params:{}},read);
 assert.equal(read.statusCode,400);assert.equal(f.calls.length,0);
});

test('interest errors distinguish conflict, denial and temporary failure without leaking details',()=>{
 for(const code of ['STALE_REVISION','STATE_CONFLICT','STALE_OPPORTUNITY_REVISION','UNIT_UNAVAILABLE','IDEMPOTENCY_CONFLICT'])assert.equal(publicInterestError({code}).status,409);
 assert.deepEqual(publicInterestError({code:'AUTHORITY_DENIED',message:'secret'}),{status:404,code:'RESOURCE_NOT_AVAILABLE'});
 assert.deepEqual(publicInterestError({code:'AUTHORITY_REQUIRED',authorityFailure:'MEMBERSHIP_INVALID'}),{status:403,code:'NOT_AUTHORIZED'});
 assert.deepEqual(publicInterestError({code:'unknown',message:'secret'}),{status:503,code:'SERVICE_UNAVAILABLE'});
 assert.deepEqual(publicInterestError({code:'OPPORTUNITY_READ_LIMIT_EXCEEDED',message:'private snapshot'}),{status:409,code:'LIMIT_EXCEEDED'});
});
