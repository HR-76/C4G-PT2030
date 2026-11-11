'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSource,formData}=require('../src/fundingTenders/source');
const {selection,collectionPolicy}=require('../src/fundingTenders/programmes');
const {fundingWorkerTarget}=require('../src/config/fundingTendersWorker');
const {normaliseProgramme}=require('../src/utils/programmeMapping');

test('official numeric programme IDs keep RENEWFM separate from Erasmus+',()=>{
 assert.equal(normaliseProgramme('43253967'),'RENEWFM');
 assert.equal(normaliseProgramme(' 43253967 '),'RENEWFM');
 assert.equal(normaliseProgramme('43353764'),'ERASMUS');
 assert.equal(normaliseProgramme('RENEWFM'),'RENEWFM');
});

test('Erasmus requests exclude RENEWFM and reject mixed responses while general collection keeps both',async()=>{
 const queries=[];
 const source=createSource({fetchImpl:async(url,options)=>{
  queries.push(JSON.parse(await options.body.get('query').text()));
  return new Response(JSON.stringify({results:[
   {content:'Synthetic Erasmus call',metadata:{identifier:['FIXTURE-ERASMUS'],frameworkProgramme:['43353764'],deadlineDate:['2099-01-01']}},
   {content:'Synthetic renewable energy call',metadata:{identifier:['FIXTURE-RENEWFM'],frameworkProgramme:['43253967'],deadlineDate:['2099-01-01']}}
  ]}));
 }});
 const erasmus=await source.collect({source:'ERASMUS'});
 const codes=queries[0].bool.must.find(x=>x.terms?.frameworkProgramme).terms.frameworkProgramme;
 assert.ok(codes.includes('43353764'));
 assert.ok(!codes.includes('43253967'));
 assert.deepEqual(erasmus.records.map(x=>[x.externalIdentifier,x.fields.programmeName]),[['FIXTURE-ERASMUS','ERASMUS']]);
 assert.equal(erasmus.failed,1);
 const general=await source.collect({source:'EU_FUNDING_TENDERS'});
 assert.ok(!queries[1].bool.must.some(x=>x.terms?.frameworkProgramme));
 assert.deepEqual(general.records.map(x=>[x.externalIdentifier,x.fields.programmeName]),[['FIXTURE-ERASMUS','ERASMUS'],['FIXTURE-RENEWFM','RENEWFM']]);
 assert.equal(general.failed,0);
});
test('programme selections are closed and create distinct official query filters',async()=>{
 for(const code of ['CORDIS','ERASMUS'])assert.deepEqual(JSON.parse(await formData(code).get('query').text()).bool.must.at(-1),{terms:{frameworkProgramme:selection(code)}});
 // Currency comes from status and future deadlines. A programmePeriod term drops
 // current 2028-2034 calls and calls the portal publishes without a period.
 assert.deepEqual(JSON.parse(await formData().get('query').text()).bool.must,[{terms:{type:['1','2','8']}},{terms:{status:['31094501','31094502']}}]);
 for(const code of ['__proto__','INTERREG',null,{},''])assert.throws(()=>selection(code),{code:'INVALID_INPUT'});
});
test('filtered collection fails mismatched programmes instead of importing another selection',async()=>{
 const source=createSource({fetchImpl:async()=>new Response(JSON.stringify({results:[{content:'Wrong programme',metadata:{identifier:['WRONG'],frameworkProgramme:['43108390'],deadlineDate:['2099-01-01']}}]}))});
 const result=await source.collect({source:'ERASMUS'});assert.equal(result.failed,1);assert.equal(result.records.length,0);
});
test('100-result policy only activates on explicitly approved native installation',()=>{
 assert.deepEqual(collectionPolicy('live-local','central-programmes-100').limits,{results:100,pageSize:100,pages:1});
 for(const mode of ['fixture','live-demo','live-rehearsal','unconfigured'])assert.equal(collectionPolicy(mode,'central-programmes-100').limits.results,5);
 const env={NODE_ENV:'development',FUNDING_TENDERS_RUNTIME:'central',FUNDING_TENDERS_SOURCE:'live-local',FUNDING_TENDERS_REHEARSAL_APPROVED:'central-programmes-100',CENTRAL_DATABASE_URL:'postgresql://localhost:5432/c4g_central_dev'};
 assert.equal(fundingWorkerTarget(env).live,true);
 assert.throws(()=>fundingWorkerTarget({...env,FUNDING_TENDERS_SOURCE:'live-demo'}));
 assert.throws(()=>fundingWorkerTarget({...env,CENTRAL_DATABASE_URL:'postgresql://localhost:5432/other'}));
});
test('programme codes in the official FACET of 2026-11-11 resolve to acronyms, never raw numeric ids',()=>{
 for(const [id,code] of [['44416173','I3'],['44773066','JTM'],['43252386','JUST'],['45876777','NDICI'],['42810547','ED'],['43089234','INNOVFUND'],['43251882','IMCAP'],['43252433','PERICLES IV'],['43253952','HUMA'],['43332642','EU4H'],['43392145','EMFAF'],['44773133','IMREG']])assert.equal(normaliseProgramme(id),code);
});
test('canonical taxonomy covers every programme in the official FACET of 2026-11-11',()=>{
 const {programmeFor,VERSION}=require('../src/fundingTenders/programmeTaxonomy');
 const evidence=require('../../context/references/opportunity-v2/evidence/eu-programme-taxonomy-2026-11-11.json');
 assert.equal(VERSION,'eu-framework-2026-11-11');assert.equal(evidence.values.length,33);
 for(const value of evidence.values)assert.equal(programmeFor(value.rawValue)?.label,value.value,value.rawValue);
 for(const [id,code] of [['111111','RELEX-PROSPECT'],['31045243','H2020'],['31059643','COSME'],['42810547','ED'],['43253952','HUMA'],['43332642','EU4H']])assert.equal(programmeFor(id).code,code);
 assert.equal(programmeFor('99999999'),null);assert.equal(normaliseProgramme('111111'),'RELEX-PROSPECT');
});
