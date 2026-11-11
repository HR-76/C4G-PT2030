'use strict';
// Proof infrastructure only: one loopback owner, fsync before permission to send.
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const KEYS = ['functionalRequests','cleanupRequests','applicationBytes','objectIntentions','completedObjects','multipartIntentions','unresolvedMultipart'];
const OPERATIONS = new Set(['HeadBucket','ListObjectsV2','ListMultipartUploads','PutObject','HeadObject','GetObject','DeleteObject']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const validBudget = value => value && KEYS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
const exact = (value, keys) => value && Object.keys(value).every(key => keys.includes(key));

function replay(bytes) {
  if (!bytes.endsWith('\n')) throw fail('BUDGET_JOURNAL_INCOMPLETE');
  const rows = bytes.trimEnd().split('\n').map(line => JSON.parse(line));
  let prior = '0'.repeat(64), sequence = 0, state;
  for (const row of rows) {
    const { digest, ...material } = row;
    if (row.sequence !== ++sequence || row.previous !== prior || digest !== hash(JSON.stringify(material))) throw fail('BUDGET_JOURNAL_INVALID');
    prior = digest;
    if (sequence === 1) {
      if (row.event !== 'BASELINE' || !validBudget(row.baseline) || !validBudget(row.limits)) throw fail('BUDGET_BASELINE_INVALID');
      state = { budget: {...row.baseline}, limits: row.limits, requests: new Map(), objects: new Set(), slots: new Set(), header: row };
    } else apply(state, row);
  }
  return { ...state, sequence, previous: prior };
}
function apply(state, row) {
  if (row.event === 'RESERVED') {
    if (state.requests.has(row.id)) throw fail('BUDGET_DUPLICATE_RESERVATION');
    const budget = {...state.budget};
    if (row.operation === 'OBJECT_INTENT') {
      if (state.objects.has(row.objectId)) throw fail('BUDGET_DUPLICATE_OBJECT');
      budget.objectIntentions++;
    } else {
      if (!OPERATIONS.has(row.operation) || !['functional','cleanup'].includes(row.phase) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw fail('BUDGET_OPERATION_INVALID');
      if (row.operation === 'DeleteObject' && row.phase !== 'cleanup') throw fail('BUDGET_CLEANUP_REQUIRED');
      if (row.phase === 'cleanup' && !['HeadObject','DeleteObject'].includes(row.operation)) throw fail('BUDGET_FUNCTIONAL_IN_CLEANUP');
      budget[row.phase === 'cleanup' ? 'cleanupRequests' : 'functionalRequests']++;
      budget.applicationBytes += row.bytes;
      if (row.operation === 'PutObject') {
        if (!state.objects.has(row.objectId)) throw fail('BUDGET_INTENT_REQUIRED');
        if (!state.slots.has(row.objectId)) budget.completedObjects++;
      }
    }
    if (KEYS.some(key => budget[key] > state.limits[key])) throw fail('BUDGET_EXHAUSTED');
    if (row.operation === 'OBJECT_INTENT') state.objects.add(row.objectId);
    if (row.operation === 'PutObject') state.slots.add(row.objectId);
    state.budget = budget; state.requests.set(row.id, { ...row, state: 'RESERVED' });
  } else if (['STARTED','CONFIRMED','UNCERTAIN'].includes(row.event)) {
    const request = state.requests.get(row.id);
    if (!request || request.phase !== row.phase ||
      (row.event === 'STARTED' ? request.state !== 'RESERVED' : request.state !== 'STARTED')) throw fail('BUDGET_EVENT_ORDER');
    request.state = row.event;
  } else throw fail('BUDGET_EVENT_INVALID');
}
function copyState(state) {
  return {...state,budget:{...state.budget},objects:new Set(state.objects),slots:new Set(state.slots),requests:new Map([...state.requests].map(([key,value])=>[key,{...value}]))};
}

async function startCoordinator({ journalPath, port, tokens, baseline, limits, source, persist = null }) {
  if (!validBudget(baseline) || !validBudget(limits) || KEYS.some(key=>baseline[key]>limits[key]) || !tokens?.functional || !tokens?.cleanup || tokens.functional === tokens.cleanup) throw fail('BUDGET_CONFIGURATION_INVALID');
  let state, descriptor, poisoned = false;
  const authenticate = request => {
    const supplied = Buffer.from(request.headers.authorization || '');
    for (const phase of ['functional','cleanup']) { const expected=Buffer.from(`Bearer ${tokens[phase]}`); if(supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected)) return phase; }
    throw fail('BUDGET_AUTH_REQUIRED');
  };
  const server = http.createServer(async (request,response) => {
    try {
      if (!state || poisoned) throw fail('BUDGET_UNAVAILABLE');
      const phase = authenticate(request);
      if (request.method !== 'POST' || request.url !== '/') throw fail('BUDGET_ROUTE_INVALID');
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>4096)throw fail('BUDGET_INPUT_LIMIT');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!exact(input,['action','id','operation','bytes','objectId','provenance']))throw fail('BUDGET_INPUT_INVALID');
      if(input.action==='snapshot'){response.end(JSON.stringify({budget:state.budget,sequence:state.sequence}));return;}
      if(!/^[0-9a-f-]{36}$/i.test(input.id||''))throw fail('BUDGET_ID_INVALID');
      let event;
      if(input.action==='reserve'){
        if(input.objectId!==undefined&&!/^[0-9a-f-]{36}$/i.test(input.objectId))throw fail('BUDGET_OBJECT_INVALID');
        if(input.operation==='OBJECT_INTENT'&&(phase!=='functional'||!input.objectId))throw fail('BUDGET_INTENT_INVALID');
        if(input.provenance && (input.operation!=='OBJECT_INTENT'||!exact(input.provenance,['bucket','key','sha256','size','proofTag'])||
          !/^[a-f0-9]{64}$/.test(input.provenance.sha256||'')||!Number.isSafeInteger(input.provenance.size)||input.provenance.size<1||
          !/^[a-z0-9-]{3,63}$/.test(input.provenance.bucket||'')||!/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/i.test(input.provenance.key||'')||
          !/^[a-f0-9-]{36}$/i.test(input.provenance.proofTag||'')))throw fail('BUDGET_PROVENANCE_INVALID');
        event={event:'RESERVED',id:input.id,phase,operation:input.operation,bytes:input.bytes||0,...(input.objectId?{objectId:input.objectId}:{}),...(input.provenance?{provenance:input.provenance}:{})};
      }else if(['STARTED','CONFIRMED','UNCERTAIN'].includes(input.action))event={event:input.action,id:input.id,phase};
      else throw fail('BUDGET_ACTION_INVALID');
      const next=copyState(state);apply(next,event);append(event);state={...state,...next,sequence:state.sequence,previous:state.previous};
      response.end(JSON.stringify({accepted:true,sequence:state.sequence}));
    }catch(error){response.statusCode=503;response.end(JSON.stringify({code:/^BUDGET_[A-Z_]+$/.test(error.code||'')?error.code:'BUDGET_UNAVAILABLE'}));}
  });
  function append(event) {
    if(poisoned)throw fail('BUDGET_UNAVAILABLE');
    const material={sequence:(state?.sequence||0)+1,previous:state?.previous||'0'.repeat(64),...event};
    const record={...material,digest:hash(JSON.stringify(material))};
    try { const bytes=Buffer.from(JSON.stringify(record)+'\n');
      if(persist)persist(descriptor,bytes);else {let offset=0;while(offset<bytes.length)offset+=fs.writeSync(descriptor,bytes,offset);fs.fsyncSync(descriptor);}
    }catch{poisoned=true;throw fail('BUDGET_PERSISTENCE_FAILED');}
    if(state){state.sequence=record.sequence;state.previous=record.digest;}return record;
  }
  // Exclusive TCP binding is acquired before touching the journal. Header pins
  // its port: a different-port process cannot open the same journal for writing.
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port,exclusive:true},resolve);});
  const bound=server.address().port;
  try {
    if(fs.existsSync(journalPath)){
      state=replay(fs.readFileSync(journalPath,'utf8'));
      if(state.header.port!==bound||JSON.stringify(state.header.baseline)!==JSON.stringify(baseline)||JSON.stringify(state.header.limits)!==JSON.stringify(limits)||state.header.source!==source)throw fail('BUDGET_BINDING_INVALID');
      descriptor=fs.openSync(journalPath,'a');
    }else{
      descriptor=fs.openSync(journalPath,'wx',0o600);
      append({event:'BASELINE',port:bound,baseline,limits,source});
      state=replay(fs.readFileSync(journalPath,'utf8'));
    }
  }catch(error){if(descriptor!==undefined)fs.closeSync(descriptor);await new Promise(resolve=>server.close(resolve));throw error;}
  return {port:bound,snapshot:()=>({budget:{...state.budget},sequence:state.sequence}),intentions:()=>[...state.requests.values()].filter(row=>row.operation==='OBJECT_INTENT').map(row=>({...row})),async close(){await new Promise(resolve=>server.close(resolve));fs.closeSync(descriptor);}};
}

