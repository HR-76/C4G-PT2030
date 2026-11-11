'use strict';
const pg=require('../../../backend/node_modules/pg');
const decorated=new WeakSet();
function decorate(client){if(decorated.has(client))return client;decorated.add(client);let lineMutation=false;
 const query=client.query.bind(client);
 async function after(sql,result){
  if(/^\s*ROLLBACK\s*$/i.test(sql)){lineMutation=false;return result;}
  if(/^\s*COMMIT\s*$/i.test(sql)){
   const inject=lineMutation;lineMutation=false;
   if(!inject)return result;
   const present=await query("SELECT to_regclass('public.c4g_f12_fault') IS NOT NULL AS present");
   if(present.rows[0]?.present){const injected=await query("DELETE FROM public.c4g_f12_fault WHERE code='COMMIT_UNCERTAIN' RETURNING code");if(injected.rowCount){const error=new Error('TEST_COMMIT_ACK_LOST');error.code='COMMIT_UNCERTAIN';throw error;}}
  }
  return result;
 }
 client.query=function(...args){
  const statement=args[0],callback=typeof args.at(-1)==='function'?args.at(-1):null;
  const sql=typeof statement==='string'?statement:statement?.text||'';
  if(sql.includes('INSERT INTO opportunity_catalog.import_row_outcome'))lineMutation=true;
  if(callback){args[args.length-1]=(error,result)=>{if(error)return callback(error,result);after(sql,result).then(value=>callback(null,value),failure=>callback(failure));};return query(...args);}
  return query(...args).then(result=>after(sql,result));
 };
 return client;
}
function tenant(client){return client?.database?.startsWith('c4g_f12_import_')?decorate(client):client;}
function install(Pool){const original=Pool.prototype.connect;function patched(...args){const callback=typeof args.at(-1)==='function'?args.at(-1):null;if(callback){args[args.length-1]=(error,client,done)=>callback(error,error?client:tenant(client),done);return original.apply(this,args);}return original.apply(this,args).then(tenant);}Pool.prototype.connect=patched;return()=>{if(Pool.prototype.connect===patched)Pool.prototype.connect=original;};}
if(process.env.F12_IMPORT_ENABLE_COMMIT_HOOK==='1'){
 install(pg.Pool);
}
module.exports={decorate,install};
