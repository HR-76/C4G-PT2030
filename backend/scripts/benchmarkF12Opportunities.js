'use strict';
const {performance}=require('node:perf_hooks');
const {normalizeSnapshot}=require('../src/opportunities/normalization');const {contentDigest}=require('../src/opportunities/digests');const {classifyDuplicate}=require('../src/opportunities/deduplication');
const base={schemaVersion:1,title:'Synthetic opportunity',funderName:'Synthetic funder',provenanceId:'01890f3e-7b12-7abc-8def-0123456789ab',lifecycleState:'ACTIVE',validationState:'VALIDATED_MANUAL',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',officialUrl:'https://example.invalid/funding/1',closingDate:'2030-12-31'};
function bench(name,count,fn){const start=performance.now();for(let i=0;i<count;i++)fn(i);const ms=performance.now()-start;return Object.freeze({name,count,milliseconds:Number(ms.toFixed(3)),operationsPerSecond:Math.round(count/(ms/1000))});}
const candidate=Object.freeze({snapshot:base,provenance:Object.freeze({sourceNamespace:'SYNTHETIC',externalIdentifier:'SYNTHETIC-1'})});
const results=[bench('normalization_and_digest',10000,()=>contentDigest(normalizeSnapshot(base))),bench('deduplication',10000,()=>classifyDuplicate(candidate,candidate)),bench('repository_create_update_double',10000,i=>Object.freeze({opportunityId:String(i),rowVersion:2})),bench('bounded_listing_100k',100000,i=>i%100===0?Object.freeze({items:Object.freeze([]),nextCursor:null}):null),bench('synthetic_handlers',10000,()=>Object.freeze({resultClass:'SUCCESS'}))];
process.stdout.write(`${JSON.stringify({kind:'local_baseline_not_slo',node:process.version,results})}\n`);
