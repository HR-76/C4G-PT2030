'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const core=require('../../../backend/src/security/centralSchemaManifest');
async function diagnose(pool){
 const c=await pool.connect(),samples=[],queries=new Set();
 const planned={query(text,values){assert.equal(typeof text,'string');queries.add(text);const name='probe_'+createHash('sha256').update(text).digest('hex').slice(0,48);assert(name.length<=63);return c.query({name,text,values});}};
 try{
  await c.query('BEGIN READ ONLY');
  const expected=JSON.stringify(await core.centralSchemaSnapshot(c,{compact:true}));
  for(let i=0;i<16;i++)for(const arm of i%2?['B','A']:['A','B']){
   const started=performance.now();const result=await core.centralSchemaSnapshot(arm==='A'?c:planned,{compact:true});
   const ms=performance.now()-started;assert.equal(JSON.stringify(result),expected);samples.push({arm,ms});
  }
  const plans=(await c.query("SELECT name,generic_plans::int,custom_plans::int FROM pg_prepared_statements WHERE name LIKE 'probe_%' ORDER BY name")).rows;
  assert.equal(plans.length,queries.size);assert(plans.every(p=>p.generic_plans+p.custom_plans>=16));
  const main=[...queries].find(q=>q.includes('AS "tables"'));
  const alternatives={direct:main.replace("COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)",'COALESCE(con.conenforced,false)'),row:main.replace('to_jsonb(con)','row_to_json(con)')};
  const variants=[];
  for(const [name,text] of Object.entries(alternatives)){
   assert.notEqual(text,main);assert.deepEqual((await c.query(text)).rows,(await c.query(main)).rows);
   const timings=[];
   for(let i=0;i<12;i++)for(const arm of i%2?['B','A']:['A','B']){
    const p=(await c.query('EXPLAIN (ANALYZE,FORMAT JSON) '+(arm==='A'?main:text))).rows[0]['QUERY PLAN'][0];
    timings.push({arm,ms:p['Execution Time'],planningMs:p['Planning Time']});
   }
   variants.push({name,identical:true,samples:timings});
  }
  return {identical:true,samples,plans,queries:queries.size,variants};
 }finally{await c.query('ROLLBACK');c.release();}
}
module.exports={diagnose};
