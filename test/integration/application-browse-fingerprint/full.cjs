'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {databaseFixture}=require('../http-oidc/fixture');
const {seed}=require('../http-oidc/sqlProof');
const browse=require('../../../backend/src/applications/browseSql');
const {parse}=require('../../../backend/src/applications/browse');
const {frozenSnapshotExpressions}=require('../../../backend/src/applications/opportunitySnapshot');
const oldJoin=frozenSnapshotExpressions('a.central_snapshot').join;
const newJoin=frozenSnapshotExpressions('a.central_snapshot',{finalDeadlineOnly:true}).join;
function baseline(sql){assert(sql.includes(newJoin));return sql.replace(newJoin,oldJoin);}
const name=process.env.BROWSE_REPORT;
assert(/^[a-z0-9-]+$/.test(name));
const out=path.resolve(__dirname,'../../../context/reviews',name);
fs.mkdirSync(out);const report={status:'RUNNING',measurements:[],checks:[],limits:['Real SQL/schema/RLS; synthetic authority input, no OIDC/HTTP or authority coordination timing.']};
const source=path.resolve(__dirname,'../../../backend/src/applications/browseSql.js');
const original=fs.readFileSync(source,'utf8');fs.writeFileSync(path.join(out,'browseSql-before.js'),original);
report.sourceHash=createHash('sha256').update(original).digest('hex');
const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
async function capture(tenant,input,authority,offset=0){
 let captured;const stop=Symbol('capture');
 const fn=browse.createSqlBrowse({org:tenant.organizationId,actor:{id:tenant.owner.id},guarded:async()=>{},readAuthority:async()=>authority,
  responsibleDirectory:async()=>new Map([[tenant.owner.membershipId,'Synthetic owner']]),cursor:{openCursor:()=>({offset,digest:'capture'})},project:x=>x,transitionCapability:async()=>true});
 try{await fn({query:async(sql,params)=>{if(sql.startsWith('WITH names AS')){captured={sql,params};throw stop;}return{rows:[{available:true}]};}}, {...parse(input),...(offset?{cursor:'capture'}:{})});}catch(e){if(e!==stop)throw e;}
 assert(captured);return captured;
}
async function main(){let db;
 try{
  db=await databaseFixture(report);
  const identity={issuer:'https://synthetic.example.invalid',user:async username=>({username,subject:randomUUID()})};
  const a=await db.tenant(identity,0),b=await db.tenant(identity,1);
  await seed(b,25,1);
  await require('./temporal-parity.cjs')(a.pool,report);
  const authority={teamOnly:false,membershipId:a.owner.membershipId,application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:true,ids:[]}};
  for(const size of [1000,10000]){
   await seed(a,size,1);
   // Mixed private, historical v1 and canonical v2 origins. Fixture writes only.
   const example=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../context/references/opportunity-v2/examples/eu-11145.json')));
   await a.pool.query(`WITH numbered AS (SELECT application_id,row_number() OVER(ORDER BY title) n FROM opportunity_catalog.application WHERE organization_id=$1)
     UPDATE opportunity_catalog.application a SET opportunity_id=NULL,central_opportunity_id=$2,central_revision_id=$3,
     central_snapshot=CASE WHEN n%5=0 THEN $4::jsonb ELSE '{"schemaVersion":1,"title":"Historical synthetic","closingDate":"2027-12-31"}'::jsonb END
     FROM numbered WHERE a.application_id=numbered.application_id AND a.organization_id=$1 AND n%5 IN (0,1)`,[a.organizationId,randomUUID(),randomUUID(),example]);
   await a.pool.query(`INSERT INTO opportunity_catalog.application_participant(organization_id,application_id,membership_id)
     SELECT organization_id,application_id,$2 FROM opportunity_catalog.application WHERE organization_id=$1 ORDER BY title LIMIT 10 ON CONFLICT DO NOTHING`,[a.organizationId,a.owner.membershipId]);
   await a.pool.query('ANALYZE opportunity_catalog.application');await a.pool.query('ANALYZE opportunity_catalog.application_participant');
   const client=await a.pool.connect();
   try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
    if(process.env.BROWSE_JIT_OFF==='1')await client.query('SET LOCAL jit = off');
    await client.query("SELECT set_config('app.organization_id',$1,true)",[a.organizationId]);
    await client.query("SET LOCAL statement_timeout='30s'");
    const scenarios=[['first',{},0,authority],['deep',{},Math.floor((size-25)/25)*25,authority],['search',{q:'0001'},0,authority],['status',{status:'IDENTIFIED',sort:'statusChangedAt',direction:'desc'},0,authority],['deadline',{sort:'opportunityClosingDate'},0,authority],['unit-none',{unitId:'NONE'},0,authority],['team',{},0,{...authority,teamOnly:true}],['team-empty',{},0,{...authority,teamOnly:true,membershipId:randomUUID()}],['resource',{sort:'totalBudget'},0,{...authority,application:{all:false,ids:[]}}]];
    for(const [scenario,input,offset,auth] of scenarios){
     const query=await capture(a,input,auth,offset);
     fs.writeFileSync(path.join(out,`${size}-${scenario}.sql`),query.sql);
     let reference;
     const oldSql=baseline(query.sql);
     if(scenario==='first')assert.equal(oldSql,fs.readFileSync(path.resolve(__dirname,`../../../context/reviews/browse-full-20261109/${size}-first.sql`),'utf8'));
     for(let iteration=0;iteration<8;iteration++){
      const variant=[0,3,4,7].includes(iteration)?'A':'B',sql=variant==='A'?oldSql:query.sql;
      const plan=(await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,query.params)).rows[0]['QUERY PLAN'][0];
      const result=(await client.query(sql,query.params)).rows[0];
      if(reference)assert.deepEqual(result,reference);else reference=result;
      assert(result.items.every(row=>row.organization_id===a.organizationId));
      if(scenario==='team-empty'||scenario==='resource')assert.equal(result.total,0);
      if(scenario==='team')assert.equal(result.total,10);
      report.measurements.push({size,scenario,iteration,variant,ms:plan['Execution Time'],planningMs:plan['Planning Time'],total:result.total,plan});save();
     }
     console.log('MEASURED',size,scenario);
    }
    const q=await capture(a,{},authority),before=(await client.query(q.sql,q.params)).rows[0];
    const foreignParams=[...q.params];foreignParams[0]=b.organizationId;
    assert.equal((await client.query(q.sql,foreignParams)).rows[0].total,0);
    const foreignContext=await client.query("SELECT set_config('app.organization_id',$1,true)",[b.organizationId]);
    assert(foreignContext);assert.equal((await client.query(q.sql,q.params)).rows[0].total,0);
    await client.query("SELECT set_config('app.organization_id',$1,true)",[a.organizationId]);
    const outside=(await client.query('SELECT application_id FROM opportunity_catalog.application WHERE organization_id=$1 ORDER BY title DESC LIMIT 1',[a.organizationId])).rows[0].application_id;
    await client.query("UPDATE opportunity_catalog.application SET notes='Synthetic changed note' WHERE organization_id=$1 AND application_id=$2",[a.organizationId,outside]);
    const after=(await client.query(q.sql,q.params)).rows[0];assert.notEqual(before.fingerprint,after.fingerprint);assert.deepEqual(before.items,after.items);
    assert.deepEqual(after,(await client.query(baseline(q.sql),q.params)).rows[0]);
    report.checks.push({size,foreignParameter:'DENIED',foreignContext:'DENIED',offPageChange:'DIGEST_CHANGED'});
   }finally{await client.query('ROLLBACK');client.release();}
  }
  assert.equal(fs.readFileSync(source,'utf8'),original);report.status='COMPLETE';save();
 }finally{await db?.close();}
}
main().catch(error=>{report.status='FAILED';report.error={name:error.name,code:error.code||null,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,500)};save();console.error('FULL_QUERY_PROOF_FAILED',error.code||error.name);process.exitCode=1;});
