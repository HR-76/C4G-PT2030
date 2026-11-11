'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplicationRepository}=require('../../../backend/src/applications/repository');
const {createWorkRepository}=require('../../../backend/src/applications/work');
const {command}=require('../../../backend/src/applications/contracts');
async function prepare(client){
 const org=randomUUID(),actor={id:randomUUID()},membership=randomUUID();
 await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
 const deps={organizationId:org,actor,protect:async()=>{},authorize:async()=>true,verifyResponsible:async()=>true,audit:async()=>{},cursor:{cursor:v=>String(v),openCursor:v=>Number(v)},centralOrigin:async()=>({title:'Existing opportunity',lifecycleState:'ACTIVE'})};
 const applications=createApplicationRepository(deps),work=createWorkRepository(deps);
 const input=command('create',{origin:'CENTRAL',centralRevisionId:randomUUID(),opportunityId:randomUUID(),evaluationId:null,title:'Existing application',responsibleMembershipId:membership,deadline:'2026-12-31',notes:'Preserved notes',totalBudget:'123.45',organizationBudget:'12.34',idempotencyKey:randomUUID()});
 const created=await applications.create(client,input);await work.taskCreate(client,created.applicationId,{title:'Existing task',responsibleMembershipId:membership,deadline:'2026-12-30',expectedRevision:1,idempotencyKey:randomUUID()});
 const tables=['application','application_change','application_receipt','application_work','application_task','application_work_change','application_work_receipt'];
 const read=async()=>{const result={};for(const t of tables)result[t]=(await client.query(`SELECT to_jsonb(t) AS row FROM opportunity_catalog.${t} t ORDER BY to_jsonb(t)::text`)).rows;return result};
 const before=await read();await client.query('RESET ROLE');
 return async()=>{await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');assert.deepEqual(await read(),before);assert.deepEqual(await applications.create(client,input),created);await client.query('RESET ROLE');console.log('PARTNER_MIGRATION_EXISTING_FIELDS_TASKS_HISTORY_RECEIPTS_PRESERVED_PASS')};
}
module.exports={prepare};