function createBudgetClient({port,token}) {
  async function call(input){return new Promise((resolve,reject)=>{
    const body=JSON.stringify(input),request=http.request({host:'127.0.0.1',port,path:'/',method:'POST',agent:false,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':Buffer.byteLength(body)},timeout:5000},response=>{
      let text='';response.on('data',chunk=>{text+=chunk;if(text.length>8192)response.destroy(fail('BUDGET_RESPONSE_INVALID'));});response.on('error',()=>reject(fail('BUDGET_UNAVAILABLE')));response.on('end',()=>{try{const value=JSON.parse(text);response.statusCode===200?resolve(value):reject(fail(value.code));}catch{reject(fail('BUDGET_RESPONSE_INVALID'));}});
    });request.on('timeout',()=>request.destroy());request.on('error',()=>reject(fail('BUDGET_UNAVAILABLE')));request.end(body);
  });}
  async function perform(operation,bytes,work,{objectId,id=crypto.randomUUID(),provenance}={}){
    await call({action:'reserve',id,operation,bytes,...(objectId?{objectId}:{}),...(provenance?{provenance}:{})});
    await call({action:'STARTED',id});
    try{const value=await work();await call({action:'CONFIRMED',id});return value;}
    catch(error){await call({action:'UNCERTAIN',id}).catch(()=>{});throw error;}
  }
  return Object.freeze({call,perform,snapshot:()=>call({action:'snapshot'})});
}

module.exports={startCoordinator,createBudgetClient,replay,KEYS};
