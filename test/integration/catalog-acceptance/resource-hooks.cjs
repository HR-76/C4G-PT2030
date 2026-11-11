'use strict';
function category(sql){
 const q=typeof sql==='string'?sql:sql?.text||'';
 if(q.includes('AS "tables"'))return 'core_schema';
 if(q.includes('WITH authority_roles AS MATERIALIZED'))return 'authority_acl';
 if(q.includes('AS "relations"'))return 'projection_schema';
 if(q.includes('pg_advisory_xact_lock'))return q.includes('lock_shared')?'shared_lock':'exclusive_lock';
 if(q.includes('server_version_num'))return 'server_version';
 if(q.includes('AS "authorityParents"'))return 'reader_guards';
 if(q.includes('THEN json_build_object(\'roles\''))return 'catalog_reader_acl';
 if(q.includes('pg_stat_statements')||q.includes('pg_stat_activity'))return 'observer';
 if(q.includes('gcni_catalog_control_rehearsal'))return 'exposure_policy';
 if(q.includes('catalog_read.published_projection'))return 'projection_data';
 if(q.includes('catalog_read.published_generation')||q.includes('catalog_read.current_generation'))return 'generation_header';
 if(q.includes('c4g_schema_migration'))return 'migration_ledger';
 if(q.includes('c4g_database_identity'))return 'central_marker';
 if(q.includes('application_session_store'))return q.includes('organization_membership')?'membership_authority':'session_store';
 if(q.includes('application_session')||q.includes('organization_membership'))return 'session_authority';
 if(/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SET|RESET)|SELECT set_config/i.test(q))return 'transaction_control';
 if(q.includes('pg_roles')||q.includes('pg_auth_members')||q.includes('has_table_privilege'))return 'identity_privileges';
 if(q.includes('authority_api'))return 'authority_protocol';
 return 'other';
}
function poolLabel(pool){let user=pool.options?.user;try{if(!user&&pool.options?.connectionString)user=new URL(pool.options.connectionString).username;}catch{}return ({gcni_acceptance_reader:'catalog',gcni_acceptance_authority:'membership',c4g_authority_runtime:'session_authority',gcni_oidc_policy_reader:'policy_reader',gcni_oidc_policy_operator:'policy_operator'})[user]||'central_or_other';}
function install({Pool,Client,session}){
 let current=null,touches=0;const ignored=new WeakSet();const connect=Pool.prototype.connect,query=Client.prototype.query,coordinate=session.coordinateSessionStore;
 function record(w,kind,label,ms,error=false){if(!w)return;const key=kind+':'+label,s=w.metrics[key]??={count:0,totalMs:0,maxMs:0,errors:0,samplesMs:[]};s.count++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);if(error)s.errors++;if(s.samplesMs.length<30000)s.samplesMs.push(ms);else w.dropped++;}
 Client.prototype.query=function(...args){
  const w=current;if(!w||ignored.has(this))return query.apply(this,args);
  const label=category(args[0]),start=performance.now();w.pending++;let done=false;
  const finish=error=>{if(done)return;done=true;w.pending--;record(w,'query',label,performance.now()-start,Boolean(error));};
  const index=typeof args.at(-1)==='function'?args.length-1:-1;
  if(index>=0){const cb=args[index];args[index]=function(error,...values){finish(error);return cb.call(this,error,...values);};}
  else if(args[0]?.callback){const cb=args[0].callback;args[0]={...args[0],callback:function(error,...values){finish(error);return cb.call(this,error,...values);}};}
  try{const result=query.apply(this,args);if(index<0&&!args[0]?.callback){if(result?.then)return result.then(value=>{finish();return value;},error=>{finish(error);throw error;});w.unsupported++;finish();}return result;}catch(error){finish(error);throw error;}
 };
 Pool.prototype.connect=function(...args){
  const w=current;if(!w)return connect.apply(this,args);const label=poolLabel(this),start=performance.now();w.pending++;
  let settled=false;const acquired=(error,client,release)=>{if(settled)return null;settled=true;w.pending--;record(w,'pool_wait',label,performance.now()-start,Boolean(error));if(error)return null;const at=performance.now();w.leases++;const original=release||client.release;let done=false;const wrapped=function(...values){if(!done){done=true;w.leases--;record(w,'pool_hold',label,performance.now()-at);}return original.apply(this,values);};client.release=wrapped;return wrapped;};
  if(typeof args[0]==='function'){const cb=args[0];args[0]=function(error,client,release){const wrapped=acquired(error,client,release);return cb.call(this,error,client,wrapped||release);};try{return connect.apply(this,args);}catch(error){acquired(error);throw error;}}
  try{return connect.apply(this,args).then(client=>{acquired(null,client);return client;},error=>{acquired(error);throw error;});}catch(error){acquired(error);throw error;}
 };
 session.coordinateSessionStore=function(...args){const store=coordinate(...args),touch=store.touch;store.touch=function(...values){touches++;const cb=typeof values.at(-1)==='function'?values.pop():null;let done=false;const finish=()=>{if(!done){done=true;touches--;}};const complete=function(...result){finish();return cb.apply(this,result);};try{if(cb)return touch.call(this,...values,complete);const result=touch.apply(this,values);if(result?.then)return result.then(value=>{finish();return value;},error=>{finish();throw error;});finish();return result;}catch(error){finish();throw error;}};return store;};
 return {ignore(client){ignored.add(client);},start(){if(current)throw Error('PROFILE_ALREADY_ACTIVE');current={metrics:{},pending:0,leases:0,dropped:0,unsupported:0};return current;},get touches(){return touches;},get pending(){return (current?.pending||0)+(current?.leases||0)+touches;},finish(){if(!current||this.pending)throw Error('PROFILE_NOT_SETTLED');const result=current;current=null;return result;},restore(){if(current||touches)throw Error('PROFILE_NOT_SETTLED');Pool.prototype.connect=connect;Client.prototype.query=query;session.coordinateSessionStore=coordinate;}};
}
module.exports={install,category,poolLabel};
