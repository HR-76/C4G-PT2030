'use strict';
class InMemoryExporter{constructor({capacity=2048,batchSize=256,clock=()=>Date.now(),fault=null}={}){if(capacity!==2048||batchSize!==256)throw new TypeError('Exporter limits are incompatible.');this.capacity=capacity;this.batchSize=batchSize;this.clock=clock;this.fault=fault;this.items=[];this.dropped=0;this.closed=false;}export(items){if(this.closed)throw new Error('EXPORTER_CLOSED');if(this.fault)this.fault();for(const item of items){if(this.items.length>=this.capacity){this.items.shift();this.dropped++;}this.items.push(Object.freeze(structuredClone(item)));}return {accepted:items.length,dropped:this.dropped};}flush(){if(this.fault)this.fault();return Promise.resolve();}shutdown(){this.closed=true;return Promise.resolve();}snapshot(){return Object.freeze({items:[...this.items],dropped:this.dropped});}}
const {InMemorySpanExporter}=require('@opentelemetry/sdk-trace-node');
const {InMemoryMetricExporter}=require('@opentelemetry/sdk-metrics');
const MEMORY_LIMIT=2048;
class BoundedSpanExporter extends InMemorySpanExporter {
 constructor(){super();this.dropped=0;}
 export(spans,callback){super.export(spans,callback);const items=this.getFinishedSpans(),excess=Math.max(0,items.length-MEMORY_LIMIT);if(excess){items.splice(0,excess);this.dropped+=excess;}}
}
class BoundedMetricExporter extends InMemoryMetricExporter {
 constructor(){super();this.dropped=0;}
 export(metrics,callback){super.export(metrics,callback);const items=this.getMetrics(),excess=Math.max(0,items.length-MEMORY_LIMIT);if(excess){items.splice(0,excess);this.dropped+=excess;}}
}
module.exports={InMemoryExporter,BoundedSpanExporter,BoundedMetricExporter,MEMORY_LIMIT};
