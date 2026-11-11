'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTenantDirectoryReader}=require('../src/security/tenantDirectoryReader');
const {createAuthorityCoordinator}=require('../src/security/authorityCoordinator');
const {createConfiguredOpportunityRuntime}=require('../src/config/opportunityRuntime');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture(){let calls=0;const unexpected=()=>{calls++;throw Error('UNEXPECTED_DATABASE');};return{coordinator:createAuthorityCoordinator({pool:{query:unexpected,connect:unexpected},permitSecret:'synthetic-'.repeat(5)}),calls:()=>calls};}
test('directory service requires the branded authority and a bounded unique deployment scope',()=>{
 const f=fixture();for(const organizations of [[],[A,A.toUpperCase()],['not-an-id'],Array(101).fill(A)])assert.throws(()=>createTenantDirectoryReader({coordinator:f.coordinator,organizations,workload:'API'}),/CONFIGURATION/);
 assert.throws(()=>createTenantDirectoryReader({coordinator:{pool:{query(){}}},organizations:[A],workload:'API'}),/CONFIGURATION/);
 assert.equal(f.calls(),0);
});
test('foreign organization and workload are refused before any Central call',async()=>{
 const f=fixture(),reader=createTenantDirectoryReader({coordinator:f.coordinator,organizations:[A],workload:'API'});
 for(const args of [[B,'API'],[A,'WORKER'],[A,'MIGRATOR'],['','API']])await assert.rejects(()=>reader.resolveSnapshotByOrganization(...args),/SCOPE_DENIED/);
 assert.equal(f.calls(),0);
});
test('API validates directory configuration before constructing the Tenant pool manager',()=>{
 for(const organizations of [undefined,'not-json','[]'])assert.throws(()=>createConfiguredOpportunityRuntime({env:{DOCUMENT_API_ORGANIZATIONS_JSON:organizations},documentsEnabled:true}),/DIRECTORY_CONFIGURATION/);
});
test('directory SQL is allowlisted and has no credentials, dynamic SQL or free search',()=>{
 const query=require('../src/security/tenantDirectoryQueries').resolve;
 assert(require('../src/security/authorityProtocolQueries').queries.includes(query));
 assert.match(query,/WHERE o.id=\$1 AND o.status='ACTIVE'/);assert.match(query,/LIMIT 2$/);
 assert.doesNotMatch(query,/password|connection_string|ILIKE|EXECUTE|SELECT \*/i);
});
