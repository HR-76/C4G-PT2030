'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const profile=require('../src/security/documentQueueProfile');
const {createPgBossQueueAdapter}=require('../src/async/adapters/pgBossQueueAdapter');

test('queue adapter selects its explicit limited role without runtime schema installation',async()=>{
 let config,starts=0,stops=0;
 class Boss {constructor(value){config=value;} async start(){starts++;} async stop(){stops++;}}
 const adapter=await createPgBossQueueAdapter({connectionString:'postgresql://synthetic.invalid/queue',options:profile.options,queueMap:{'document.scan':'c4g.document.scan'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:45}),load:async()=>({PgBoss:Boss})});
 assert.equal(config.options,'-c role=c4g_document_queue_runtime');
 for(const key of ['createSchema','migrate','supervise','schedule'])assert.equal(config[key],false);
 assert.equal(starts,1);await adapter.shutdown();assert.equal(stops,1);
});
test('queue profile refuses incompatible schemas and workloads instead of granting broader rights',async()=>{
 const rows=profile.QUEUES.map(name=>({name,table_name:'job_common',partition:false,dead_letter:null,policy:'standard'}));
 const client=(queues=rows,version=45)=>({async query(sql){return{rows:sql.includes('version')?[{version}]:queues};}});
 await profile.assertSchema(client());
 await assert.rejects(()=>profile.assertSchema(client(rows,44)),/SCHEMA_INCOMPATIBLE/);
 for(const change of [{partition:true},{dead_letter:'other'},{policy:'exclusive'},{table_name:'other'}]){
  await assert.rejects(()=>profile.assertSchema(client([{...rows[0],...change},...rows.slice(1)])),/CONFIGURATION_DRIFT/);
 }
 await assert.rejects(()=>profile.assertSchema(client([...rows,{...rows[0],name:'other.workload'}])),/CONFIGURATION_DRIFT/);
});
test('installer rolls back a partial profile without granting or repairing it',async()=>{
 const statements=[];
 const client={async query(sql){statements.push(sql);if(sql==='SELECT version FROM pgboss.version')return{rows:[{version:45}]};if(sql.includes('FROM pgboss.queue'))return{rows:profile.QUEUES.map(name=>({name,table_name:'job_common',partition:false,dead_letter:null,policy:'standard'}))};if(sql.includes('SELECT rolname FROM pg_roles'))return{rows:[{rolname:profile.ROLE}]};return{rows:[]};}};
 await assert.rejects(()=>profile.provisionDocumentQueueProfile(client,{login:'synthetic_queue',password:'synthetic-never-used-password'}),/PARTIAL_PROFILE/);
 assert.equal(statements.at(-1),'ROLLBACK');assert(!statements.some(sql=>/^(CREATE|GRANT|ALTER|REVOKE)/.test(sql)));
});
