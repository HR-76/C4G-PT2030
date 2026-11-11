'use strict';
const {Pool}=require('../../../backend/node_modules/pg');
const {createPgPolicyStore,createDurableExposureControl}=require('../../../backend/src/opportunities/catalogRead/pgPolicyStore');
const {createReadService}=require('../../../backend/src/opportunities/catalogRead/readService');
const {buildProjection,emptyExtension,stableId}=require('../../../backend/src/opportunities/catalogRead/model');
const source=require('../catalog-read/snapshot-v2.json');
let pool,control,service,release,entered;
process.on('message',async message=>{
 const {id,action,args}=message;
 try {
  let value;
  if(action==='init'){
   pool=new Pool({...args.connection,max:2,connectionTimeoutMillis:1500,query_timeout:4000});pool.on('error',()=>{});
   const store=createPgPolicyStore({isolated:true,pool,login:args.connection.user,writable:args.writer});
   control=createDurableExposureControl({store});
   const asOf=new Date().toISOString();
   const e=emptyExtension(source,{opportunityId:stableId('durable-o'),revisionId:stableId('durable-r'),extensionId:stableId('durable-e'),acceptanceDigest:'a'.repeat(64),recordedAt:asOf});
   const projection=buildProjection(source,e,{asOf});
   service=createReadService({repository:{load:async()=>{if(entered){entered();await new Promise(r=>release=r);}return {id:args.generation,asOf,rows:[projection]};}},
    authorize:async principal=>({scope:'isolated-membership',organizationId:args.org,baseRoleCode:principal==='admin'?'ORG_ADMIN':'CONTRIBUTOR',expiresAt:Date.now()+900000}),key:Buffer.from(args.key,'base64'),exposure:control.reader});
   value='READY';
  } else if(action==='read')value=await service.request({principal:args?.principal||'admin',path:args?.path||'/opportunities',pairs:args?.pairs||[]});
  else if(action==='hold'){entered=()=>process.send({event:'entered'});value=true;}
  else if(action==='release'){entered=null;release?.();value=true;}
  else if(action==='stop'){await pool.end();process.send({id,value:true});process.disconnect();return;}
  else value=await control.operator[action](args);
  process.send({id,value});
 } catch(e){process.send({id,error:e.code||(['POLICY_VERSION_CONFLICT','POLICY_NOT_OPEN','POLICY_READ_ONLY'].includes(e.message)?e.message:'CONTROL_FAILED'),diagnostic:e.diagnostic});}
});
