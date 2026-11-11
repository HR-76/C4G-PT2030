'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,id}=require('./support/httpSqlFixture');
const {createApplicationRepository}=require('../src/applications/repository');
const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
const {query}=require('../src/applications/contracts');
const enabled=['1','isolated-report'].includes(process.env.C4G_HTTP_SQL_TEST);
const sqlTest=(name,fn)=>test(name,{skip:!enabled},fn);
function repo(f,authority={teamOnly:false,membershipId:f.member,application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:false,ids:[]},version:[1,1]},options={}){
 let authCalls=0;return {repository:createApplicationRepository({organizationId:f.org,actor:{id:id(200000)},protect:async()=>{},readAuthority:async()=>{authCalls++;return authority;},
  responsibleDirectory:async()=>new Map([[f.member,'Ana responsável']]),transitionCapability:async()=>false,
  cursor:createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'}),audit:async()=>{},...options}),authCalls:()=>authCalls};
}
sqlTest('PostgreSQL browse filters visibility before counts/page, preserves decimals, search and stale cursors',async()=>{
 const f=await fixture();try{
  await f.db.query('UPDATE application SET evaluation_id=$1 WHERE application_id=$2',[id(500),id(56)]);
  const authority={teamOnly:false,membershipId:f.member,application:{all:false,ids:Array.from({length:56},(_,n)=>id(n+1))},opportunity:{all:true,ids:[]},evaluation:{all:false,ids:[]}};
  const {repository:r}=repo(f,authority),first=await r.browse(f.client,query('browse',{}));
  assert.equal(first.total,55);assert.equal(first.items.length,25);assert.equal(first.countsByStatus.SUBMITTED,28);
  const second=await r.browse(f.client,query('browse',{cursor:first.nextCursor})),third=await r.browse(f.client,query('browse',{cursor:second.nextCursor}));
  assert.equal(third.items.length,5);assert.equal(new Set([...first.items,...second.items,...third.items].map(x=>x.applicationId)).size,55);
  assert.deepEqual((await r.browse(f.client,query('browse',{cursor:second.previousCursor}))).items,first.items);
  assert.equal((await r.browse(f.client,query('browse',{q:'ANA RESPONSÁVEL',status:'IDENTIFIED'}))).total,27);
  assert.equal((await r.browse(f.client,query('browse',{q:'not found'}))).total,0);
  await f.db.query('UPDATE application SET total_budget=$1 WHERE application_id=$2',['99999999999999.99',id(1)]);
  const sorted=await r.browse(f.client,query('browse',{sort:'totalBudget',direction:'desc'}));assert.equal(sorted.items[0].applicationId,id(1));
  await assert.rejects(r.browse(f.client,query('browse',{cursor:first.nextCursor})),{code:'INVALID_CURSOR'});
 }finally{await f.close();}
});
sqlTest('PostgreSQL excludes other tenants and non-team rows, uses central id and evaluation visibility',async()=>{
 const f=await fixture(50);try{
  await f.db.query('INSERT INTO application_participant VALUES($1,$2,$3,true)',[f.org,id(1),f.member]);
  await f.db.query('INSERT INTO application_participant VALUES($1,$2,$3,true)',[f.org,id(2),f.member]);
  await f.db.query('UPDATE application SET organization_id=$1 WHERE application_id=$2',[id(333333),id(2)]);
  await f.db.query('UPDATE application SET opportunity_id=NULL,central_opportunity_id=$1,central_snapshot=$2 WHERE application_id=$3',[id(444444),{title:'Central',closingDate:'2027-01-01'},id(1)]);
  const {repository:r}=repo(f,{teamOnly:true,membershipId:f.member,application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:true,ids:[]}});
  const result=await r.browse(f.client,query('browse',{opportunityId:id(444444)}));assert.equal(result.total,1);assert.equal(result.items[0].opportunityTitle,'Central');
  await f.db.query('UPDATE application_participant SET active=false');assert.equal((await r.browse(f.client,query('browse',{}))).total,0);
 }finally{await f.close();}
});
sqlTest('25 and 10000 candidates each materialize only a page with one browse query and one authority load',async()=>{
 for(const size of [25,10000]){const f=await fixture(size);try{
  const {repository:r,authCalls}=repo(f),result=await r.browse(f.client,query('browse',{}));
  assert.equal(result.total,size);assert.equal(result.items.length,25);assert.deepEqual(f.counts(),{queries:1,rows:1});assert.equal(authCalls(),1);
 }finally{await f.close();}}
});
sqlTest('report metrics aggregate all records but return 25 details, exact money and a stable export identity',async()=>{
 const f=await fixture(57);try{
  const {repository:r}=repo(f),first=await r.report(f.client,{});assert.equal(first.items.length,25);assert.equal(first.total,57);
  assert.equal(first.metrics.organizationBudget.total,null);assert.equal(first.metrics.organizationBudget.missing,57);
  assert.equal(first.metrics.totalBudget.total,'3180.01');
  const next=await r.report(f.client,{cursor:first.nextCursor});assert.equal(next.digest,first.digest);assert.equal(next.items.length,25);
  const {content}=await r.reportExport(f.client,{digest:first.digest});
  const {Sheets}=require('xlsx').read(content);assert.equal(Sheets.Candidaturas['!ref'],'A1:K62');
  await f.db.query("UPDATE application SET organization_budget='0.00' WHERE application_id=$1",[id(1)]);
  await assert.rejects(r.reportExport(f.client,{digest:first.digest}),{code:'STALE_REPORT'});
 }finally{await f.close();}
});
module.exports={repo};
sqlTest('SQL unit aggregates and exports change identity after primary-unit movement and fail closed on audit errors',async()=>{
 const f=await fixture(2);try{
  await f.db.query('INSERT INTO person_profile VALUES($1,$2,$3,$4)',[f.org,id(900),f.member,[]]);
  await f.db.query('INSERT INTO person_unit VALUES($1,$2,$3,true)',[f.org,id(900),id(901)]);
  let failAudit=false;
  const {repository:r}=repo(f,undefined,{reportDirectory:async()=>({units:[{unitId:id(901),label:'Unidade',people:1}]}),audit:async()=>{if(failAudit)throw Error('audit failed');}});
  const first=await r.report(f.client,{});assert.equal(first.unitMetrics[0].metrics.total,2);assert.equal(first.items[0].unitId,id(901));
  failAudit=true;await assert.rejects(r.reportExport(f.client,{digest:first.digest}),/audit failed/);failAudit=false;
  await f.db.query('UPDATE person_unit SET scope_id=$1',[id(902)]);
  await assert.rejects(r.reportExport(f.client,{digest:first.digest}),{code:'STALE_REPORT'});
 }finally{await f.close();}
});
sqlTest('report export uses frozen opportunity dates, exact money and the authorized SQL population',async()=>{
 const f=await fixture(5);try{
  const date={precision:'DATE',value:'2027-03-31'};
  const period={precision:'PERIOD',start:'2027-04-01',end:'2027-06-30',label:'2.º trimestre de 2027'};
  for(const [n,planned,official] of [[1,date,'2027-03-26'],[2,date,null],[3,period,null],[4,null,null]]){
   const snapshot={schemaVersion:2,description:{title:{state:'PRESENT',value:'Aviso central'}},schedule:{
    plannedClosing:planned?{state:'PRESENT',value:planned}:{state:'NOT_FOUND'},
    deadlines:official?{state:'PRESENT',value:[{at:{precision:'DATE',value:official}}]}:{state:'NOT_FOUND'}
   }};
   await f.db.query('UPDATE application SET opportunity_id=NULL,central_opportunity_id=$2,central_snapshot=$3 WHERE application_id=$1',[id(n),id(500+n),snapshot]);
  }
  await f.db.query("UPDATE application SET organization_id=$1,title='Outra entidade' WHERE application_id=$2",[id(999),id(5)]);
  await f.db.query("UPDATE application SET total_budget='99999999999999.99' WHERE application_id=$1",[id(2)]);
  const events=[];
  const {repository:r}=repo(f,undefined,{audit:async(_client,event)=>events.push(event.eventCode)});
  const report=await r.report(f.client,{});
  assert.equal(report.total,4);
  const {content}=await r.reportExport(f.client,{digest:report.digest});
  const book=new (require('exceljs').Workbook)();
  await book.xlsx.load(content);
  const sheet=book.getWorksheet('Candidaturas');
  assert.equal(sheet.rowCount,9);
  assert.deepEqual(sheet.getCell('G6').value,new Date('2027-03-26T00:00:00Z'));
  assert.deepEqual(sheet.getCell('G7').value,new Date('2027-03-31T00:00:00Z'));
  assert.equal(sheet.getCell('G7').numFmt,'dd/mm/yyyy" (previsto)"');
  assert.equal(sheet.getCell('G8').value,'2.º trimestre de 2027 (previsto)');
  assert.equal(sheet.getCell('G9').value,'Não indicado');
  assert.equal(sheet.getCell('H7').value,'99999999999999.99');
  assert.deepEqual(events,['EXPORT_ALLOWED']);
 }finally{await f.close();}
});
sqlTest('report export rejects a population above the row limit without loading workbook rows',async()=>{
 const f=await fixture(10001);try{
  const {repository:r}=repo(f,undefined,{audit:async()=>assert.fail('An oversized export must not be audited as allowed')});
  const report=await r.report(f.client,{});
  assert.equal(report.total,10001);
  const client={async query(sql,params){
   const result=await f.client.query(sql,params);
   assert.deepEqual(result.rows[0].items,[]);
   return result;
  }};
  await assert.rejects(r.reportExport(client,{digest:report.digest}),{code:'LIMIT_EXCEEDED'});
 }finally{await f.close();}
});
sqlTest('opportunity summary uses SQL counts, known deadlines and bounded details on both databases',async()=>{
 const f=await fixture(0);try{
  const {opportunitySummary}=require('../src/applications/opportunitySummary');
  await f.db.query("INSERT INTO opportunity VALUES($1,$2,'Archived','2026-11-01','ARCHIVED',$3),($1,$4,'Open','2026-10-30','ACTIVE',$5),($1,$6,'Unknown',NULL,'ACTIVE',$7)",[f.org,id(10),id(11),id(12),id(13),id(14),id(15)]);
  await f.db.query('INSERT INTO revision VALUES($1),($2),($3)',[id(11),id(13),id(15)]);
  await f.db.query("INSERT INTO funding_identity VALUES($1,'POCTEP:2021-2027:CALL:1'),($2,'EU-CALL'),($3,'INTERREG_EUROPE:2021-2027:CALL:2')",[id(10),id(12),id(14)]);
  const central=await opportunitySummary(f.client,{central:true,today:'2026-10-26'});
  assert.equal(central.total,3);assert.equal(central.open,1);assert.equal(central.closing_soon,1);assert.equal(central.recent[0].href,'/catalogo/'+id(12));
  const privateSummary=await opportunitySummary(f.client,{organizationId:f.org,today:'2026-10-26'});
  assert.equal(privateSummary.total,3);assert.equal(privateSummary.open,2);assert.equal(privateSummary.sources[0].source,'Registo privado');
 }finally{await f.close();}
});
sqlTest('peopleWithResearchAreas joins profiles once, preserves active filter and never queries per person',async()=>{
 const f=await fixture(0);try{
  const {createDirectoryRepository}=require('../src/organizationDirectory/repository');
  await f.db.query("INSERT INTO person SELECT $1,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Person '||n,'','',n<>2,1 FROM generate_series(1,30)n",[f.org]);
  await f.db.query('INSERT INTO person_profile VALUES($1,$2,NULL,$3)',[f.org,id(1),[id(99)]]);
  const r=createDirectoryRepository({organizationId:f.org,actor:{id:id(100)},protect:async()=>{},tokens:createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'})});
  const result=await r.peopleWithResearchAreas(f.client,{search:'',unitId:null,status:'ACTIVE',cursor:null});
  assert.equal(result.items.length,25);assert.deepEqual(result.items[0].areaIds,[id(99)]);assert(!result.items.find(p=>p.personId===id(2)));assert.deepEqual(result.items[1].areaIds,[]);
  assert.deepEqual(f.counts(),{queries:1,rows:26});
 }finally{await f.close();}
});
