'use strict';
// Diagnostic-only common adapter. It observes the original return value before
// readiness assertions, never validates payloads, retries or changes HTTP work.
const states=new WeakMap();
const KINDS=Object.freeze(['report','dashboard','private','report-cursor','private-item','unknown']);
const ROLES=new Set(['authority','tenant','catalog','central']);
const CATEGORIES=new Set(['authority-lock','audit-prepare','metadata','transaction','other']);
const SPANS=new Set(['assertCentralSchema','assertCentralSchemaForVersions','assertAuthorityAdmission','assertAuthoritySecurity','observeTenantRuntimeMetadata']);
const COUNTERS=['active','queued','pools','tenants','circuitsOpen','credentialDisposalsPending','credentialCleanupTimeouts','credentialCleanupFailures','cleanupFailures'];
// Explicit technical vocabulary, not an uppercase pattern: an arbitrary token
// could itself match that pattern. Unknown codes lose their text in diagnostics.
const CODES=new Set([
 'OBSERVED_ERROR','SERVICE_UNAVAILABLE','AUTHENTICATION_REQUIRED','AUTHORIZATION_REQUIRED','FORBIDDEN','NOT_FOUND','RESOURCE_NOT_AVAILABLE','OPPORTUNITY_NOT_FOUND','INVALID_CURSOR',
 'HTTP_TIMEOUT','HTTP_TRANSPORT_FAILURE','DRAIN_TIMEOUT','DRAIN_CLEANUP_FAILED','CONTROL_DEADLINE_EXCEEDED','OPERATION_ABORTED','LEASE_TIMEOUT','LEASE_NOT_ACTIVE','LEASE_NOT_FOUND','ACQUIRE_TIMEOUT','POOL_CLOSED',
 'TENANT_UNREACHABLE','TENANT_NOT_AVAILABLE','PHYSICAL_TENANT_MISMATCH','F4_METADATA_DRIFT','F4_METADATA_INVALID','F4_METADATA_ROLE_INVALID','F4_METADATA_ROLE_RESTORE_FAILED',
 'TENANT_SCHEMA_FINGERPRINT_MISMATCH','TENANT_PREFLIGHT_FAILED','DATABASE_CONFIGURATION_MISMATCH','AUTHORITY_SECURITY_DRIFT','AUTHORITY_ADMISSION_FAILED','AUTHORITY_UNAVAILABLE','AUTHORITY_BINDING_INVALID','AUTHORITY_GUARD_REQUIRED',
 'RESULT_LIMIT_EXCEEDED','RESULT_CONTRACT_MISMATCH','TRANSACTION_BOUNDARY_VIOLATION','MEMBERSHIP_NOT_ACTIVE','MEMBERSHIP_STALE','DIRECTORY_STALE','CREDENTIAL_CLEANUP_TIMEOUT','SAMPLER_CLEANUP_DEADLINE',
 'EIO','EACCES','EPERM','ENOSPC','ENOENT','ECONNRESET','ECONNREFUSED','ETIMEDOUT',
 // Known PostgreSQL SQLSTATE values; no generic alphanumeric allowance.
 '08000','08001','08003','08004','08006','08007','08P01','22001','22003','22007','22008','22P02','23502','23503','23505','23514','23P01',
 '25000','25001','25006','25P02','40001','40P01','42501','42601','42703','42704','42883','42P01','42P07','53000','53100','53200','53300','53400','54000','55000','55P03','57014','57P01','57P02','57P03','58000','58030','P0001','P0002','P0003','XX000','XX001','XX002'
]);
function own(object,key){
 if(object===null||!['object','function'].includes(typeof object))return undefined;
 try{const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;}catch{return undefined;}
}
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const code=value=>CODES.has(value)?value:null;
const errorCode=error=>code(own(error,'internalCode'))||code(own(error,'code'))||'OBSERVED_ERROR';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
const member=(set,value)=>set.has(value)?value:null;
const rows=(value,project)=>Array.isArray(value)?value.map(project):null;
function manager(value){
 if(value===null||typeof value!=='object')return null;
 return Object.fromEntries(COUNTERS.map(key=>[key,integer(own(value,key))]));
}
function projectMetrics(value){
 if(value===null||typeof value!=='object')return null;
 return {
  start:number(own(value,'start')),responseAt:number(own(value,'responseAt')),
  queryCount:integer(own(value,'queryCount')),transactionCount:integer(own(value,'transactionCount')),pendingQueries:integer(own(value,'pendingQueries')),
  queryEvents:rows(own(value,'queryEvents'),row=>({hash:hash(own(row,'hash')),role:member(ROLES,own(row,'role')),category:member(CATEGORIES,own(row,'category')),startMs:number(own(row,'startMs')),endMs:number(own(row,'endMs')),afterResponse:typeof own(row,'afterResponse')==='boolean'?own(row,'afterResponse'):null})),
  checkouts:rows(own(value,'checkouts'),row=>({startMs:number(own(row,'startMs')),waitMs:number(own(row,'waitMs')),holdMs:number(own(row,'holdMs')),max:integer(own(row,'max')),role:member(ROLES,own(row,'role')),...(own(row,'error')!==undefined?{error:code(own(row,'error'))||'OBSERVED_ERROR'}:{})})),
  admissions:rows(own(value,'admissions'),row=>({ms:number(own(row,'ms')),before:manager(own(row,'before')),after:manager(own(row,'after')),...(own(row,'error')!==undefined?{error:code(own(row,'error'))||'OBSERVED_ERROR'}:{})})),
  spans:rows(own(value,'spans'),row=>({name:member(SPANS,own(row,'name')),startMs:number(own(row,'startMs')),endMs:number(own(row,'endMs'))})),
  sqlErrors:rows(own(value,'sqlErrors'),row=>({code:code(own(row,'code'))||'OBSERVED_ERROR',hash:hash(own(row,'hash'))})),
  failures:rows(own(value,'failures'),row=>({code:code(own(row,'code'))||'OBSERVED_ERROR'})),
  lockEvents:rows(own(value,'lockEvents'),row=>({kind:own(row,'kind')==='authority-held'?'authority-held':null,startMs:number(own(row,'startMs')),endMs:number(own(row,'endMs'))}))
 };
}
function routeKind(value){
 if(['report','dashboard','private'].includes(value))return value;
 if(typeof value!=='string')return 'unknown';
 if(/^\/api\/applications\/report\?cursor=/.test(value))return 'report-cursor';
 if(value==='/api/applications/report')return 'report';
 if(value==='/api/opportunities')return 'private';
 if(/^\/api\/opportunities\/[^/?#]+(?:\?[^#]*)?$/.test(value))return 'private-item';
 if(/^\/api\/organizations\/[^/?#]+\/dashboard\/summary(?:\?[^#]*)?$/.test(value))return 'dashboard';
 return 'unknown';
}
function snapshotState(state){
 return {schemaVersion:1,attempts:state.attempts.map(row=>({index:row.index,tenant:row.tenant,kind:row.kind,anonymous:row.anonymous,resolved:row.resolved,status:row.status,ms:row.ms,code:row.code,metrics:projectMetrics(row.metricsRef)})),
  drains:state.drains.map(row=>({index:row.index,limitMs:row.limitMs,resolved:row.resolved,ms:row.ms,code:row.code})),observerErrors:state.observerErrors.map(row=>({code:row.code}))};
}
function snapshotReadiness(report){
 const state=states.get(report);if(!state)throw Object.assign(Error('READINESS_OBSERVER_REQUIRED'),{code:'READINESS_OBSERVER_REQUIRED'});
 return snapshotState(state);
}
function observeReadiness(http,{report,onProgress=()=>{}}={}){
 if(!http||!['request','anonymousRequest','drain'].every(name=>typeof http[name]==='function')||!report||typeof report!=='object'||typeof onProgress!=='function')throw Object.assign(Error('READINESS_OBSERVER_ARGUMENTS_INVALID'),{code:'READINESS_OBSERVER_ARGUMENTS_INVALID'});
 if(states.has(report)||Object.hasOwn(report,'httpReadinessObserved'))throw Object.assign(Error('READINESS_OBSERVER_ALREADY_REGISTERED'),{code:'READINESS_OBSERVER_ALREADY_REGISTERED'});
 const state={attempts:[],drains:[],observerErrors:[]};states.set(report,state);
 Object.defineProperty(report,'httpReadinessObserved',{enumerable:true,configurable:false,get:()=>snapshotState(state)});
 const observerFailure=error=>state.observerErrors.push({code:errorCode(error)});
 function notify(event,index){
  try{const returned=onProgress({event,index});if(returned&&typeof returned.then==='function')returned.then(undefined,observerFailure);}catch(error){observerFailure(error);}
 }
 function forward(name,args,row,event){
  function resolved(value){
   row.resolved=true;
   if(event==='attempt'){
    const status=own(value,'status');row.status=Number.isInteger(status)&&status>=0&&status<=599?status:null;row.ms=number(own(value,'ms'));
    row.code=code(own(own(own(value,'data'),'error'),'code'))||code(own(value,'code'));
    // Keep only the instrumentation reference. Request/response bodies, options,
    // URLs, headers and tags are never retained. Project metrics only on save.
    row.metricsRef=own(value,'metrics');
   }else row.ms=number(value);
   notify(event,row.index);
  }
  function rejected(error){row.resolved=false;row.code=errorCode(error);notify(event,row.index);}
  let returned;
  try{returned=Reflect.apply(Reflect.get(http,name,http),http,args);}catch(error){rejected(error);throw error;}
  if(returned&&typeof returned.then==='function'){
   // Attach first, then return the very same promise: the observation runs before
   // the caller's await continuation, including its first failing assertion.
   returned.then(resolved,rejected).catch(observerFailure);
  }else resolved(returned);
  return returned;
 }
 const wrapped={
  request(...args){const row={index:state.attempts.length,tenant:[0,1].includes(args[0])?args[0]:null,kind:routeKind(args[1]),anonymous:false,resolved:null,status:null,ms:null,code:null};state.attempts.push(row);return forward('request',args,row,'attempt');},
  anonymousRequest(...args){const row={index:state.attempts.length,tenant:null,kind:routeKind(args[0]),anonymous:true,resolved:null,status:null,ms:null,code:null};state.attempts.push(row);return forward('anonymousRequest',args,row,'attempt');},
  drain(...args){const row={index:state.drains.length,limitMs:number(args[0]),resolved:null,ms:null,code:null};state.drains.push(row);return forward('drain',args,row,'drain');}
 };
 const bound=new Map();
 // A separate facade also supports frozen harness objects; proxying such an
 // object directly would violate invariants for its read-only method values.
 return new Proxy(Object.create(null),{get(_target,key){
  if(Object.hasOwn(wrapped,key))return wrapped[key];
  const value=Reflect.get(http,key,http);if(typeof value!=='function')return value;
  if(!bound.has(value))bound.set(value,value.bind(http));return bound.get(value);
 },has(_target,key){return key in http;},ownKeys(){return Reflect.ownKeys(http);},getOwnPropertyDescriptor(_target,key){const descriptor=Reflect.getOwnPropertyDescriptor(http,key);return descriptor?{configurable:true,enumerable:descriptor.enumerable,get:()=>Reflect.get(http,key,http)}:undefined;}});
}
module.exports={observeReadiness,snapshotReadiness,KINDS};
