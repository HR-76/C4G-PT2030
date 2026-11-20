'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('lifecycle CLI accepts only explicit closed arguments',()=>{
 const {parseArguments}=require('../scripts/installPlatformAccountLifecycle');
 assert.deepEqual(parseArguments(['--expected-database','c4g_production']),{expectedDatabase:'c4g_production',apply:false});
 assert.deepEqual(parseArguments(['--apply','--expected-database','c4g_production']),{expectedDatabase:'c4g_production',apply:true});
 for(const args of [['--unknown'],['--apply','--apply'],['--expected-database'],['--expected-database','--apply'],['--credentials','file'],['--expected-database','one','--expected-database','two']])assert.throws(()=>parseArguments(args),/PRODUCTION_ARGUMENT_INVALID/);
});
test('lifecycle installer refuses staging, wrong targets and incomplete predecessors without mutation',async()=>{
 const {install}=require('../scripts/installPlatformAccountLifecycle');
 let mutations=0;
 const pool={async query(sql){assert.equal(sql,'SELECT current_database() AS name');return {rows:[{name:'c4g_production'}]};},connect(){mutations++;throw Error('Unexpected mutation');}};
 for(const expectedDatabase of [undefined,'staging','c4g_staging','bad-name'])await assert.rejects(install(pool,{expectedDatabase,apply:true}),/PRODUCTION_TARGET_REQUIRED/);
 await assert.rejects(install(pool,{expectedDatabase:'other_database',apply:true}),/PRODUCTION_TARGET_MISMATCH/);
 assert.equal(mutations,0);
});
test('lifecycle plan performs exact preflight; apply is explicit and never provisions logins',async t=>{
 const {install}=require('../scripts/installPlatformAccountLifecycle');
 const preflight=require('../src/security/centralMigrationPreflight'),runner=require('../scripts/runCentralMigrations');
 let currentVersion='057_production_central_permissions',calls=0;
 t.mock.method(preflight,'preflightCentral',async()=>({currentVersion}));
 t.mock.method(runner,'applyRegisteredPlatformAccountLifecyclePackage',async(_pool,pkg)=>{assert.equal(pkg,'platform-account-lifecycle-v1');calls++;return currentVersion==='058_platform_account_lifecycle'?[]:['058_platform_account_lifecycle'];});
 const pool={query:async()=>({rows:[{name:'c4g_production'}]})};
 const plan=await install(pool,{expectedDatabase:'c4g_production'});
 assert.equal(plan.apply,false);assert.equal(plan.currentVersion,currentVersion);assert.equal(calls,0);
 assert.deepEqual((await install(pool,{expectedDatabase:'c4g_production',apply:true})).applied,['058_platform_account_lifecycle']);assert.equal(calls,1);
 currentVersion='058_platform_account_lifecycle';
 assert.deepEqual((await install(pool,{expectedDatabase:'c4g_production',apply:true})).applied,[]);
 currentVersion='056_email_delivery_history';
 await assert.rejects(install(pool,{expectedDatabase:'c4g_production',apply:true}),/PLATFORM_ACCOUNT_LIFECYCLE_BASELINE_REQUIRED/);
 assert.equal(calls,2);
});
