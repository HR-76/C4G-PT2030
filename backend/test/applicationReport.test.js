'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Workbook}=require('exceljs');
const {read}=require('xlsx');
const {parse,workbook}=require('../src/applications/report');
const {createSqlReport}=require('../src/applications/reportSql');
const {strategyAlignment}=require('../src/applications/strategyAlignment');
const {areas}=require('../src/organizationDirectory/thematicAreas');
const item={applicationId:'a',title:'=HYPERLINK("bad")',status:'APPROVED',responsibleMembershipId:'m',totalBudget:'99999999999999.99',organizationBudget:null,revision:2};
function fixture(overrides={}, {org='org-a', beforeExport=async()=>{}, total=1}={}){let record={...item,...overrides},unit='one',auditError=false;const events=[],queries=[];
 const client={async query(sql,params){
  queries.push({sql,params});
  const exporting=params.length===13||params[12]===10001;
  if(exporting)await beforeExport();
  const planned=record.central_snapshot?.schedule?.plannedClosing;
  const exported={...record,application_id:record.applicationId,total_budget:record.totalBudget,organization_budget:record.organizationBudget,
   opportunity_planned_closing:planned?.state==='PRESENT'?planned.value:null};
  return {rows:[{items:[{...(exporting?exported:record),unit_id:unit}],total,metrics:{total},states:{},units:[],fingerprint:JSON.stringify([record,unit]),deadlines:[],deadline_total:0}]};
 }};
 const run=createSqlReport({org,organizationName:'Centro de Investigação',actor:{id:'u'},guarded:async()=>{},readAuthority:async()=>({application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:true,ids:[]}}),responsibleDirectory:async()=>new Map(),project:r=>r,
  directory:async()=>({units:[{unitId:unit,label:'Unidade A'}]}),cursor:{cursor:()=> 'next'},
  audit:async(c,e)=>{if(auditError)throw Error('Audit unavailable');events.push(e)}});
 const report=(c,input,exporting)=>run(client,input,exporting);
 return {report,events,queries,change(){record.revision++},move(){unit='two'},failAudit(){auditError=true}};
}
test('report export revalidates the snapshot including unit assignment and records critical audit',async()=>{
 const f=fixture(),snapshot=await f.report(null,{});assert.equal(snapshot.items[0].unitId,'one');assert.equal(f.events.length,0);
 const {content}=await f.report(null,{digest:snapshot.digest},true);
 assert(Buffer.isBuffer(content));
 const sheet=read(content,{cellNF:true}).Sheets.Candidaturas;
 assert.equal(sheet.B2.v,'Centro de Investigação');
 assert.equal(sheet.A5.v,'Candidatura');
 assert.equal(sheet.A6.t,'s');
 assert.equal(sheet.A6.v,item.title);
 assert.equal(sheet.A6.f,undefined);
 assert.equal(sheet.E6.v,'Unidade A');
 assert.equal(sheet.H6.t,'s');
 assert.equal(sheet.H6.v,'99999999999999.99');
 assert.equal(sheet.H6.z,'@');
 assert.equal(sheet.I6?.v??null,null);
 assert.equal(sheet.J6.v,'a');
 assert.equal(sheet.K6.v,2);
 assert.equal(f.events[0].eventCode,'EXPORT_ALLOWED');
 f.move();await assert.rejects(f.report(null,{digest:snapshot.digest},true),{code:'STALE_REPORT'});assert.equal(f.events.length,1);
 const next=await f.report(null,{});f.change();await assert.rejects(f.report(null,{digest:next.digest},true),{code:'STALE_REPORT'});
});
test('the workbook styles and freezes the report table and omits scope and definition rows',async()=>{
 const title='Empreendedorismo qualificado associado ao conhecimento e à inovação empresarial';
 const content=await workbook({organizationId:'org-a',generatedAt:'2026-07-01T23:30:00Z',units:[],unitsAvailable:true,
  items:[{...item,title,deadline:'2026-07-02'},{...item,applicationId:'b',title:'Projeto B'}]});
 const book=new Workbook();
 await book.xlsx.load(content);
 const sheet=book.getWorksheet('Candidaturas');
 assert.equal(sheet.getCell('A1').value,'Relatório de candidaturas');
 assert.deepEqual(sheet.getColumn(1).values.slice(2,4),['Organização','Consultado em']);
 assert.equal(sheet.getCell('B3').value,'02/07/2026, 00:30:00');
 assert.equal(sheet.getCell('A4').value,null);
 assert.equal(sheet.getCell('A5').font.bold,true);
 assert.equal(sheet.getCell('A5').fill.type,'pattern');
 assert.equal(sheet.getCell('A6').value,title);
 assert.equal(sheet.getCell('A6').alignment.wrapText,true);
 assert.ok(sheet.getRow(6).height>sheet.getRow(7).height);
 assert.notEqual(sheet.getCell('A6').fill.fgColor.argb,sheet.getCell('A7').fill.fgColor.argb);
 assert.deepEqual(sheet.getCell('F6').value,new Date('2026-07-02T00:00:00Z'));
 assert.equal(sheet.getCell('F6').numFmt,'dd/mm/yyyy');
 assert.equal(sheet.autoFilter,'A5:K7');
 assert.equal(sheet.views[0].state,'frozen');
 assert.equal(sheet.views[0].xSplit,1);
 assert.equal(sheet.views[0].ySplit,5);
 assert.equal(sheet.views[0].showGridLines,false);
});
test('the export distinguishes published deadlines, planned closing and missing dates',async()=>{
 const plannedDate={state:'PRESENT',value:{precision:'DATE',value:'2027-03-31'}};
 const plannedPeriod={state:'PRESENT',value:{precision:'PERIOD',label:'2.º trimestre de 2027',start:'2027-04-01',end:'2027-06-30'}};
 for(const [published,planned,expected,format] of [
  ['2027-03-26',plannedDate,new Date('2027-03-26T00:00:00Z'),'dd/mm/yyyy'],
  [null,plannedDate,new Date('2027-03-31T00:00:00Z'),'dd/mm/yyyy" (previsto)"'],
  [null,plannedPeriod,'2.º trimestre de 2027 (previsto)','@'],
  [null,{state:'CONFLICT',value:null},'Não indicado','@'],
 ]){
  const f=fixture({opportunity_closing_date:published,central_snapshot:{schemaVersion:2,schedule:{plannedClosing:planned}}});
  const snapshot=await f.report(null,{});
  assert.equal(snapshot.items[0].opportunityClosingDate,published);
  assert.equal(Object.hasOwn(snapshot.items[0],'opportunityPlannedClosing'),false);
  const {content}=await f.report(null,{digest:snapshot.digest},true);
  const book=new Workbook();
  await book.xlsx.load(content);
  const cell=book.getWorksheet('Candidaturas').getCell('G6');
  assert.deepEqual(cell.value,expected);
  assert.equal(cell.numFmt,format);
 }
});
test('failed audit never returns export content and a failed directory never becomes unassigned',async()=>{
 const f=fixture(),snapshot=await f.report(null,{});f.failAudit();await assert.rejects(f.report(null,{digest:snapshot.digest},true),/Audit unavailable/);
 const report=createSqlReport({actor:{id:'u'},guarded:async()=>{},readAuthority:async()=>({}),responsibleDirectory:async()=>new Map(),directory:async()=>{throw Error('Read failed')}});await assert.rejects(report(null,{}),/Read failed/);
});
test('export selects a bounded workbook projection and rejects oversize reports before audit',async()=>{
 const f=fixture({}, {total:10001});
 const {digest}=await f.report(null,{});
 await assert.rejects(f.report(null,{digest},true),{code:'LIMIT_EXCEEDED'});
 const {sql,params}=f.queries.at(-1);
 assert.equal(params.at(-1),10000);
 assert.match(sql,/total_budget::text/);
 assert.doesNotMatch(sql,/approval_periods|SELECT \* FROM assigned/);
 assert.deepEqual(f.events,[]);
});
test('export admits one task per organization and two per process and releases failed tasks',async()=>{
 const first=Promise.withResolvers(),second=Promise.withResolvers();
 let aExports=0;
 const a=fixture({}, {org:'org-a',beforeExport:()=>++aExports===1?first.promise:Promise.reject(new Error('unexpected second query'))});
 const b=fixture({}, {org:'org-b',beforeExport:()=>second.promise});
 const c=fixture({}, {org:'org-c'});
 const [aReport,bReport,cReport]=await Promise.all([a,b,c].map(f=>f.report(null,{})));
 const one=a.report(null,{digest:aReport.digest},true),two=b.report(null,{digest:bReport.digest},true);
 const failed=assert.rejects(one,/export interrupted/);
 try{
  await assert.rejects(a.report(null,{digest:aReport.digest},true),{code:'REPORT_EXPORT_BUSY'});
  await assert.rejects(c.report(null,{digest:cReport.digest},true),{code:'REPORT_EXPORT_BUSY'});
 }finally{
  first.reject(new Error('export interrupted'));
  second.resolve();
  await Promise.all([failed,two]);
 }
 assert.ok((await c.report(null,{digest:cReport.digest},true)).content.length);
});
test('the XLSX download uses the workbook MIME type and keeps ordinary and zero budgets numeric',async()=>{
 const express=require('express');
 const {createApplicationSliceRouter}=require('../src/routes/applicationSliceRoutes');
 const f=fixture({totalBudget:'100000.25',organizationBudget:'0.00'});
 const {digest}=await f.report(null,{});
 const next=(req,res,done)=>done();
 const app=express();
 app.use('/api/applications',createApplicationSliceRouter({express,authenticate:next,
  organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},
  service:{execute(method,query){assert.equal(method,'reportExport');return f.report(null,parse(method,query),true)}}}));
 const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/applications/report.xlsx?digest=${digest}`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename=relatorio-candidaturas-c4g.xlsx');
  assert.equal(response.headers.get('cache-control'),'no-store');
  const sheet=read(Buffer.from(await response.arrayBuffer()),{cellNF:true}).Sheets.Candidaturas;
  assert.equal(sheet.H6.t,'n');
  assert.equal(sheet.H6.v,100000.25);
  assert.equal(sheet.H6.z,'#,##0.00" €"');
  assert.equal(sheet.I6.t,'n');
  assert.equal(sheet.I6.v,0);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
test('exact export query rejects forged scopes',()=>{
 for(const value of [{},{digest:'x'},{digest:'a'.repeat(64),organizationId:'other'},{digest:'a'.repeat(64),organizationName:'other'}])assert.throws(()=>parse('reportExport',value),{code:'INVALID_INPUT'});
 assert.deepEqual(parse('report',{cursor:'x'}),{cursor:'x'});
 assert.throws(()=>parse('report',{cursor:[]}),{code:'INVALID_INPUT'});
});

const education=areas.find(area=>area.name==='Educação e Formação Profissional');
const objectives=[
 {id:'a',title:'Expandir a formação',areaIds:[education.id]},
 {id:'b',title:'Apoiar a qualificação',areaIds:[education.id]},
 {id:'c',title:'Objetivo sem área',areaIds:[]},
];
const preparation=[
 {applicationId:'1',title:'Candidatura 1',opportunityTitle:'Vocational education and training'},
 {applicationId:'2',title:'Education training',opportunityTitle:'Xyz'},
];
test('thematic alignment counts each preparation application once even across several objectives',()=>{
 const summary=strategyAlignment(objectives,preparation,2);
 assert.equal(summary.state,'READY');assert.equal(summary.total,2);assert.equal(summary.aligned,1);
 assert.deepEqual(summary.objectives.map(goal=>goal.count),[1,1,0]);
 assert.deepEqual(summary.applications,[{applicationId:'1',title:'Candidatura 1',areaIds:[education.id]},
  {applicationId:'2',title:'Education training',areaIds:[]}]);
 assert.equal(summary.areaNames[education.id],education.name);
});

test('alignment distinguishes unavailable, unconfigured and empty data from a genuine zero',()=>{
 assert.equal(strategyAlignment(objectives,[],2).state,'UNAVAILABLE');
 assert.equal(strategyAlignment(objectives,[],1001).aligned,null);
 assert.equal(strategyAlignment([],[],2).state,'NO_OBJECTIVE_AREAS');
 assert.equal(strategyAlignment(objectives,[],0).state,'NO_PREPARATION');
 assert.equal(strategyAlignment(objectives,[preparation[1]],1).aligned,0);
});

test('the report reads strategy and preparation data only when protected access allows it',async()=>{
 let guarded=false,allowed=false;
 const run=createSqlReport({org:'org-a',actor:{id:'u'},guarded:async()=>{guarded=true},
  readAuthority:async()=>({application:{},opportunity:{},evaluation:{}}),responsibleDirectory:async()=>new Map(),directory:async()=>null,
  canReadStrategyAlignment:async()=>{assert.equal(guarded,true);return allowed}});
 const client={query:async sql=>{
  assert.equal(sql.includes('organizational_scope.organization_card'),allowed);
  return {rows:[{items:[],metrics:{total:2},states:{PREPARATION:{total:2}},deadlines:[],
   ...(allowed?{strategy_objectives:objectives,strategy_preparation:preparation}:{})}]};
 }};
 assert.equal((await run(client,{})).strategyAlignment,undefined);
 allowed=true;
 assert.equal((await run(client,{})).strategyAlignment.aligned,1);
});
