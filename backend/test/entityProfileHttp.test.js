'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{randomUUID}=require('node:crypto');
const {createDirectoryRouter}=require('../src/routes/organizationDirectoryRoutes');
const {createPlatformDirectoryRouter}=require('../src/routes/platformDirectoryRoutes');
const organizationId='11111111-1111-4111-8111-111111111111';
const fields={nif:'500000000',acronym:'C4G',address:'Rua da Escola',addressComplement:'',postalCode:'1000-001',locality:'Lisboa',institutionalEmail:'geral@example.org',institutionalPhone:'+351210000000',website:'https://example.org',responsibleName:'Ana Responsável',responsibleEmail:'ana@example.org',responsiblePhone:'+351910000000',responsibleJobTitle:'Diretora',workerCount:12,workerReferenceDate:'2026-09-30'};
const command={expectedRevision:0,requestId:randomUUID(),fields};
const result={fields,revision:1,complete:true,source:'CENTRAL'};
const organizationMiddleware={requireServerSession(req,res,next){next()},resolveOrganizationContext(req,res,next){next()},requireOrganizationContext(req,res,next){next()}};
async function withServer(router,work){
 const app=express();app.use(express.json());app.use('/',router);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{return await work(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(resolve=>server.close(resolve))}
}
test('entity and C4G admin HTTP boundaries forward the same canonical profile command',async()=>{
 let entityCall,platformCall;
 const entityService={async execute(method,body,id,req){entityCall={method,body,id,organization:req.headers['x-c4g-organization']};return result}};
 const entityRouter=createDirectoryRouter({express,service:entityService,authenticate:(req,res,next)=>next(),organizationMiddleware});
 await withServer(entityRouter,async base=>{const response=await fetch(`${base}/registration`,{method:'PUT',headers:{'Content-Type':'application/json','X-C4G-Organization':organizationId},body:JSON.stringify(command)});assert.equal(response.status,200);assert.deepEqual(await response.json(),result)});
 assert.deepEqual(entityCall,{method:'registrationProfile',body:command,id:undefined,organization:organizationId});
 const directory={async entity(id){assert.equal(id,organizationId);return {id}}};
 const registration={async saveForPlatform(id,body){platformCall={id,body};return result},async profile(){return {organization:{id:organizationId},registration:result}}};
 const platformRouter=createPlatformDirectoryRouter({express,service:directory,registration,authenticate:(req,res,next)=>next()});
 await withServer(platformRouter,async base=>{const response=await fetch(`${base}/entities/${organizationId}/registration`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});assert.equal(response.status,200);assert.deepEqual(await response.json(),result)});
 assert.deepEqual(platformCall,{id:organizationId,body:command});
});
test('both profile boundaries return closed validation errors without leaking internals',async()=>{
 const invalid=Object.assign(new Error('private values'),{code:'REGISTRATION_FIELDS_INVALID',fields:{responsibleEmail:'Indique um email válido.'}});
 const entityRouter=createDirectoryRouter({express,service:{async execute(){throw invalid}},authenticate:(req,res,next)=>next(),organizationMiddleware});
 await withServer(entityRouter,async base=>{const response=await fetch(`${base}/registration`,{method:'PUT',headers:{'Content-Type':'application/json','X-C4G-Organization':organizationId},body:JSON.stringify(command)});assert.equal(response.status,400);const body=await response.json();assert.deepEqual(body.error.fields,invalid.fields);assert.equal(JSON.stringify(body).includes('private values'),false)});
 const platformRouter=createPlatformDirectoryRouter({express,service:{async entity(){}},registration:{async saveForPlatform(){throw invalid}},authenticate:(req,res,next)=>next()});
 await withServer(platformRouter,async base=>{const response=await fetch(`${base}/entities/${organizationId}/registration`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});assert.equal(response.status,400);assert.deepEqual((await response.json()).error,{code:'REGISTRATION_FIELDS_INVALID',fields:invalid.fields})});
});
