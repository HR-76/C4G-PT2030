'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRehearsalMonitor,WINDOW}=require('../src/opportunities/catalogRead/rehearsalMonitor');
test('sink receives only closed-schema aggregates, never path/query/identity values',()=>{
 const events=[];const m=createRehearsalMonitor({sink:e=>events.push(e)});assert.equal(m.healthy(),false);m.heartbeat();m.observe({path:'/opportunities/secret?token=SECRET',method:'POST',status:403,errorCode:'SECRET',durationMs:3,userId:'SECRET'});
 assert(!JSON.stringify(events).includes('SECRET'));assert.equal(events[1].route,'unknown');assert.equal(events[1].method,'POST');assert.equal(m.metrics().records[0].labels.method,'POST');assert.equal(m.snapshot().routes.unknown.current.errors,0);
});
test('two adequately sampled windows alert on latency, sparse and overflow data never certify performance',()=>{
 let now=WINDOW+1000;const m=createRehearsalMonitor({sink:()=>{},clock:()=>now});m.heartbeat();const row={path:'/opportunities',status:200,durationMs:600};
 for(let i=0;i<100;i++)m.observe(row);assert(!m.snapshot().alerts.includes('LATENCY_SUSTAINED_LIST'));
 now+=WINDOW;for(let i=0;i<100;i++)m.observe(row);assert(m.snapshot().alerts.includes('LATENCY_SUSTAINED_LIST'));
 const limited=createRehearsalMonitor({sink:()=>{},clock:()=>now,capacity:2});limited.heartbeat();for(let i=0;i<3;i++)limited.observe(row);assert.equal(limited.snapshot().retained,2);assert(limited.metrics().records.length<=2);assert.equal(limited.snapshot().complete,false);assert(limited.snapshot().alerts.includes('COVERAGE_INCOMPLETE'));
});
test('delivery failure is latched, stale telemetry and failed probes are visible; recovery is explicit',()=>{
 let broken=false,now=0;const m=createRehearsalMonitor({sink:()=>{if(broken)throw Error('offline')},clock:()=>now});m.heartbeat();broken=true;m.observe({path:'/opportunities',status:200,durationMs:10});assert.equal(m.healthy(),false);
 broken=false;m.observe({path:'/opportunities',status:200,durationMs:10});assert.equal(m.healthy(),false);assert(m.heartbeat());assert(m.healthy());
 for(let i=0;i<3;i++)m.probe(false);assert(m.snapshot().alerts.includes('PROBE_FAILURE'));m.probe(true);assert(!m.snapshot().alerts.includes('PROBE_FAILURE'));
 now=120001;assert.equal(m.healthy(),false);
});

test('metric cardinality losses are signalled instead of claiming complete metric delivery',()=>{
 const m=createRehearsalMonitor({sink:()=>{}});m.heartbeat();const paths=['/opportunities','/opportunities/12345678-1234-1234-8234-123456789abc','/opportunities/12345678-1234-1234-8234-123456789abc/windows','/options','/availability','/unknown'];
 for(const path of paths)for(const method of ['GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE','UNKNOWN'])for(const status of [100,200,300,400,500])m.observe({path,method,status,durationMs:1});
 assert(m.snapshot().metricDrops>0);assert(m.snapshot().alerts.includes('METRIC_CARDINALITY_DROP'));
});
