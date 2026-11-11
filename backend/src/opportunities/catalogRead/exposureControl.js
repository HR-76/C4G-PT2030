'use strict';
const {fail}=require('./readErrors');
const {deepFreeze}=require('../v2/data');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLES=new Set(['ORG_ADMIN','CONTRIBUTOR']);
const MAX_LEASE=300000;
function identifiers(values){return Array.isArray(values)&&values.length<=1000&&new Set(values).size===values.length&&values.every(v=>typeof v==='string'&&UUID.test(v));}
function valid(p){return p&&Number.isSafeInteger(p.revision)&&p.revision>=0&&['OFF','COHORT'].includes(p.mode)&&identifiers(p.organizations)&&identifiers(p.blockedGenerations)&&Array.isArray(p.roles)&&new Set(p.roles).size===p.roles.length&&p.roles.every(r=>ROLES.has(r))&&(p.mode==='OFF'?p.expiresAt===null:Number.isSafeInteger(p.expiresAt)&&p.organizations.length>0&&p.roles.length>0);}
// Rehearsal adapter, shared explicitly by instances in one process. Not durable
// storage, a distributed lock or an environment/global configuration switch.
function createPolicyStore(){
 let policy=deepFreeze({revision:0,mode:'OFF',organizations:[],roles:[],blockedGenerations:[],expiresAt:null});
 return Object.freeze({async read(){return policy;},async compareAndSet(expected,next){
  if(policy.revision!==expected)throw Error('POLICY_VERSION_CONFLICT');
  if(!valid(next)||next.revision!==expected+1)throw Error('INVALID_EXPOSURE_POLICY');
  policy=deepFreeze(structuredClone(next));return policy;
 }});
}
function createExposureControl({store,clock=()=>Date.now(),healthy=()=>true}){
 if(!store?.read||!store?.compareAndSet)throw TypeError('Explicit policy adapter required');
 const tickets=new WeakSet();
 async function read(){let p;try{p=await store.read();}catch{fail('CATALOG_UNAVAILABLE');}if(!valid(p))fail('CATALOG_UNAVAILABLE');return p;}
 function allow(p,a){
  if(!healthy()||(p.mode==='COHORT'&&p.expiresAt>clock()+MAX_LEASE))fail('CATALOG_UNAVAILABLE');
  if(p.mode!=='COHORT'||clock()>=p.expiresAt||!a?.scope||!p.organizations.includes(a.organizationId)||!p.roles.includes(a.baseRoleCode))fail('ACCESS_DENIED');
 }
 const reader=Object.freeze({async begin(authority){const p=await read();allow(p,authority);const t=Object.freeze({revision:p.revision,scope:authority.scope,organizationId:authority.organizationId,baseRoleCode:authority.baseRoleCode});tickets.add(t);return t;},
  async check(ticket,authority,generationId){
   if(!tickets.has(ticket))fail('ACCESS_DENIED');const p=await read();allow(p,authority);
   if(p.revision!==ticket.revision||authority.scope!==ticket.scope||authority.organizationId!==ticket.organizationId||authority.baseRoleCode!==ticket.baseRoleCode)fail('ACCESS_DENIED');
   if(generationId&&p.blockedGenerations.includes(generationId))fail('SNAPSHOT_UNAVAILABLE');
   return Object.freeze({version:'gcni-catalog-exposure/1.0',available:true,revision:p.revision,validUntil:new Date(Math.min(p.expiresAt,authority.expiresAt,clock()+30000)).toISOString()});
  }});
 async function update(expected,edit){
  const p=await read();if(p.revision!==expected)throw Error('POLICY_VERSION_CONFLICT');const next={...p,...edit(p),revision:p.revision+1};
  if(!valid(next))throw Error('INVALID_EXPOSURE_POLICY');return store.compareAndSet(expected,next);
 }
 // Local operator capability only. Never attach this object to an HTTP router.
 const operator=Object.freeze({
  enable({expectedRevision,organizations,roles=['ORG_ADMIN'],leaseMs=MAX_LEASE}){
   if(!Number.isSafeInteger(leaseMs)||leaseMs<=0||leaseMs>MAX_LEASE)throw Error('INVALID_EXPOSURE_LEASE');
   return update(expectedRevision,()=>({mode:'COHORT',organizations:[...organizations],roles:[...roles],expiresAt:clock()+leaseMs}));
  },disable({expectedRevision}){return update(expectedRevision,()=>({mode:'OFF',organizations:[],roles:[],expiresAt:null}));},
  withdraw({expectedRevision,generationId}){if(!UUID.test(generationId))throw Error('INVALID_GENERATION_ID');return update(expectedRevision,p=>({blockedGenerations:[...new Set([...p.blockedGenerations,generationId])]}));},
  async status(){const p=await read();return Object.freeze({revision:p.revision,mode:p.mode,organizations:p.organizations.length,blockedGenerations:p.blockedGenerations.length,expiresAt:p.expiresAt});}
 });
 return Object.freeze({reader,operator});
}
module.exports={createPolicyStore,createExposureControl,MAX_LEASE};
