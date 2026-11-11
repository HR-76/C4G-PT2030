'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {read,utils}=require('../../../backend/node_modules/xlsx');
async function run({central,tenants,base,http,actor,userA,userB,failures,failAudit}){
 const [a,b]=tenants,root='/api/applications/report',directory='/api/organization-directory';
 const ok=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-2)}));return r.data};
 const manager=await actor(a.org,['notification.read','opportunity.read','application.read','organization_directory.read','organization_directory.edit','organizational_scope.read','organizational_scope.create']);
 const unit=await ok(http(manager,directory+'/units','POST',{label:'Departamento de Projetos',parentScopeId:null,stableCode:null,idempotencyKey:randomUUID()}),201);
 const second=await ok(http(manager,directory+'/units','POST',{label:'Unidade secundária',parentScopeId:null,stableCode:null,idempotencyKey:randomUUID()}),201);
 const person=await ok(http(manager,directory+'/people','POST',{name:'Pessoa de ensaio',email:'ensaio@example.invalid',functionLabel:'Gestão',active:true,unitIds:[unit.scopeId,second.scopeId],primaryUnitId:unit.scopeId,idempotencyKey:randomUUID()}),201);
 await ok(http(manager,directory+'/people/'+person.personId+'/account','PUT',{membershipId:userA.membershipId,expectedRevision:0,idempotencyKey:randomUUID()}));
 const states=['IDENTIFIED','INTENTION','PREPARATION','SUBMITTED','APPROVED','REJECTED','CANCELLED','ARCHIVED'];
 for(let n=0;n<32;n++)await a.pool.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,status,created_by,total_budget,organization_budget)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[a.org,randomUUID(),a.seed.opportunityId,n===0?'=Projeto de ensaio':`Projeto ${String(n).padStart(2,'0')}`,n===31?manager.membershipId:userA.membershipId,n===0?'2020-01-01':'2099-12-31',states[n%8],userA.id,n===0?'99999999999999.99':n===1?null:'0.10',n%3?null:'100.01']);
 const snapshot=await ok(http(manager,root));assert.equal(snapshot.total,32);assert.equal(snapshot.items.length,32);assert.equal(snapshot.unitsAvailable,true);
 assert.equal(snapshot.items.filter(r=>r.unitId===unit.scopeId).length,31);assert.equal(snapshot.items.filter(r=>r.unitId===null).length,1);assert.equal(snapshot.units.find(u=>u.unitId===second.scopeId).people,0);
 const withoutDirectory=await ok(http(userA,root));assert.equal(withoutDirectory.total,32);assert.equal(withoutDirectory.unitsAvailable,false);assert.equal(withoutDirectory.units.length,0);
 assert.equal((await ok(http(userB,root))).total,0);
 const download=async(user,digest,org)=>fetch(base+root+'.xlsx?digest='+encodeURIComponent(digest),{headers:{Cookie:user.cookie,...(org?{'X-C4G-Organization':org}:{})}});
 const exported=await download(manager,snapshot.digest);assert.equal(exported.status,200);
 assert.equal(exported.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const sheet=read(Buffer.from(await exported.arrayBuffer())).Sheets.Candidaturas;
 const rows=utils.sheet_to_json(sheet,{header:1});assert.equal(rows.length,37);
 const project=rows.findIndex(row=>row[0]==='=Projeto de ensaio');assert(project>=5);
 assert.equal(rows[project][7],'99999999999999.99');assert.equal(sheet[`A${project+1}`].f,undefined);
 assert.equal((await download(userB,snapshot.digest)).status,409);assert.equal((await download(manager,snapshot.digest,b.org)).status,404);
 const eventCount=async()=>Number((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='EXPORT_ALLOWED'")).rows[0].n);
 assert.equal(await eventCount(),1);failAudit(true);try{assert.equal((await download(manager,snapshot.digest)).status,503)}finally{failAudit(false)}assert.equal(await eventCount(),1);
 // A changed person/unit mapping invalidates the same report even without application edits.
 await ok(http(manager,directory+'/people/'+person.personId,'PUT',{name:'Pessoa de ensaio',email:'ensaio@example.invalid',functionLabel:'Gestão',active:true,unitIds:[unit.scopeId,second.scopeId],primaryUnitId:second.scopeId,expectedRevision:1,idempotencyKey:randomUUID()}));
 assert.equal((await download(manager,snapshot.digest)).status,409);
 const updated=await ok(http(manager,root));assert.equal(updated.items.filter(r=>r.unitId===second.scopeId).length,31);
 const limited=await actor(a.org,['application.read']);assert.equal((await ok(http(limited,root))).total,0);
 const denied=await actor(a.org,['opportunity.read']);await ok(http(denied,root),404);
 const restricted=await actor(a.org,['application.read','opportunity.read']);const beforeRevoke=await ok(http(restricted,root));
 await central.data.change({organizationId:a.org,membershipId:restricted.membershipId,expectedVersion:2,grants:[{permission:'application.read',scope:{type:'ORGANIZATION',id:a.org,organizationId:a.org}}],assuranceRequirements:central.requirement});
 assert.equal((await download(restricted,beforeRevoke.digest)).status,409);
 await require('./browser').run({base,manager,userB});
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-dashboard');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'http-verification.json'),JSON.stringify({result:'PASS',postgres:true,synthetic:true,applications:32,allStates:true,primaryUnitOnly:true,unassigned:true,directoryPermission:true,isolation:true,revocation:true,exportAudit:true,auditFailureBlocksContent:true,staleExport:true},null,2));console.log('DASHBOARD_POSTGRES_HTTP_REPORT_EXPORT_PASS');
}
module.exports={run};
