'use strict';
const {fail}=require('./readErrors');
const {createIndex,atTime}=require('./readIndex');
const {buildProjection,digest}=require('./model');
const COMPACT=`jsonb_build_object('payloadDigest',payload_digest,'version',payload->'version','summary',payload#>'{detail,summary}',
 'calendar',jsonb_build_object('publication',payload#>'{inputs,snapshot,publication}','status',payload#>'{inputs,snapshot,status}','schedule',payload#>'{inputs,snapshot,schedule}'),
 'extension',jsonb_build_object('windows',payload#>'{inputs,extension,windows}','conflicts',payload#>'{inputs,extension,conflicts}'),
 'relationships',(SELECT COALESCE(jsonb_agg(r->'targetId'),'[]'::jsonb) FROM jsonb_array_elements(payload#>'{collections,relationships}') r))`;
function createReadRepository({pool,admit,maxRows=10000,maxBytes=64*1024*1024}){
 if(!pool?.connect||typeof admit!=='function')throw new TypeError('Dedicated reader pool and admission required');
 // Bounded immutable data only. No admission, principal, token or membership cache.
 const cache=new Map(),loading=new Map();let cacheBytes=0;
 const get=k=>{const v=cache.get(k);if(v){cache.delete(k);cache.set(k,v);}return v?.value;};
 const put=(k,value,bytes)=>{bytes=Math.max(bytes,512);if(bytes>maxBytes)return;const old=cache.get(k);if(old){cacheBytes-=old.bytes;cache.delete(k);}while((cacheBytes+bytes>maxBytes||cache.size>=128)&&cache.size){const key=cache.keys().next().value;cacheBytes-=cache.get(key).bytes;cache.delete(key);}cache.set(k,{value,bytes});cacheBytes+=bytes;};
 async function transaction(work){let c,discard=false;try{c=await pool.connect();}catch{fail('CATALOG_UNAVAILABLE');}try{
  await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");await c.query('SELECT pg_advisory_xact_lock_shared($1)',[42420002]);
  const login=(await c.query(`SELECT session_user=current_user AS reset,NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS limited FROM pg_roles WHERE rolname=session_user`)).rows[0];
  if(!login?.reset||!login.limited)fail('CATALOG_UNAVAILABLE');await admit(c);await c.query('SET LOCAL ROLE c4g_catalog_projection_reader');
  const result=await work(c);await c.query('COMMIT');return result;
 }catch(error){if(c)await c.query('ROLLBACK').catch(()=>{discard=true;});if(error.status)throw error;fail('CATALOG_UNAVAILABLE');}finally{c?.release(discard?new Error('READ_CONNECTION_CLEANUP_FAILED'):undefined);}}
 async function items(c,generationId,ids){
  if(ids.length>25)fail('CATALOG_UNAVAILABLE');
  const descriptors=(await c.query('SELECT opportunity_id,payload_digest,octet_length(payload::text)::int AS bytes FROM catalog_read.published_projection WHERE generation_id=$1 AND opportunity_id=ANY($2::uuid[])',[generationId,ids])).rows;
  if(descriptors.length!==ids.length)fail('OPPORTUNITY_NOT_FOUND');
  if(descriptors.reduce((n,r)=>n+r.bytes,0)>maxBytes)fail('PROJECTION_ITEM_TOO_LARGE');
  const missing=descriptors.filter(r=>!get('p:'+r.payload_digest));
  if(missing.length){const rows=(await c.query('SELECT payload,payload_digest FROM catalog_read.published_projection WHERE generation_id=$1 AND opportunity_id=ANY($2::uuid[])',[generationId,missing.map(r=>r.opportunity_id)])).rows;
   for(const {payload:p,payload_digest:key} of rows){if(p.version!=='gcni-catalog-projection/1.2'||!p.inputs)fail('CATALOG_UNAVAILABLE');const rebuilt=buildProjection(p.inputs.snapshot,p.inputs.extension,{asOf:p.asOf});if(digest(rebuilt)!==digest(p))fail('CATALOG_UNAVAILABLE');put('p:'+key,rebuilt,Buffer.byteLength(JSON.stringify(p)));}
  }
  const projections=descriptors.map(r=>{const p=get('p:'+r.payload_digest);if(!p)fail('CATALOG_UNAVAILABLE');return p;});
  const targets=[...new Set(projections.flatMap(p=>p.collections.relationships.map(r=>r.targetId)))];
  if(targets.length){const found=(await c.query('SELECT opportunity_id FROM catalog_read.published_projection WHERE generation_id=$1 AND opportunity_id=ANY($2::uuid[])',[generationId,targets])).rows;if(found.length!==targets.length)fail('CATALOG_UNAVAILABLE');}
  return projections;
 }
 return {async load(generationId,{opportunityId=null}={}){
  const result=await transaction(async c=>{
   const selected=generationId?await c.query('SELECT * FROM catalog_read.published_generation WHERE generation_id=$1',[generationId]):await c.query('SELECT g.* FROM catalog_read.current_generation a JOIN catalog_read.published_generation g USING(generation_id)');
   if(selected.rows.length!==1)fail(generationId?'SNAPSHOT_UNAVAILABLE':'CATALOG_UNAVAILABLE');const g=selected.rows[0];if(g.expected_count>maxRows)fail('CATALOG_UNAVAILABLE');
   const result={id:g.generation_id,asOf:new Date(g.as_of).toISOString(),expectedCount:g.expected_count};
   // Publication seals generation items and payloads. Their immutable identity is
   // sufficient only after fresh admission has verified those exact guards.
   // The header is still read every time; authority and admission are never cached.
   result.cacheKey='i:'+JSON.stringify([g.generation_id,g.as_of,g.published_at,g.expected_count]);
   if(opportunityId){result.rows=await items(c,g.generation_id,[opportunityId]);result.verified=true;result.relationshipsChecked=true;}
   return result;
  });
  if(result.rows)return result;
  const key=result.cacheKey;let index=get(key);
  if(!index){
   let pending=loading.get(key);
   if(!pending){
    // Waiters release their admitted metadata connection before awaiting this
    // shared immutable-data build. They never queue while holding pool slots.
    pending=transaction(async c=>{
     const size=(await c.query(`SELECT COALESCE(sum(octet_length((${COMPACT})::text)),0)::text AS bytes FROM catalog_read.published_projection WHERE generation_id=$1`,[result.id])).rows[0];
     if(BigInt(size.bytes)>BigInt(maxBytes))fail('CATALOG_UNAVAILABLE');
     const rows=(await c.query(`SELECT ${COMPACT} AS item FROM catalog_read.published_projection WHERE generation_id=$1 ORDER BY opportunity_id`,[result.id])).rows;
     if(rows.length!==result.expectedCount)fail('CATALOG_UNAVAILABLE');
     const prepared=createIndex(rows.map(r=>r.item));
     // Serialized-data budget plus bounded reference/derived-object allowance;
     // not a claim about the exact V8 heap footprint.
     put(key,prepared,Number(size.bytes)+rows.length*1024);return prepared;
    }).finally(()=>loading.delete(key));
    loading.set(key,pending);
   }
   index=await pending;
  }
  result.index=index;
  result.verify=async(summaries,asOf)=>{
   if(!summaries.length)return [];
   let projections=summaries.map(r=>get('p:'+index.digest(r.id)));
   if(projections.some(p=>!p))projections=await transaction(c=>items(c,result.id,summaries.map(r=>r.id)));
   const byId=new Map(projections.map(p=>[p.opportunityId,p]));
   for(const summary of summaries){const p=byId.get(summary.id),current=atTime(p,asOf);if(digest(current.detail.summary)!==digest(summary))fail('CATALOG_UNAVAILABLE');}
   return summaries.map(summary=>atTime(byId.get(summary.id),asOf));
  };
  return result;
 }};
}
module.exports={createReadRepository};
