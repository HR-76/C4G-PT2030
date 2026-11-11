'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAuthorityCoordinator:factory,isAuthorityCoordinator,scope,hash}=require('../src/security/authorityCoordinator');
const createAuthorityCoordinator=options=>factory({...options,permitSecret:'synthetic-permit-secret-not-a-production-key'});
const {createPreparedTaxonomyService}=require('../src/organizationalProfile/taxonomyService');
const {preparedAuthorityBinding}=require('../src/security/tenantLeaseExecutor');
const {migrationSql}=require('../src/security/centralMigrationManifest');

test('Central authority migration pins both up and down material SQL',()=>{
  for(const direction of ['up','down']){
    const migration=migrationSql('009_authority_commit_guard',direction);
    assert.equal(migration.acceptedChecksums.length,1);
    assert.throws(()=>migrationSql('009_authority_commit_guard',direction,()=>migration.sql+'\nSELECT 1;'),/checksum mismatch/);
  }
});

test('closed protocol query catalog exactly matches the pinned SQL function',()=>{
  const {queries}=require('../src/security/authorityProtocolQueries');
  const billing=require('../src/platformBilling/sql');
  const extensions=[
    {version:'member_email_delivery',queries:[require('../src/platformOnboarding/memberSql').emailDelivery],count:1,sql:require('../src/platformOnboarding/memberEmailSecurityPackage').load().sql},
    {version:'application_status_capture',queries:[require('../src/applications/statusEmails/capture').SQL],count:1,sql:require('../src/applications/statusEmails/securityPackage').load('central').sql},
    {version:'027_platform_billing',functionName:'authority_api.execute_platform_billing',delimiter:'$billing_authority$',queries:Object.values(billing),count:36},
    {version:'028_catalog_identity_authority',queries:Object.values(require('../src/security/identityQueries')),count:2},
    {version:'030_application_responsibles',queries:Object.values(require('../src/applications/responsibleQueries')),count:3},
    {version:'031_tenant_directory_resolution',queries:[require('../src/security/tenantDirectoryQueries').resolve],count:1},
    {version:'032_single_organization_membership',queries:[require('../src/platformOnboarding/sql').nonRemovedMembership],count:1}
  ];
  const extensionQueries=new Set(extensions.flatMap(extension=>extension.queries));
  // This exact observation is present in both the base executor and its billing fallback.
  const baseQueries=queries.filter(query=>!extensionQueries.has(query)||query===billing.organizationAvailable);
  const mappings=[{version:'025_entity_admission_completion',functionName:'authority_api.execute',delimiter:'$authority$',queries:baseQueries,count:167},...extensions];
  assert.equal(new Set(queries).size,queries.length);
  for(const mapping of mappings){
    const sql=mapping.sql||migrationSql(mapping.version,'up').sql;
    if(mapping.functionName){
      assert.ok(sql.includes(`FUNCTION ${mapping.functionName}(query_code text, parameters text[]`),mapping.version);
    }else{
      assert.ok(sql.includes("SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;"),mapping.version);
      assert.ok(sql.includes('EXECUTE replace(definition,needle,needle||$cases$'),mapping.version);
    }
    const parts=sql.split(mapping.delimiter||'$cases$');
    assert.equal(parts.length,3,mapping.version);
    const cases=[...parts[1].matchAll(/WHEN '([a-f0-9]{64})' THEN statement:='((?:''|[^'])*)';/g)];
    assert.equal(cases.length,mapping.count,mapping.version);
    assert.equal(new Set(mapping.queries).size,mapping.count,mapping.version);
    assert.deepEqual(cases.map(match=>match[1]).sort(),mapping.queries.map(hash).sort(),mapping.version);
    // Also compare statements: a correct hash beside different SQL must not pass.
    const byCode=(left,right)=>left[0].localeCompare(right[0]);
    assert.deepEqual(cases.map(match=>[match[1],match[2].replace(/''/g,"'")]).sort(byCode),mapping.queries.map(query=>[hash(query),query]).sort(byCode),mapping.version);
  }
  assert.deepEqual([...new Set(mappings.flatMap(mapping=>mapping.queries))].sort(),[...queries].sort());
  assert.throws(()=>factory({pool:{connect(){},query(){}}}),/Private durable authority permit secret/);
});

test('closed protocol rejects unknown and altered SQL before calling Central',async()=>{
  const {execute}=require('../src/security/authorityProtocolQueries');
  const {list}=require('../src/applications/responsibleQueries');
  const {resolve}=require('../src/security/tenantDirectoryQueries');
  let calls=0;
  const client={query:async()=>{calls++;throw new Error('Unknown SQL reached Central');}};
  for(const sql of ['SELECT 1',`${list}; SELECT 1`,list.replace('LIMIT 26','LIMIT 27'),resolve.replace("o.status='ACTIVE'","TRUE"),null,{text:list}]){
    await assert.rejects(()=>execute(client,sql),error=>error.code==='42501'&&error.message==='AUTHORITY_QUERY_DENIED');
  }
  assert.equal(calls,0);
});

