'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createUuidV7,isUuidV7}=require('../audit/uuidV7');
const {OPERATIONS,SERVICES}=require('./catalogs');
const store=new AsyncLocalStorage();
function createContext(input={}){const service=input.service; if(!SERVICES.includes(service)||!OPERATIONS.includes(input.operation))throw new TypeError('Operational context is invalid.');return Object.freeze({service,component:String(input.component||'runtime').slice(0,64),operation:input.operation,correlationId:createUuidV7(),causationId:isUuidV7(input.causationId)?input.causationId:null,traceId:input.traceId||null,spanId:input.spanId||null,actorClass:['HUMAN','SERVICE','SUPPORT','ANONYMOUS'].includes(input.actorClass)?input.actorClass:'ANONYMOUS'});}
function runWithContext(context,fn){return store.run(context,fn);} function currentContext(){return store.getStore()||null;}
module.exports={createContext,runWithContext,currentContext};
