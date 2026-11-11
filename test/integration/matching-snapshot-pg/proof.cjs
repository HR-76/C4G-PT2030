'use strict';
// Synthetic algorithm/snapshot experiment, not the matching production runtime.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Pool}=require('../../../backend/node_modules/pg'),{createProof,compare}=require('../matching-pagination/rank-proof.cjs');
const run=process.env.HTTP_PROOF_RUN,container=process.env.CIA_CONTAINER,name=process.env.CIA_REPORT,url=new URL(process.env.HTTP_PROOF_ADMIN_URL);
assert.match(run,/^[a-f0-9]{32}$/);assert.equal(container,'c4g-cia-restore-'+run);assert.match(name,/^[a-z0-9-]+$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert(!['5432','5433'].includes(url.port));
assert.equal(JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',container],{encoding:'utf8'}))['c4g.cia-restore'],run);
const dir=path.resolve(__dirname,'../../../context/reviews',name);fs.mkdirSync(dir);const report={status:'RUNNING',checks:[],limits:['Synthetic ranking in one database; cross-database test uses two synthetic databases in the same PostgreSQL cluster. No product matching HTTP, RLS, permissions or solution for cross-database consistency.','No durable snapshots, operational budgets, lifecycle or production pagination implemented.']};
const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');
async function main(){const pool=new Pool({connectionString:url.toString(),max:3});const ctx={organizationId:randomUUID(),subjectId:randomUUID(),sessionId:randomUUID(),query:'synthetic'},query=createProof({key:'synthetic-'.repeat(5)});try{
 await pool.query('CREATE TABLE public.synthetic_matching (n integer PRIMARY KEY, id text NOT NULL, origin text NOT NULL, score integer NOT NULL, deadline text NOT NULL)');
 await pool.query("INSERT INTO public.synthetic_matching SELECT n,lpad(n::text,5,'0'),CASE WHEN n%2=0 THEN 'CENTRAL' ELSE 'PRIVATE' END,n%4,'2027-01-01' FROM generate_series(1,1501) n");
 const source=(client,mutate=false)=>async function*(){let after=0,changed=false;for(;;){const rows=(await client.query('SELECT n,id,origin,score,deadline FROM public.synthetic_matching WHERE n>$1 ORDER BY n LIMIT 100',[after])).rows;if(!rows.length)break;for(const row of rows){after=row.n;yield {id:row.id,origin:row.origin,score:row.score,deadline:row.deadline,match:true};if(mutate&&!changed){await pool.query('UPDATE public.synthetic_matching SET score=99 WHERE n=1');changed=true;}}}};
 const c=await pool.connect();let first;try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');first=await query({source:source(c,true),context:ctx,pageSize:100});assert(first.nextCursor);assert(!first.items.some(x=>x.score===99));await c.query('COMMIT');}finally{c.release()}
 const next=await pool.connect();try{await next.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await assert.rejects(query({source:source(next),context:ctx,cursor:first.nextCursor,pageSize:100}),{code:'INVALID_CURSOR'});await next.query('ROLLBACK');}finally{next.release()}
 report.checks.push('repeatable-read snapshot excludes mutation during iteration; next snapshot rejects stale cursor');
 const original=await pool.query('SELECT id,origin,score,deadline FROM public.synthetic_matching ORDER BY n');const expected=original.rows.map(x=>({...x,match:true})).sort(compare);let cursor=null,all=[];
 do{const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const page=await query({source:source(client),context:ctx,cursor,pageSize:100});all.push(...page.items);cursor=page.nextCursor;await client.query('COMMIT');}finally{client.release();}}while(cursor);
 assert.equal(all.length,1501);assert.deepEqual(all,expected);report.checks.push('1501 synthetic rows across 16 pages equal global ranking');
 // Independent database snapshots may compose a state that never existed.
 await pool.query('CREATE DATABASE matching_synthetic_a');await pool.query('CREATE DATABASE matching_synthetic_b');
 const databasePool=name=>{const u=new URL(url);u.pathname='/'+name;return new Pool({connectionString:u.toString(),max:2});};
 const pa=databasePool('matching_synthetic_a'),pb=databasePool('matching_synthetic_b');
 try{for(const p of [pa,pb])await p.query('CREATE TABLE public.marker (id integer PRIMARY KEY, value integer NOT NULL); INSERT INTO public.marker VALUES (1,0)');
  const old=await pb.connect();try{await old.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal((await old.query('SELECT value FROM public.marker')).rows[0].value,0);
   await pb.query('UPDATE public.marker SET value=1 WHERE id=1');await pa.query('UPDATE public.marker SET value=1 WHERE id=1');
   const fresh=await pa.connect();try{await fresh.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal((await fresh.query('SELECT value FROM public.marker')).rows[0].value,1);assert.equal((await old.query('SELECT value FROM public.marker')).rows[0].value,0);await fresh.query('ROLLBACK');}finally{fresh.release()}
   await old.query('ROLLBACK');
  }finally{old.release()}
  report.checks.push('independent Central and tenant style snapshots can combine states that never coexisted');
  for(const p of [pa,pb])await p.query(`CREATE TABLE public.synthetic_fence (id integer PRIMARY KEY, epoch bigint NOT NULL); INSERT INTO public.synthetic_fence VALUES (1,0); CREATE FUNCTION public.synthetic_bump() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.synthetic_fence SET epoch=epoch+1 WHERE id=1; RETURN NEW; END $$; CREATE TRIGGER marker_fence BEFORE UPDATE ON public.marker FOR EACH ROW EXECUTE FUNCTION public.synthetic_bump()`);
  const ca=await pa.connect(),cb=await pb.connect(),writer=await pb.connect();
  try{
   await ca.query('BEGIN');await cb.query('BEGIN');await ca.query('SELECT epoch FROM public.synthetic_fence WHERE id=1 FOR SHARE');await cb.query('SELECT epoch FROM public.synthetic_fence WHERE id=1 FOR SHARE');
   const beforeA=(await ca.query('SELECT value FROM public.marker')).rows[0].value,beforeB=(await cb.query('SELECT value FROM public.marker')).rows[0].value;assert.equal(beforeA,1);assert.equal(beforeB,1);
   await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='200ms'");await assert.rejects(writer.query('UPDATE public.marker SET value=2 WHERE id=1'),e=>e.code==='55P03');await writer.query('ROLLBACK');
   await ca.query('COMMIT');await cb.query('COMMIT');await writer.query('UPDATE public.marker SET value=2 WHERE id=1');assert.equal((await writer.query('SELECT epoch::int FROM public.synthetic_fence')).rows[0].epoch,1);
   report.checks.push('synthetic writer using shared fence protocol is blocked during dual-source capture and increments epoch after release');
  }finally{await Promise.allSettled([ca.query('ROLLBACK'),cb.query('ROLLBACK'),writer.query('ROLLBACK')]);ca.release();cb.release();writer.release();}
 }finally{await Promise.all([pa.end(),pb.end()])}
 report.status='PASS';save();console.log('MATCHING_SNAPSHOT_PG_PASS');
 }finally{await pool.end();}}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};save();console.error('MATCHING_SNAPSHOT_PG_FAIL',e.code||e.name);process.exitCode=1;});
