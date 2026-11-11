'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createCentralOrganizationReader}=require('../src/organizationDirectory/centralOrganizationReader');
test('reader binds organization and refuses cross-organization queries before accessing the pool',async()=>{
 const org=randomUUID(),other=randomUUID(),calls=[];
 const read=createCentralOrganizationReader({organizationId:org,pool:{async query(sql,args){calls.push({sql,args});return {rows:[{id:org,display_name:'Public',legal_name:'Legal',type_code:'RESEARCH'}]};}}});
 await assert.rejects(read(other),{code:'RESOURCE_NOT_AVAILABLE'});assert.equal(calls.length,0);
 assert.deepEqual(await read(org),{id:org,name:'Public',legalName:'Legal',typeCode:'RESEARCH'});assert.deepEqual(calls[0].args,[org]);
});
test('reader propagates missing organization and database errors',async()=>{
 const org=randomUUID(),err=new Error('database failure');
 await assert.rejects(createCentralOrganizationReader({organizationId:org,pool:{query:async()=>({rows:[]})}})(org),{code:'RESOURCE_NOT_AVAILABLE'});
 await assert.rejects(createCentralOrganizationReader({organizationId:org,pool:{query:async()=>{throw err;}}})(org),e=>e===err);
});
test('membership reader binds server organization, passes rows unchanged and propagates failure',async()=>{
 const {createCentralMembershipReader}=require('../src/organizationDirectory/centralOrganizationReader'),org=randomUUID(),rows=[{membershipId:randomUUID(),revision:3}],calls=[];
 const read=createCentralMembershipReader({organizationId:org,pool:{async query(sql,args){calls.push({sql,args});return {rows}}}});
 assert.equal(await read(),rows);assert.deepEqual(calls[0].args,[org]);assert.match(calls[0].sql,/LIMIT 1001/);
 const error=new Error('unavailable');await assert.rejects(createCentralMembershipReader({organizationId:org,pool:{query:async()=>{throw error}}})(),e=>e===error);
});
