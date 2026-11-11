'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {SOURCES,civil,parseInterreg,parsePoctep,tableCalls,createOfficialSource}=require('../src/fundingTenders/officialSources');
const {LIMITS,formData,normalizeRecord}=require('../src/fundingTenders/source');
const {collectionPolicy,OFFICIAL_APPROVAL}=require('../src/fundingTenders/programmes');
const {validateSourceIdentity}=require('../src/fundingTenders/sourceIdentity');
const dir=path.join(__dirname,'fixtures/official-programmes');
const excel=fs.readFileSync(path.join(dir,'interreg.xlsx'));
const calendar=require('./fixtures/official-programmes/calendar.json'),open=require('./fixtures/official-programmes/open.json');
const clock=()=>Date.parse('2026-10-18T12:00:00Z');
function fixture(url){return new Response(url.endsWith('.xlsx')?excel:JSON.stringify(url===SOURCES.POCTEP.url?calendar:open),{headers:{'content-type':url.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json'}});}
test('Interreg official Excel retains civil dates and excludes notes',()=>{
 const r=parseInterreg(excel);assert.equal(r.length,3);assert.deepEqual(r.map(x=>[x.fields.openingDate,x.fields.closingDate]),[['2022-04-05','2022-05-31'],['2023-03-15','2023-06-09'],['2024-03-20','2024-06-07']]);
});
test('dates are strict civil values, including leap days',()=>{
 assert.equal(civil('29/02/2024'),'2024-02-29');assert.equal(civil(45450),'2024-06-07');for(const v of ['31/02/2026','Pendiente confirmar',new Date(),45450.5,'2026-01-01T00:00:00Z'])assert.throws(()=>civil(v),{code:'SOURCE_RESPONSE_INVALID'});
});
test('POCTEP real fixtures contain ten identities, official dates and deadline wording',()=>{
 const records=parsePoctep(calendar,open);assert.equal(records.length,10);assert.equal(records.filter(r=>!r.declaredClosed).length,2);
 const ninth=records.find(r=>r.externalIdentifier.endsWith(':9')),tenth=records.find(r=>r.externalIdentifier.endsWith(':10'));
 assert.equal(ninth.fields.closingDate,'2026-10-21');assert.match(ninth.fields.summary,/14:00/);assert.match(ninth.fields.summary,/hora peninsular española/);assert.match(ninth.fields.summary,/naturaleza jurídica pública/);
 assert.equal(tenth.fields.closingDate,'2026-11-17');assert.match(tenth.fields.summary,/17 de noviembre de 2026/);assert.match(tenth.fields.summary,/no|não por candidatura/);
 assert.doesNotMatch(tenth.fields.title,/ABIERTA/);
});
test('current selection returns zero Interreg and two POCTEP, without pretending failures are zero',async()=>{
 const source=createOfficialSource({fetchImpl:fixture,clock});const interreg=await source.collect({source:'INTERREG_EUROPE'}),poctep=await source.collect({source:'POCTEP'});
 assert.equal(interreg.records.length,0);assert.equal(interreg.received,3);assert.equal(interreg.excluded,3);
 assert.equal(poctep.received,10);assert.equal(poctep.records.length,2);assert.equal(poctep.excluded,8);assert.equal(poctep.failed,0);
});
test('stable identities survive changed titles and deadlines',()=>{
 const original=parsePoctep(calendar,open),c=structuredClone(calendar),o=structuredClone(open);
 c.content.rendered=c.content.rendered.replaceAll('17/11/2026','18/11/2026').replaceAll('Prioridades 1, 2, 3, 4, 5 y 7','Prioridades atualizadas');o.content.rendered=o.content.rendered.replaceAll('17/11/2026','18/11/2026');
 const changed=parsePoctep(c,o);assert.deepEqual(changed.map(r=>r.externalIdentifier),original.map(r=>r.externalIdentifier));assert.equal(changed.find(r=>r.externalIdentifier.endsWith(':10')).fields.closingDate,'2026-11-18');
});
test('unknown schemas, impossible/reversed dates and mismatched official pages fail the whole batch',()=>{
 for(const transform of [h=>h.replaceAll('Apertura','Inicio cambiado'),h=>h.replaceAll('17/11/2026','31/02/2026'),h=>h.replaceAll('17/11/2026','17/11/2025'),h=>h.replaceAll('17/11/2026','18/11/2026')]){
 const c=structuredClone(calendar);c.content.rendered=transform(c.content.rendered);assert.throws(()=>parsePoctep(c,open),{code:'SOURCE_RESPONSE_INVALID'});}
 assert.throws(()=>parsePoctep({...calendar,id:999},open),{code:'SOURCE_RESPONSE_INVALID'});
 assert.throws(()=>tableCalls('<h1>Próximas convocatorias</h1><p>9ª Convocatoria 21/10/2026</p>'),{code:'SOURCE_RESPONSE_INVALID'});
});
test('table duplicates agree or fail; external headings cannot create records',()=>{
 const t=calendar.content.rendered.match(/<table\b[\s\S]*?<\/table>/i)[0];assert.equal(tableCalls(t+t).length,10);
 assert.throws(()=>tableCalls(t+t.replaceAll('21/10/2026','22/10/2026')),{code:'SOURCE_RESPONSE_INVALID'});
 assert.equal(tableCalls('<h2>99ª Convocatoria 18/10/2026</h2>'+t).length,10);
});
test('ZIP bounds and unsupported workbooks fail before parsing',()=>{
 assert.throws(()=>parseInterreg(Buffer.from('not Excel')),{code:'SOURCE_RESPONSE_INVALID'});
 const altered=Buffer.from(excel);const offset=altered.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));altered.writeUInt32LE(20000000,offset+24);assert.throws(()=>parseInterreg(altered),{code:'SOURCE_RESPONSE_TOO_LARGE'});
});
test('source namespace cannot collide with EU or another programme',()=>{
 assert.equal(validateSourceIdentity('CORDIS','HORIZON-TEST'),'EU_FUNDING_TENDERS');assert.equal(validateSourceIdentity('POCTEP','POCTEP:2021-2027:CALL:9'),'POCTEP');
 for(const [source,id] of [['EU_FUNDING_TENDERS','POCTEP:2021-2027:CALL:9'],['POCTEP','INTERREG_EUROPE:2021-2027:CALL:9'],['POCTEP','poctep:invalid']])assert.throws(()=>validateSourceIdentity(source,id));
 assert.throws(()=>formData('POCTEP'));assert.throws(()=>normalizeRecord({content:'Bad',metadata:{identifier:['POCTEP:2021-2027:CALL:9']}}),{code:'SOURCE_RECORD_INVALID'});
 assert.equal(collectionPolicy('live-local',OFFICIAL_APPROVAL).sources.length,5);assert.equal(collectionPolicy('fixture',OFFICIAL_APPROVAL).sources.length,1);
});
test('transport restricts redirects, MIME, body size and malformed JSON',async()=>{
 for(const response of [()=>new Response('',{status:302}),()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(LIMITS.bytes+1)}})])await assert.rejects(createOfficialSource({fetchImpl:response,clock}).collect({source:'POCTEP'}));
 const source=createOfficialSource({fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');return new Response('x'.repeat(101),{headers:{'content-type':'application/json'}});},limits:{...LIMITS,bytes:100}});
 await assert.rejects(source.collect({source:'POCTEP'}),{code:'SOURCE_RESPONSE_TOO_LARGE'});
});
test('transient failures retry within bounds and cancellation interrupts the transport',async()=>{
 let calls=0;const source=createOfficialSource({fetchImpl:async url=>++calls===1?new Response('',{status:503}):fixture(url),sleep:async()=>{},clock});
 assert.equal((await source.collect({source:'POCTEP'})).records.length,2);assert.equal(calls,3);
 const timeout=createOfficialSource({fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))),limits:{...LIMITS,requestMs:5,retries:0}});
 await assert.rejects(timeout.collect({source:'POCTEP'}),{code:'SOURCE_TIMEOUT'});
 const controller=new AbortController();controller.abort();await assert.rejects(source.collect({source:'POCTEP',signal:controller.signal}),{code:'SOURCE_TIMEOUT'});
});
test('local standby startup never dispatches or polls queued collection work',async()=>{
 const {beginProcessing}=require('../scripts/localPlatform/worker');
 const worker={runOnce:()=>assert.fail('Standby must not consume jobs'),start:()=>assert.fail('Standby must not schedule polling')};
 await beginProcessing(worker,{standby:true});
});
test('POCTEP refresh retains known call 9 after expiry while discovering call 10',async()=>{
 const source=createOfficialSource({fetchImpl:fixture,clock:()=>Date.parse('2026-10-28T12:00:00Z')});
 const result=await source.collect({source:'POCTEP',knownIdentifiers:['POCTEP:2021-2027:CALL:9']});
 assert.deepEqual(result.records.map(r=>r.externalIdentifier),['POCTEP:2021-2027:CALL:10','POCTEP:2021-2027:CALL:9']);
 const {temporalState}=require('../src/opportunities/temporal');
 assert.equal(temporalState(result.records.find(r=>r.externalIdentifier.endsWith(':9')).fields,'2026-10-28T12:00:00Z').state,'CLOSED');
 assert.equal(temporalState(result.records.find(r=>r.externalIdentifier.endsWith(':10')).fields,'2026-10-28T12:00:00Z').state,'OPEN');
});
