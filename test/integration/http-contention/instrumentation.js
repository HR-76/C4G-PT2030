'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash}=require('node:crypto');
const {Client,Pool}=require('../../../backend/node_modules/pg');
const digest=sql=>createHash('sha256').update(sql).digest('hex').slice(0,16);
const round=x=>Math.round(x*100)/100;
function label(sql){
 if(sql==='SELECT pg_advisory_xact_lock(43001306,1)')return 'authority-lock';
 if(sql.startsWith('SELECT * FROM audit.prepare_append_v1'))return 'audit-prepare';
 if(sql.startsWith('SELECT * FROM audit.append_event_v1'))return 'audit-append';
 if(sql.startsWith('SELECT authority_api.execute'))return 'authority-protocol';
 if(sql.startsWith('WITH names AS'))return 'application-selection';
 if(/pg_catalog|pg_roles|pg_class|pg_namespace|pg_proc|information_schema/.test(sql))return 'metadata';
 if(/^(BEGIN|COMMIT|ROLLBACK|SET |RESET )/.test(sql))return 'transaction';
 return 'other';
}
function install(){
 const scope=new AsyncLocalStorage(),records=new Map(),pids=new Map(),managers=[],undo=[];
 const databaseNames=new Map(),queries=new Map();let sequence=0,phase='setup',samples=[];
 function role(user,database){
  if(user==='c4g_authority_runtime')return 'authority';
  if(user?.startsWith('c4g_onb_api_')){if(!databaseNames.has(database))databaseNames.set(database,'tenant-'+(databaseNames.size+1));return databaseNames.get(database);}
  if(user?.startsWith('c4g_catalog_'))return 'catalog';
  return 'central-reader';
 }
 function add(record,field,key,ms){const x=(record[field] ||= {})[key] ||= {calls:0,ms:0,maxMs:0};x.calls++;x.ms+=ms;x.maxMs=Math.max(x.maxMs,ms);}
 const originalQuery=Client.prototype.query;
 Client.prototype.query=function(...args){
  const record=scope.getStore()?.record,sql=typeof args[0]==='string'?args[0]:args[0]?.text||'';
  if(!record)return originalQuery.apply(this,args);
  const category=label(sql),hash=digest(sql),who=role(this.connectionParameters.user,this.connectionParameters.database),start=performance.now();
  if(!queries.has(hash))queries.set(hash,{hash,category,caller:String(new Error().stack).split('\n').map(s=>s.trim()).filter(s=>s.includes('backend')&&s.includes('src')).slice(0,3)});
  const info=pids.get(this.processID)||{role:who};info.record=record.id;info.last={hash,category};pids.set(this.processID,info);
  record.queryCount++;if(category==='authority-lock')record.authorityTransactions++;
  const finish=error=>{
   const end=performance.now(),ms=end-start;add(record,'queries',who+'/'+category,ms);add(record,'queryHashes',hash,ms);
   if(record.responseAt!==undefined)add(record,'afterResponseQueries',who+'/'+category,ms);
   if(error)record.sqlErrors.push({code:error.code||error.name,category,hash});
   if(category==='authority-lock'&&!error)info.centralLockedAt=end;
   if(category==='audit-prepare'&&!error&&info.auditLockedAt===undefined)info.auditLockedAt=end;
   if(/^(COMMIT|ROLLBACK)/.test(sql)){
    if(info.centralLockedAt!==undefined){add(record,'locks','central-held',end-info.centralLockedAt);delete info.centralLockedAt;}
    if(info.auditLockedAt!==undefined){add(record,'locks','audit-held',end-info.auditLockedAt);delete info.auditLockedAt;}
   }
  };
  if(typeof args.at(-1)==='function'){const callback=args.at(-1);args[args.length-1]=(error,...values)=>{finish(error);callback(error,...values);};return originalQuery.apply(this,args);}
  try{return originalQuery.apply(this,args).then(value=>{finish();return value;},error=>{finish(error);throw error;});}
  catch(error){finish(error);throw error;}
 };
 undo.push(()=>{Client.prototype.query=originalQuery;});
 const originalConnect=Pool.prototype.connect;
 Pool.prototype.connect=function(callback){
  const record=scope.getStore()?.record;if(!record)return originalConnect.call(this,callback);
  const start=performance.now(),entry={waitMs:null,holdMs:null,max:this.options.max,total:this.totalCount,idle:this.idleCount,waiting:this.waitingCount};
  record.checkouts.push(entry);
  const connected=client=>{
   entry.waitMs=round(performance.now()-start);entry.role=role(client.connectionParameters.user,client.connectionParameters.database);
   const acquired=performance.now(),release=client.release;let released=false;
   client.release=(...args)=>{if(!released){released=true;entry.holdMs=round(performance.now()-acquired);entry.discard=Boolean(args[0]);}return release.apply(client,args);};
   return client;
  };
  const failed=error=>{entry.waitMs=round(performance.now()-start);entry.error=error.code||error.name;};
  if(callback)return originalConnect.call(this,(error,client)=>{if(error){failed(error);return callback(error);}connected(client);return callback(null,client,client.release);});
  return originalConnect.call(this).then(connected,error=>{failed(error);throw error;});
 };
 undo.push(()=>{Pool.prototype.connect=originalConnect;});
 for(const [file,names] of [
  ['authoritySecurityManifest',['assertAuthorityAdmission','assertAuthoritySecurity']],
  ['centralSchemaManifest',['assertCentralSchema']],['tenantRuntimeMetadata',['observeTenantRuntimeMetadata']]
 ]){
  const module=require('../../../backend/src/security/'+file);
  for(const name of names){const original=module[name];module[name]=async function(...args){
   const record=scope.getStore()?.record;if(!record)return original.apply(this,args);
   const start=performance.now();try{return await original.apply(this,args);}finally{add(record,'spans',name,performance.now()-start);}
  };undo.push(()=>{module[name]=original;});}
 }
 const managerModule=require('../../../backend/src/security/tenantPoolManager'),originalManager=managerModule.createTenantPoolManager;
 managerModule.createTenantPoolManager=options=>{
  const original=originalManager(options);
  const manager=Object.freeze({...original,acquire(...args){
   const record=scope.getStore()?.record,start=performance.now();
   const entry={before:original.snapshot()};if(record)(record.admissions ||= []).push(entry);
   return original.acquire(...args).then(allocation=>{
    entry.ms=round(performance.now()-start);entry.after=original.snapshot();entry.leaseRemainingMs=allocation.deadline-Date.now();return allocation;
   },error=>{entry.ms=round(performance.now()-start);entry.after=original.snapshot();entry.error=error.internalCode||error.code||error.name;throw error;});
  }});
  managers.push({manager,policy:{...options.policy}});return manager;
 };
 undo.push(()=>{managerModule.createTenantPoolManager=originalManager;});
 let sampling=false,timer,observer;
 async function sample(){
  if(sampling||!observer||phase==='setup')return;sampling=true;const start=performance.now();
  try{
   const {rows}=await observer.query(`SELECT pid,usename,datname,state,wait_event_type,wait_event,query,
    pg_blocking_pids(pid) AS blockers,EXTRACT(EPOCH FROM(clock_timestamp()-xact_start))*1000 AS transaction_ms
    FROM pg_stat_activity WHERE usename='c4g_authority_runtime' OR usename LIKE 'c4g_onb_api_%'`);
   samples.push({phase,at:Date.now(),sampleMs:round(performance.now()-start),managers:managers.map(({manager})=>manager.snapshot()),
    sessions:rows.map(row=>({pid:row.pid,role:role(row.usename,row.datname),state:row.state,waitType:row.wait_event_type,wait:row.wait_event,
     blockers:row.blockers,transactionMs:round(Number(row.transaction_ms||0)),query:label(row.query||''),hash:digest(row.query||''),request:pids.get(row.pid)?.record||null}))});
  }finally{sampling=false;}
 }
 return {
  records,managers,
  middleware(req,res,next){
   const tag=req.get('X-Contention-Request');if(!tag)return next();
   const record={id:++sequence,tag,phase,queryCount:0,authorityTransactions:0,checkouts:[],sqlErrors:[],failures:[]};records.set(tag,record);
   res.once('finish',()=>{record.responseAt=performance.now();});
   scope.run({record},next);
  },
  failure(error){const record=scope.getStore()?.record;const value={code:error.internalCode||error.code||error.name};if(record)record.failures.push(value);},
  async startSampling(pool){observer=pool;timer=setInterval(()=>sample().catch(()=>{}),100);},
  setPhase(value){phase=value;},
  take(tag){const value=records.get(tag);records.delete(tag);return value;},
  evidence(){return {queries:[...queries.values()],policies:managers.map(m=>m.policy),samples};},
  async close(){clearInterval(timer);while(sampling)await new Promise(r=>setTimeout(r,10));undo.reverse().forEach(fn=>fn());}
 };
}
module.exports={install,label};
