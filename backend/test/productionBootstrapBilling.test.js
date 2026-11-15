'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {provisionBillingProfile,validateBillingProfile,BILLING_LOGIN,inspectBillingProfile}=require('../scripts/productionBootstrap/billing');
const {ownership}=require('../scripts/productionBootstrap/cluster');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const config={version:1,installationId:id(1),target:{host:'private-database',port:5432,expectedSystemIdentifier:'7777777777',centralDatabase:'c4g_central',tenantDatabase:'c4g_tenant',ssl:{rejectUnauthorized:true}},
 organization:{id:id(2),name:'Synthetic',legalName:'Synthetic',slug:'synthetic',type:'OTHER',currency:'EUR',dataResidencyCode:'EU'},
 tenant:{id:id(3),generationId:id(4),apiLogin:'prod_tenant_api',credentialRef:'production-api',regionCode:'EU',residencyPolicyVersion:'production-eu-v1'},
 administrator:{globalUserId:id(5),membershipId:id(6),issuer:'https://login.example.test/realms/c4g',subject:'synthetic-subject',name:'Synthetic Admin',email:'admin@example.test',organizationProfile:'ORG_ADMIN'}};
function harness({existing=null,unsafe=false,edgeChange=null,targetDatabase=config.target.centralDatabase}={}){
 const calls=[],rows=values=>({rows:values,rowCount:values.length});let created=false;
 const role=(rolname)=>({rolname,rolcanlogin:rolname===BILLING_LOGIN,rolinherit:rolname!==BILLING_LOGIN,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,configured:false,expires:false});
 const client={release(){calls.push(['release']);},async query(sql,params){calls.push([sql,params]);
  if(sql.includes('current_database() AS database'))return rows([{database:targetDatabase,system_identifier:config.target.expectedSystemIdentifier,login:BILLING_LOGIN,current_role:BILLING_LOGIN}]);
  if(sql.includes('pg_try_advisory_xact_lock'))return rows([{acquired:true}]);
  if(sql.includes("shobj_description(oid,'pg_authid')"))return rows(existing?[{ownership:existing}]:[]);
  if(sql.startsWith('CREATE ROLE'))created=true;
  if(sql.includes('rolcanlogin,rolinherit'))return rows((created||existing?[BILLING_LOGIN,'c4g_billing_validation_worker']:['c4g_billing_validation_worker']).map(role));
  if(sql.includes('granted.rolname granted'))return rows(created||existing?[{granted:'c4g_billing_validation_worker',member:BILLING_LOGIN,set_option:false,inherit_option:true,admin_option:false,...edgeChange}]:[]);
  if(sql.includes('AS unsafe'))return rows([{unsafe}]);
  if(sql.includes('has_function_privilege'))return rows([{claim:true,finish:true,connect:true,public_usage:true}]);
  return rows([]);
 }};
 return {client,calls,pool:{async connect(){return client;}},dependencies:{async verifyPassword(_client,login,password){assert.equal(login,BILLING_LOGIN);assert.equal(password,'private-billing-secret-'.repeat(3));calls.push(['verifyPassword']);}}};
}
test('billing provisioning grants only inherited delivery functions and immutable installation ownership',async()=>{
 const h=harness();const result=await provisionBillingProfile({centralPool:h.pool,config,password:'private-billing-secret-'.repeat(3)},h.dependencies);
 assert.equal(result.login,BILLING_LOGIN);assert.equal(result.state,'PROVISIONED');
 assert.ok(h.calls.some(([s])=>s.includes('WITH INHERIT TRUE, SET FALSE, ADMIN FALSE')));
 assert.ok(h.calls.some(([s])=>s.includes('LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')));
 assert.equal(h.calls.filter(([s])=>s.startsWith('GRANT ')).length,2);
 assert.equal(h.calls.at(-2)[0],'COMMIT');
});
test('billing replay verifies credentials without rotating or repairing roles',async()=>{
 const h=harness({existing:ownership(config)+':billing-validation-v1'});
 const result=await provisionBillingProfile({centralPool:h.pool,config,password:'private-billing-secret-'.repeat(3)},h.dependencies);
 assert.equal(result.state,'ALREADY_CONFORMING');assert.equal(h.calls.some(([s])=>/^(CREATE|ALTER|GRANT|COMMENT)/.test(s)),false);
 assert.ok(h.calls.some(([s])=>s==='verifyPassword'));
});
test('billing refuses foreign ownership and grant drift with rollback',async()=>{
 for(const options of [{existing:'foreign'},{existing:ownership(config)+':billing-validation-v1',unsafe:true},{existing:ownership(config)+':billing-validation-v1',edgeChange:{set_option:true}}]){
  const h=harness(options);await assert.rejects(provisionBillingProfile({centralPool:h.pool,config,password:'private-billing-secret-'.repeat(3)},h.dependencies),/PRODUCTION_BILLING_/);
  assert.ok(h.calls.some(([s])=>s==='ROLLBACK'));assert.equal(h.calls.some(([s])=>/^(CREATE|ALTER|GRANT|COMMENT)/.test(s)),false);
 }
});
test('billing inspection does not claim or finish email jobs',async()=>{
 const h=harness({existing:'marker'});await inspectBillingProfile(h.client,config);
 assert.equal(h.calls.some(([s])=>/^SELECT public\.billing_validation_email_(claim|finish)\(/.test(s)),false);
});
test('billing provisioning refuses a mismatched target before changing roles',async()=>{
 const h=harness({targetDatabase:'unrelated'});await assert.rejects(provisionBillingProfile({centralPool:h.pool,config,password:'private-billing-secret-'.repeat(3)},h.dependencies),{code:'PRODUCTION_BILLING_TARGET_MISMATCH'});
 assert.equal(h.calls.some(([s])=>/^(CREATE|ALTER|GRANT|COMMENT)/.test(s)),false);
});
test('billing validation connects with only the dedicated login and always closes the limited pool',async()=>{
 const h=harness({existing:'marker'});let options,ended=false;
 class FakePool{constructor(o){options=o;}async connect(){return h.client;}async end(){ended=true;}}
 await validateBillingProfile({config,password:'private-billing-secret-'.repeat(3),Pool:FakePool});
 assert.equal(options.user,BILLING_LOGIN);assert.equal(options.database,config.target.centralDatabase);assert.equal(options.ssl,config.target.ssl);assert.equal(ended,true);
});
