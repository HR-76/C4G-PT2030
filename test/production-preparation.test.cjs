'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.join(root,'deploy/production');
const read=name=>fs.readFileSync(path.join(base,name),'utf8');
const env=name=>Object.fromEntries(read(name).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const at=line.indexOf('=');assert.ok(at>0);return [line.slice(0,at),line.slice(at+1)];}));
const compose=require('../backend/node_modules/yaml').parse(read('compose.yaml'));

test('candidate compose has its own project, networks, paths and loopback endpoint',()=>{
 assert.equal(compose.name,'c4g-production-app');
 assert.deepEqual(compose.services.pod.ports,['127.0.0.1:8600:5000']);
 assert.equal(compose.networks.data.name,'c4g-production-data');
 assert.equal(compose.networks.identity.name,'c4g-production-identity');
 assert.equal(compose.volumes['clamav-db'].name,'c4g-production-clamav-db');
 assert.doesNotMatch(read('compose.yaml'),/c4g-staging|\/srv\/c4g-staging|8500|network_mode:\s*host|docker.sock/);
 for(const service of Object.values(compose.services)){
  assert.ok(service.profiles.length,'every service needs explicit admission');
  assert.match(service.image,/^\$\{C4G_PRODUCTION_.*:\?/,'no mutable image fallback');
  assert.ok(service.mem_limit);
 }
 assert.deepEqual(Object.keys(compose.services).sort(),['api','clamav','migrate','pod','retention']);
});

test('API and scanner share only the stable production pod, with readiness gating',()=>{
 assert.equal(compose.services.api.network_mode,'service:pod');
 assert.equal(compose.services.clamav.network_mode,'service:pod');
 assert.equal(compose.services.api.depends_on.clamav.condition,'service_healthy');
 assert.match(compose.services.api.healthcheck.test.at(-1),/127\.0\.0\.1:5000\/health\/ready/);
 assert.equal(compose.services.api.read_only,true);
 assert.deepEqual(compose.services.api.cap_drop,['ALL']);
 assert.match(read('Dockerfile'),/^USER node$/m);
});

test('privileged migration credentials and retention credentials never enter API or each other',()=>{
 const files=name=>compose.services[name].env_file.map(item=>item.path);
 assert.equal(files('api').length,1);assert.match(files('api')[0],/\/api.env$/);
 assert.match(files('migrate')[0],/\/install.env$/);assert.match(files('retention')[0],/\/retention.env$/);
 assert.doesNotMatch(JSON.stringify(compose.services.api),/install.env|central-logins.json|retention.env/);
 assert.doesNotMatch(JSON.stringify(compose.services.retention),/api.env|install.env|central-logins.json/);
 assert.equal(compose.services.migrate.command.includes('--apply'),false);
 assert.equal(compose.services.migrate.restart,'no');assert.equal(compose.services.retention.restart,'no');
 assert.deepEqual(Object.keys(env('retention.env.example')).sort(),['CENTRAL_EMAIL_RETENTION_DATABASE_URL','NODE_ENV']);
 assert.deepEqual(Object.keys(env('install.env.example')).sort(),['NODE_ENV','PRODUCTION_INSTALL_DATABASE_URL']);
});

test('six API credential names map to the actual production capability contract with verified TLS',()=>{
 const values=env('api.env.example');
 const {configuration,VARIABLES}=require('../backend/src/security/productionCentralProfile');
 const {LOGINS}=require('../backend/scripts/installProductionCentral');
 assert.equal(Object.keys(configuration(values)).length,4);
 const names=[...Object.values(VARIABLES),'AUTHORITY_DATABASE_URL','CATALOG_DATABASE_URL'];
 for(const [capability,name] of Object.entries(VARIABLES))assert.equal(new URL(values[name]).username,LOGINS[capability]);
 assert.equal(new URL(values.CATALOG_DATABASE_URL).username,LOGINS.catalog);
 for(const name of names){
  const parsed=new URL(values[name]);assert.equal(parsed.searchParams.get('sslmode'),'verify-full');
  require('../backend/src/config/databaseConfig').databasePoolOptions(values,name,'CENTRAL_DB');
 }
 assert.equal(new URL(values.CENTRAL_DATABASE_URL).pathname,'/c4g_central_production');
 assert.equal(values.PUBLIC_APP_URL,'https://gcni.c4g.ai');
 assert.equal(new URL(values.OIDC_ISSUER).origin,'https://login.c4g.ai');
 assert.equal(new URL(values.OIDC_REDIRECT_URI).origin,values.PUBLIC_APP_URL);
 assert.equal(new URL(values.OIDC_POST_LOGOUT_REDIRECT_URI).origin,values.PUBLIC_APP_URL);
 assert.equal(values.C4G_STAGING_CENTRAL_RUNTIME_LOGINS,undefined);
});

test('auth template fails until secrets are supplied and uses the registered MFA-optional policy',()=>{
 const values=env('api.env.example'),{loadAuthConfig}=require('../backend/src/security/authConfig');
 assert.throws(()=>loadAuthConfig(values),/SESSION_SECRET/);
 const synthetic={...values,SESSION_SECRET:'a'.repeat(64),AUTHORITY_COMMIT_PERMIT_SECRET:'b'.repeat(64),PROFILE_EDITORIAL_UI_KEYS_JSON:JSON.stringify({'production-1':'c'.repeat(64)})};
 assert.equal(loadAuthConfig(synthetic).policyVersion,'c4g-user-mfa-v1');
 assert.equal(require('../backend/src/config/editorialUi').editorialUiConfiguration(synthetic).tokenKeyId,'production-1');
 assert.equal(values.TRUST_PROXY_HOPS,'REPLACE_VERIFIED_HOP_COUNT');
 assert.equal(values.C4G_R2_LAYER_C_VALIDATED,'false');
 assert.equal(values.C4G_R2_MULTIPART_CONDITIONAL_VALIDATED,'false');
 assert.ok(Object.values(env('release.env.example')).every(value=>value===''));
});

test('profiles preserve manual/PT2030 and PDF while explicitly keeping unsupported variants out of rehearsal',()=>{
 const values=env('api.env.example');
 for(const [name,value] of Object.entries({FUNDING_TENDERS_RUNTIME:'central',FUNDING_TENDERS_SOURCE:'unconfigured',CENTRAL_PT2030_IMPORT_RUNTIME:'catalog',BILLING_PDF_RUNTIME:'private',DOCUMENTS_RUNTIME:'disabled',OPPORTUNITY_IMPORTS_RUNTIME:'disabled',OPPORTUNITY_ACTIVATION_RUNTIME:'disabled',CATALOG_READ_RUNTIME:'disabled',MEMBER_ONBOARDING_RUNTIME:'disabled',USER_DELETION_RUNTIME:'disabled'}))assert.equal(values[name],value);
 assert.equal(values.C4G_CLAMAV_HOST,'127.0.0.1');
 assert.equal(values.F12_RECEIPT_RECOVERY_DATABASE_URL,undefined);
 assert.match(read('api.env.example'),/NOT approval to remove those features/);
});

test('unfilled password sample is refused by the real installer before any mutation',async()=>{
 const installer=require('../backend/scripts/installProductionCentral');
 const passwords=JSON.parse(read('central-logins.json.example'));
 assert.deepEqual(Object.keys(passwords).sort(),Object.keys(installer.LOGINS).sort());
 let queries=0;
 await assert.rejects(installer.install({async query(sql){queries++;assert.equal(sql,'SELECT current_database() AS name');return {rows:[{name:'c4g_central_production'}]};}},{expectedDatabase:'c4g_central_production',apply:true,passwords}),/PRIVATE_CREDENTIALS_REQUIRED/);
 assert.equal(queries,1);
});