test('member email delivery package is pinned and preserves invitation and receipt guards', () => {
  const {load}=require('../src/platformOnboarding/memberEmailSecurityPackage');
  const {sql}=load();
  assert.throws(()=>load(()=>sql+'\nSELECT 1;'),/MEMBER_EMAIL_SECURITY_CHECKSUM/);
  assert.match(sql,/MEMBER_EMAIL_PROTOCOL_SECURITY_DRIFT/);
  assert.match(sql,/MEMBER_EMAIL_OWNER_DRIFT/);
  assert.match(sql,/MEMBER_EMAIL_PROTOCOL_PATCH_POINT_INVALID/);
  assert.match(sql,/MEMBER_EMAIL_PROTOCOL_ALREADY_PRESENT/);
  const query=require('../src/platformOnboarding/memberSql').emailDelivery;
  assert.match(query,/operation_id=\$1 AND status='OPEN'/);
  assert.match(query,/phase='READY'/);
  assert.match(query,/NOT COALESCE/);
  assert.match(query,/status'<>'ACCEPTED'/);
});

test('F3 interpolated membership queries are explicitly in the closed catalog',async()=>{
  const {queries,normalize}=require('../src/security/authorityProtocolQueries');
  const repository=require('../src/security/membershipRepository').createMembershipRepository({query:async sql=>{
    assert.ok(queries.includes(normalize(sql)));return{rows:[]};}});
  await repository.listEligible('synthetic',Date.now());
  await repository.resolveEligible('synthetic','synthetic',Date.now());
  await repository.revalidateContext({organizationId:'synthetic',membershipId:'synthetic',membershipVersion:1},Date.now());
});
test('Central coordinator and F4 source bindings cannot be reconstructed from properties',()=>{
  assert.equal(isAuthorityCoordinator({write(){}}),false);
  assert.throws(()=>preparedAuthorityBinding({query(){}}));
  assert.throws(()=>createAuthorityCoordinator({pool:{query(){}}}));
});
test('authority coordination scope is ordered, stable, and contains only hashed session identity',()=>{
  const input={organizationId:'synthetic-org',subjectId:'synthetic-subject',membershipId:'synthetic-member',sessionDigest:hash('synthetic-session')};
  const keys=scope(input);assert.deepEqual(keys,[...keys].sort());assert.equal(keys.length,5);
  assert.equal(keys.some(key=>key.includes('synthetic-session')),false);assert.equal(input.sessionDigest.length,64);
});
test('transaction service cannot run on raw clients even with a locally fabricated context',async()=>{
  let sql=0;const context={organizationId:'synthetic'},contexts=new WeakSet([context]);
  const service=createPreparedTaxonomyService({contexts,protectAuthorization(){throw new Error('MUST_NOT_AUTHORIZE');}});
  await assert.rejects(()=>service.execute({query(){sql++;}},'createRelease',{},context),error=>error.code==='F13_AUTHORIZATION_REQUIRED');
  assert.equal(sql,0);
});
test('authority transaction deadline closes a stalled validation and releases its connection',async t=>{
  const admission=require('../src/security/authoritySecurityManifest');
  t.mock.method(admission,'assertAuthorityAdmission',async()=>{});
  t.mock.method(admission,'assertAuthoritySecurity',async()=>{});
  let released=false,rolledBack=false;
  const coordinator=createAuthorityCoordinator({timeoutMs:30,pool:{query:async()=>({rows:[]}),connect:async()=>({
    async query(sql,values){if(sql==='ROLLBACK')rolledBack=true;
      if(sql.includes('authority_api.execute')){
        const original=require('../src/security/authorityProtocolQueries').queries.find(q=>hash(q)===values[0]);
        return{rows:[{result:{rows:original.includes('SELECT state,deadline')?[{state:'WAITING',deadline:new Date(Date.now()+1000)}]:[],rowCount:0}}]};
      }
      return{rows:sql.includes('c4g_database_identity')?[{valid:true}]:[]};},release(){released=true;}})}});
  await assert.rejects(()=>coordinator.write(['POLICY'],()=>new Promise(()=>{})),error=>error.code==='AUTHORITY_DEADLINE');
  assert.equal(released,true);assert.equal(rolledBack,true);
});
test('late Central pool acquisition is discarded after the deadline',async()=>{
  let release=false;
  const coordinator=createAuthorityCoordinator({timeoutMs:10,pool:{query(){},async connect(){await new Promise(resolve=>setTimeout(resolve,25));return{release(){release=true;}};}}});
  await assert.rejects(()=>coordinator.write(['POLICY'],()=>{}),error=>error.code==='AUTHORITY_DEADLINE');
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(release,true);
});
