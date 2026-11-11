'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeCode=error=>/^[A-Z0-9_]+$/.test(error?.internalCode||error?.code||'')?(error.internalCode||error.code):'OBSERVED_ERROR';
function category(sql){
 if(sql==='SELECT pg_advisory_xact_lock(43001306,1)')return 'authority-lock';
 if(sql.startsWith('SELECT * FROM audit.prepare_append_v1'))return 'audit-prepare';
 if(/pg_catalog|pg_roles|pg_class|pg_namespace|pg_proc|information_schema|c4g_system\.runtime_metadata_v1/.test(sql))return 'metadata';
 if(/^(BEGIN|COMMIT|ROLLBACK|SET |RESET )/.test(sql))return 'transaction';
 return 'other';
}
function observe(value,finish){if(value&&typeof value.then==='function')value.then(()=>finish(),error=>finish(error)).catch(()=>{});return value;}
function install({pg=require('../../../backend/node_modules/pg'),load=name=>require('../../../backend/src/security/'+name)}={}){
 const {Client,Pool}=pg,scope=new AsyncLocalStorage(),records=new Map(),managers=[],undo=[],samples=[],samplerErrors=[];
 let phase='functional',timer,pendingSample=false,closed=false;
 const who=client=>client.connectionParameters?.user==='c4g_authority_runtime'?'authority':client.connectionParameters?.user?.startsWith('c4g_onb_api_')?'tenant':client.connectionParameters?.user?.startsWith('c4g_catalog_')?'catalog':'central';
 function begin(tag){const record={tag,phase,start:performance.now(),queryCount:0,transactionCount:0,queryEvents:[],checkouts:[],admissions:[],spans:[],sqlErrors:[],failures:[],lockEvents:[],pendingQueries:0};records.set(tag,record);return record;}
 const originalQuery=Client.prototype.query;
 Client.prototype.query=function(...args){
  const record=scope.getStore();if(!record)return originalQuery.apply(this,args);
  const sql=typeof args[0]==='string'?args[0]:args[0]?.text||'',kind=category(sql),start=performance.now();
  const event={startMs:start-record.start,endMs:null,role:who(this),category:kind,hash:hash(sql),afterResponse:false};record.queryEvents.push(event);record.queryCount++;record.pendingQueries++;
  if(/^BEGIN/.test(sql))record.transactionCount++;
  let finished=false;const finish=error=>{if(finished)return;finished=true;const end=performance.now();event.endMs=end-record.start;event.afterResponse=record.responseAt!==undefined&&end>record.responseAt;record.pendingQueries--;if(error)record.sqlErrors.push({code:safeCode(error),hash:event.hash});
   if(kind==='authority-lock'&&!error)this.__euTrialLock={record,start:end};
   if(/^(COMMIT|ROLLBACK)/.test(sql)&&this.__euTrialLock){const lock=this.__euTrialLock;lock.record.lockEvents.push({kind:'authority-held',startMs:lock.start-lock.record.start,endMs:end-lock.record.start});delete this.__euTrialLock;}
  };
  if(typeof args.at(-1)==='function'){const cb=args.at(-1);args[args.length-1]=function(error,...values){finish(error);return cb.call(this,error,...values);};}
  try{return observe(originalQuery.apply(this,args),finish);}catch(error){finish(error);throw error;}
 };undo.push(()=>{Client.prototype.query=originalQuery;});
 const originalConnect=Pool.prototype.connect;
 Pool.prototype.connect=function(...args){
  const record=scope.getStore();if(!record)return originalConnect.apply(this,args);
  const start=performance.now(),entry={startMs:start-record.start,waitMs:null,holdMs:null,max:this.options?.max??null};record.checkouts.push(entry);
  const failed=error=>{entry.waitMs=performance.now()-start;entry.error=safeCode(error);};
  const connected=client=>{if(!client)return;entry.waitMs=performance.now()-start;entry.role=who(client);const acquired=performance.now(),release=client.release;let released=false;client.release=function(...values){if(!released){released=true;entry.holdMs=performance.now()-acquired;}return release.apply(this,values);};};
  if(typeof args[0]==='function'){const cb=args[0];args[0]=function(error,client){if(error)failed(error);else connected(client);return cb.call(this,error,client,client?.release);};return originalConnect.apply(this,args);}
  try{const result=originalConnect.apply(this,args);result.then(connected,failed).catch(()=>{});return result;}catch(error){failed(error);throw error;}
 };undo.push(()=>{Pool.prototype.connect=originalConnect;});
 for(const [file,names] of [['centralSchemaManifest',['assertCentralSchema','assertCentralSchemaForVersions']],['authoritySecurityManifest',['assertAuthorityAdmission','assertAuthoritySecurity']],['tenantRuntimeMetadata',['observeTenantRuntimeMetadata']]]){
  const module=load(file);for(const name of names){const original=module[name];if(typeof original!=='function')continue;module[name]=function(...args){const record=scope.getStore();if(!record)return original.apply(this,args);const entry={name,startMs:performance.now()-record.start,endMs:null};record.spans.push(entry);const finish=()=>{entry.endMs=performance.now()-record.start;};try{return observe(original.apply(this,args),finish);}catch(error){finish();throw error;}};undo.push(()=>{module[name]=original;});}
 }
 const managerModule=load('tenantPoolManager'),originalFactory=managerModule.createTenantPoolManager;
 if(originalFactory){managerModule.createTenantPoolManager=function(...args){const manager=originalFactory.apply(this,args);managers.push(manager);return Object.freeze({...manager,acquire(...values){const record=scope.getStore(),start=performance.now();if(!record)return manager.acquire(...values);const entry={before:manager.snapshot(),ms:null,after:null};record.admissions.push(entry);try{const result=manager.acquire(...values);result.then(()=>{entry.ms=performance.now()-start;entry.after=manager.snapshot();},error=>{entry.ms=performance.now()-start;entry.after=manager.snapshot();entry.error=safeCode(error);}).catch(()=>{});return result;}catch(error){entry.ms=performance.now()-start;entry.error=safeCode(error);throw error;}}});};undo.push(()=>{managerModule.createTenantPoolManager=originalFactory;});}
 async function sample(pool){if(pendingSample||closed)return;pendingSample=true;const start=performance.now();try{
  const {rows}=await pool.query("SELECT state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,EXTRACT(EPOCH FROM(clock_timestamp()-xact_start))*1000 AS transaction_ms FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()");
  samples.push({phase,at:new Date().toISOString(),sampleMs:performance.now()-start,cpu:process.cpuUsage(),memory:process.memoryUsage(),managers:managers.map(m=>m.snapshot()),sessions:rows.map(r=>({state:r.state,waitType:r.wait_event_type,wait:r.wait_event,blockingCount:r.blockers.length,transactionMs:r.transaction_ms===null?null:Number(r.transaction_ms)}))});
 }catch(error){samplerErrors.push({code:safeCode(error)});}finally{pendingSample=false;}}
 return {begin,records,managers,withRecord:(record,work)=>scope.run(record,work),
  middleware(req,res,next){const tag=req.get('X-EU-Trial-Request');if(!tag)return next();const record=begin(tag);res.once('finish',()=>{record.responseAt=performance.now();});scope.run(record,next);},
  failure(error){scope.getStore()?.failures.push({code:safeCode(error)});},
  take:tag=>records.get(tag),setPhase:value=>{phase=value;},
  async startSampling(pool){await sample(pool);timer=setInterval(()=>{void sample(pool);},100);},
  async drain(limitMs=30000){const start=performance.now();for(;;){const states=managers.map(m=>m.snapshot());if(states.some(s=>s.credentialCleanupFailures||s.credentialCleanupTimeouts||s.cleanupFailures))throw Object.assign(Error('DRAIN_CLEANUP_FAILED'),{code:'DRAIN_CLEANUP_FAILED'});const busy=[...records.values()].some(r=>r.pendingQueries||r.checkouts.some(c=>!c.error&&c.holdMs===null))||states.some(s=>s.active||s.queued||s.credentialDisposalsPending);if(!busy)return performance.now()-start;if(performance.now()-start>limitMs)throw Object.assign(Error('DRAIN_TIMEOUT'),{code:'DRAIN_TIMEOUT'});await new Promise(r=>setTimeout(r,20));}},
  evidence(){return {samplerIntervalMs:100,samples,samplerErrors,managerCount:managers.length};},
  async close(){closed=true;clearInterval(timer);const until=performance.now()+120000;try{while(pendingSample){if(performance.now()>=until)throw Object.assign(Error('SAMPLER_CLEANUP_DEADLINE'),{code:'SAMPLER_CLEANUP_DEADLINE'});await new Promise(r=>setTimeout(r,10));}}finally{undo.reverse().forEach(fn=>fn());}}
 };
}
module.exports={install,category,safeCode};
