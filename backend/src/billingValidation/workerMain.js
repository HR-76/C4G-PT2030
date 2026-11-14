 'use strict';
// Separate process and database login; never run delivery work inside the HTTP API.
const {Pool}=require('pg');
const {createValidationTransport,createValidationWorker}=require('./worker');
async function start({env=process.env}={}) {
 if(!env.BILLING_VALIDATION_DATABASE_URL)throw Error('BILLING_WORKER_DATABASE_REQUIRED');
 const send=createValidationTransport({apiKey:env.RESEND_API_KEY,from:env.BILLING_EMAIL_FROM,origin:env.PUBLIC_APP_URL});
 const pool=new Pool({connectionString:env.BILLING_VALIDATION_DATABASE_URL,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});
 try {
  const result=await pool.query("SELECT NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND pg_has_role(current_user,'c4g_billing_validation_worker','member') AND NOT pg_has_role(current_user,'c4g_central_runtime','member') AND NOT pg_has_role(current_user,'c4g_authority_owner','member') AS allowed FROM pg_roles WHERE rolname=current_user");
  if(result.rows[0]?.allowed!==true)throw Error('BILLING_WORKER_ROLE_REQUIRED');
 }catch(error){await pool.end();throw error}
 const worker=createValidationWorker({pool,send});
 let stopped=false,timer=null,inflight=Promise.resolve();
 const schedule=()=>{if(!stopped)timer=setTimeout(()=>{inflight=loop()},5000)};
 async function loop(){try{for(let n=0;n<20&&!stopped;n++){if(!await worker.tick())break}}catch{process.stderr.write('BILLING_VALIDATION_DELIVERY_RETRY\n')}finally{schedule()}}
 schedule();
 return {async close(){stopped=true;clearTimeout(timer);await inflight;await pool.end()}};
}
if(require.main===module)start().then(runtime=>{
 const stop=()=>runtime.close().catch(()=>{process.exitCode=1});
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}).catch(()=>{process.stderr.write('BILLING_VALIDATION_WORKER_UNAVAILABLE\n');process.exitCode=1});
module.exports={start};
