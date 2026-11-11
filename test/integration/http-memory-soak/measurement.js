'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {Client}=require('../../../backend/node_modules/pg');
const {createHash}=require('node:crypto');
function instrumentation(){
 const scope=new AsyncLocalStorage(),records=new Map(),original=Client.prototype.query;
 Client.prototype.query=function(...args){
  const current=scope.getStore(),sql=typeof args[0]==='string'?args[0]:args[0]?.text||'';
  if(!current)return original.apply(this,args);
  current.sqlCalls++;if(sql.startsWith('WITH names AS'))current.applicationSelections++;if(sql.includes('FROM organizational_scope.person p LEFT JOIN organizational_scope.person_profile'))current.peopleBatchSelections++;
  const login=this.connectionParameters.user,role=login==='c4g_authority_runtime'?'authority':login.startsWith('c4g_onb_api_')?'tenant':login.startsWith('c4g_catalog_')?'catalog':'central-reader';
  const category=sql.startsWith('SELECT authority_api.execute')?'authority-protocol':sql.startsWith('WITH names AS')?'application-selection':/pg_catalog|pg_roles|pg_class|pg_namespace|pg_proc|information_schema/.test(sql)?'metadata':/^(BEGIN|COMMIT|ROLLBACK|SET |RESET )/.test(sql)?'transaction':'other';
  const key=role+'/'+category;current.profile[key] ||= {calls:0,totalMs:0,maxMs:0};const p=current.profile[key];p.calls++;
  const start=performance.now(),finish=()=>{const ms=performance.now()-start;p.totalMs+=ms;p.maxMs=Math.max(p.maxMs,ms);if(ms>50)current.slow.push({role,category,ms:Math.round(ms),hash:createHash('sha256').update(sql).digest('hex').slice(0,16)});};
  if(typeof args.at(-1)==='function'){const callback=args.at(-1);args[args.length-1]=(...values)=>{finish();return callback(...values);};return original.apply(this,args);}
  const pending=original.apply(this,args);return pending.then(value=>{finish();return value;},error=>{finish();throw error;});
 };
 return {records,middleware(req,res,next){const id=req.get('X-HTTP-Proof-Measure');if(!id)return next();const record={sqlCalls:0,applicationSelections:0,peopleBatchSelections:0,profile:{},slow:[]};records.set(id,record);scope.run(record,next);},close(){Client.prototype.query=original;}};
}
const percentile=(xs,p)=>{const sorted=[...xs].sort((a,b)=>a-b);return Math.round(sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]*100)/100;};
async function measure({http,client,route,name,volume,people,samples,concurrency=4,report}){
 const warm=await http(client,route);
 if(warm.status!==200){const value={name,volume,people,samples:1,concurrency:1,warmupFailed:true,status:warm.status,code:warm.data?.error?.code||warm.code||null,ms:Math.round(warm.ms),sql:warm.sql};report.measurements.push(value);console.log('MEASURE_FAILED '+JSON.stringify({name,volume,status:warm.status,ms:value.ms,sqlCalls:warm.sql?.sqlCalls}));return [];}
 const results=[];let next=0;const start=performance.now();
 await Promise.all(Array.from({length:concurrency},async()=>{while(next<samples){next++;results.push(await http(client,route));}}));
 const good=results.filter(x=>x.status===200),counts=key=>results.map(x=>x.sql?.[key]||0);
 const value={name,volume,people,samples,concurrency,warmups:1,p50Ms:good.length?percentile(good.map(x=>x.ms),.5):null,p95Ms:good.length?percentile(good.map(x=>x.ms),.95):null,p99Ms:good.length?percentile(good.map(x=>x.ms),.99):null,errorP95Ms:good.length<results.length?percentile(results.filter(x=>x.status!==200).map(x=>x.ms),.95):null,elapsedMs:Math.round(performance.now()-start),errors:results.length-good.length,statuses:results.map(x=>x.status),payloadBytes:{min:Math.min(...good.map(x=>x.bytes)),max:Math.max(...good.map(x=>x.bytes))},sqlCalls:{min:Math.min(...counts('sqlCalls')),max:Math.max(...counts('sqlCalls'))},applicationSelections:counts('applicationSelections'),peopleBatchSelections:counts('peopleBatchSelections'),firstProfile:results[0].sql};
 value.successes=good.length;value.route=route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,':id');
 report.measurements.push(value);const {firstProfile,...summary}=value;console.log('MEASURE '+JSON.stringify(summary));
 return good;
}
module.exports={instrumentation,measure};
