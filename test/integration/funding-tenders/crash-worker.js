'use strict';
const {Pool}=require('../../../backend/node_modules/pg');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {createFundingWorker}=require('../../../backend/src/fundingTenders/worker');
const {createSource}=require('./v1FixtureFunder');
const {createPgBossQueueAdapter}=require('../../../backend/src/async/adapters/pgBossQueueAdapter');
async function main(){
 const target=new URL(process.env.FUNDING_TEST_DATABASE_URL);
 if(target.hostname!=='127.0.0.1'||target.port!=='5558'||target.pathname!=='/funding_fixture')throw Error('DISPOSABLE_REQUIRED');
 const pool=new Pool({connectionString:target.toString()}),repository=createFundingRepository({pool});
 const queue=await createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
 const source=createSource({fetchImpl:async()=>new Response(JSON.stringify({results:[1,2].map(n=>({content:`Crash fixture ${n}`,metadata:{identifier:[`CRASH-FT-${n}`],deadlineDate:['2099-12-31']}}))}))});
 const worker=createFundingWorker({pool,queue,source,repository:{...repository,async apply(run,item){if(item.external_identifier==='CRASH-FT-2'){process.send('FIRST_ITEM_COMMITTED');await new Promise(()=>{})}return repository.apply(run,item)}}});
 await worker.runOnce();
}
main().catch(()=>{process.exitCode=1;process.send?.('FAILED')});
