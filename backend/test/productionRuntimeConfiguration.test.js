'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateRuntimeConfig,validateRuntimeCredentials,buildRuntimeArtifacts,buildIdentityArtifacts,runtimeConfigDigest}=require('../scripts/productionBootstrap/runtimeConfiguration');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(){
 const bootstrapConfig={installationId:id(1),administrator:{issuer:'https://login.example.test/realms/production'},target:{host:'pg-production',port:5432,centralDatabase:'central_prod',tenantDatabase:'tenant_prod',expectedSystemIdentifier:'123',ssl:{rejectUnauthorized:true}},organization:{id:id(2),dataResidencyCode:'EU'},tenant:{id:id(3),generationId:id(4),credentialRef:'prod-api-v1',apiLogin:'prod_tenant_api',regionCode:'EU',residencyPolicyVersion:'production-eu-v1'}};
 const runtimeConfig={version:1,app:{origin:'https://app.example.test',oidcClientId:'production-web',trustedProxyHops:1,uiKeyId:'production-1'},identity:{issuer:bootstrapConfig.administrator.issuer,adminOrigin:'http://c4g-production-keycloak:8080',memberClientId:'production-member-worker',manualClientId:'production-member-manual',existingClientId:'production-member-existing',bridgeEndpoint:'http://c4g-activation-bridge:5285/bridge/check',certificate:null},email:{activationFrom:'C4G <activation@example.test>',billingFrom:'C4G <billing@example.test>',smtp:{host:'smtp.example.test',port:587,username:'provider-user',from:'auth@example.test',fromDisplayName:'C4G'}}};
 const runtimeCredentials={sessionSecret:'11'.repeat(32),editorialUiKey:'22'.repeat(32),oidcClientSecret:'oidc-'+ 'x'.repeat(40),memberBridgeSecret:'33'.repeat(32),memberOwnershipKey:'44'.repeat(32),memberClientSecret:'member-'+ 'x'.repeat(40),memberResendApiKey:'member-resend-'+ 'x'.repeat(40),emailAuthenticationClientSecret:'email-'+ 'x'.repeat(40),smtpPassword:'smtp-'+ 'x'.repeat(40),billingResendApiKey:'billing-resend-'+ 'x'.repeat(40),billingDatabasePassword:'billing-db-!#$%&'+ 'x'.repeat(40)};
 const tenantCredentials={tenantId:id(3),credentialRef:'prod-api-v1',connectionVersion:1,host:'pg-production',port:5432,database:'tenant_prod',login:'prod_tenant_api',password:'tenant-'+ 'x'.repeat(40),ssl:true};
 const manifest=require('../src/security/tenantMigrationManifest').accountIdentityErasureManifest.at(-1);
 const snapshot={organizationId:id(2),tenantId:id(3),databaseGenerationId:id(4),databaseRef:'tenant_prod',credentialRef:'prod-api-v1',observedSystemIdentifier:'123',connectionVersion:1,connectionRevision:3,fence:0,deploymentMode:'DATABASE_PER_ORGANIZATION',workload:'API',provisioningStatus:'READY',connectionState:'AVAILABLE',versionState:'VALIDATED',regionCode:'EU',residencyPolicyVersion:'production-eu-v1',schema:{currentVersion:'041_account_identity_erasure',schemaFingerprint:manifest.schemaFingerprint,compatibilityState:'COMPATIBLE',revision:2,verifiedCapabilities:Object.fromEntries(manifest.capabilities.map(c=>[c,true]))}};
 snapshot.bindingDigest=require('../src/security/localTenantCredentialAdapter').bindingDigest({...tenantCredentials,workload:'API'});
 return {bootstrapConfig,runtimeConfig,runtimeCredentials,tenantCredentials,snapshot};
}
const env=body=>Object.fromEntries(body.trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
test('runtime configuration is closed, explicit, immutable and bound to bootstrap issuer',()=>{
 const f=fixture(),config=validateRuntimeConfig(f.runtimeConfig,f.bootstrapConfig);
 assert.equal(Object.isFrozen(config.identity),true);assert.equal(config.app.origin,f.runtimeConfig.app.origin);
 for(const mutate of [c=>c.unknown='secret-canary',c=>c.app.origin='http://app.example.test',c=>c.identity.issuer='https://login.example.test/realms/other',c=>c.identity.adminOrigin='http://public.example.test',c=>c.identity.bridgeEndpoint='http://public.example.test/bridge/check',c=>c.app.trustedProxyHops='1',c=>c.identity.memberClientId=c.app.oidcClientId,c=>c.email.smtp.host='staging.internal',c=>c.identity.certificate='../private.pem']){
  const copy=structuredClone(f.runtimeConfig);mutate(copy);assert.throws(()=>validateRuntimeConfig(copy,f.bootstrapConfig),e=>e.message==='PRODUCTION_RUNTIME_CONFIG_INVALID');
 }
});
test('runtime secret validation is closed, independent and agrees with production secret contracts',()=>{
 const f=fixture();assert.equal(validateRuntimeCredentials(f.runtimeCredentials).memberBridgeSecret,f.runtimeCredentials.memberBridgeSecret);
 for(const mutate of [s=>s.unknown='private-canary',s=>s.sessionSecret='not-hex'.repeat(10),s=>s.memberBridgeSecret='AA'.repeat(32),s=>s.editorialUiKey=s.sessionSecret,s=>s.smtpPassword='REPLACE_SMTP_PASSWORD',s=>s.billingDatabasePassword='newline\n'+ 'x'.repeat(40)]){
  const copy=structuredClone(f.runtimeCredentials);mutate(copy);assert.throws(()=>validateRuntimeCredentials(copy),e=>e.message==='PRODUCTION_RUNTIME_CREDENTIALS_INVALID');
 }
});
test('generator selects all approved features while keeping provider mail secrets outside API environment',()=>{
 const f=fixture(),artifacts=buildRuntimeArtifacts(f),api=env(artifacts['api-features.env']),worker=JSON.parse(artifacts['member-worker.json']),http=JSON.parse(artifacts['member-http.json']);
 assert.equal(api.PROFILE_EDITORIAL_RUNTIME,'f13-editorial');assert.equal(api.PQ1_ACTIVATION_RUNTIME,'f13-f14-pq1');
 assert.equal(api.MEMBER_ONBOARDING_RUNTIME,'central');assert.equal(api.USER_DELETION_RUNTIME,'central');assert.equal(api.BILLING_VALIDATION_RUNTIME,'central');
 assert.equal(api.PLATFORM_ACCESS_RUNTIME,'central');
 assert.equal(api.EMAIL_AUTHENTICATION_RUNTIME,'keycloak-restricted-v1');assert.equal(api.EMAIL_HISTORY_RUNTIME,'central-keycloak-v1');
 assert.equal(api.AUTH_POLICY_VERSION,'c4g-user-mfa-v1');assert.equal(JSON.parse(api.AUTH_ASSURANCE_POLICY_JSON)['recent-auth'].mfa,false);
 assert.equal(api.MEMBER_ONBOARDING_DIRECTORY,'/run/private/members');assert.equal(api.RESEND_API_KEY,undefined);
 assert.equal(worker.tenantApiProfile,'production-editorial-v1');assert.deepEqual(worker.bindings,[{organizationId:f.bootstrapConfig.organization.id,credentials:f.tenantCredentials,snapshot:f.snapshot}]);
 assert.deepEqual(worker.email,{apiKey:f.runtimeCredentials.memberResendApiKey,from:f.runtimeConfig.email.activationFrom,origin:f.runtimeConfig.app.origin});
 assert.equal(http.bridgeSecret,f.runtimeCredentials.memberBridgeSecret);assert.equal(http.issuer,api.OIDC_ISSUER);
 for(const secret of [f.runtimeCredentials.memberClientSecret,f.runtimeCredentials.memberResendApiKey,f.runtimeCredentials.billingResendApiKey,f.runtimeCredentials.smtpPassword,f.runtimeCredentials.billingDatabasePassword])assert.equal(artifacts['api-features.env'].includes(secret),false);
 const billing=env(artifacts['billing-mail.env']);assert.equal(new URL(billing.BILLING_VALIDATION_DATABASE_URL).username,'c4g_prod_billing_mail');assert.equal(decodeURIComponent(new URL(billing.BILLING_VALIDATION_DATABASE_URL).password),f.runtimeCredentials.billingDatabasePassword);
 assert.equal(billing.RESEND_API_KEY,f.runtimeCredentials.billingResendApiKey);assert.equal(billing.EMAIL_AUTHENTICATION_CLIENT_SECRET,undefined);
});
test('only verified matching published tenant bindings can be exported',()=>{
 const f=fixture();
 for(const mutate of [x=>x.snapshot.organizationId=id(9),x=>x.snapshot.schema.currentVersion='040_chat_retention',x=>x.snapshot.provisioningStatus='RUNNING',x=>x.snapshot.observedSystemIdentifier='999',x=>x.snapshot.bindingDigest='b'.repeat(64),x=>x.snapshot.regionCode='US',x=>x.tenantCredentials.host='other-database',x=>x.tenantCredentials.ssl=false,x=>x.snapshot.deploymentMode='SHARED',x=>x.snapshot.connectionRevision=0,x=>x.snapshot.fence=-1,x=>x.snapshot.schema.compatibilityState='READ_ONLY',x=>x.snapshot.schema.revision=null,x=>x.snapshot.schema.verifiedCapabilities.APPLICATION_TEAM_CHAT=false]){
  const copy=structuredClone(f);mutate(copy);assert.throws(()=>buildRuntimeArtifacts(copy),e=>e.message==='PRODUCTION_RUNTIME_BINDING_INVALID');
 }
});
test('identity preparation needs no database state and produces restricted clients and optional MFA',()=>{
 const f=fixture(),files=buildIdentityArtifacts(f),realm=JSON.parse(files['keycloak-production.json']);
 assert.equal(realm.realm,'production');assert.equal(realm.registrationAllowed,false);assert.equal(realm.resetPasswordAllowed,true);
 const clients=Object.fromEntries(realm.clients.map(c=>[c.clientId,c]));assert.equal(clients['c4g-email-templates'].fullScopeAllowed,false);assert.equal(clients['c4g-email-templates'].serviceAccountsEnabled,true);
 const mailService=realm.users.find(u=>u.serviceAccountClientId==='c4g-email-templates');assert.deepEqual(mailService.clientRoles,{'c4g-email-templates':['publish-password-reset','read-delivery-history']});
 assert.ok(realm.eventsListeners.includes('c4g-email-delivery'));assert.equal(realm.smtpServer.starttls,'true');
 assert.equal(realm.requiredActions.find(a=>a.alias==='c4g-manual-password').defaultAction,false);
 assert.ok(realm.authenticationFlows.some(flow=>flow.authenticationExecutions?.some(e=>e.authenticator==='conditional-user-configured')));
 assert.match(files['c4g-activation.properties'],/^endpoint=http:\/\/c4g-activation-bridge:5285\/bridge\/check$/m);
 assert.ok(realm.users.every(u=>u.serviceAccountClientId&&!u.email&&!u.credentials));
 assert.equal(realm.defaultLocale,'pt');assert.deepEqual(realm.supportedLocales,['pt']);
 assert.deepEqual(clients['c4g-email-templates'].defaultClientScopes,['roles']);
 const component=realm.components['org.keycloak.userprofile.UserProfileProvider'][0];
 assert.equal(component.providerId,'declarative-user-profile');
 const profile=JSON.parse(component.config['kc.user.profile.config'][0]);
 assert.deepEqual(profile.attributes.find(a=>a.name==='c4g_onboarding_owner').permissions,{view:['admin'],edit:['admin']});
 assert.equal(profile.attributes.find(a=>a.name==='lastName').required,undefined);
});
test('SMTP sender is a bare mailbox, separate from its display name',()=>{
 const f=fixture();f.runtimeConfig.email.smtp.from='C4G <auth@example.test>';
 assert.throws(()=>validateRuntimeConfig(f.runtimeConfig),{code:'PRODUCTION_RUNTIME_CONFIG_INVALID'});
});
test('runtime intent digest is independent of property order and binds providers and service choices',()=>{
 const f=fixture(),reordered=Object.fromEntries(Object.entries(f.runtimeConfig).reverse());
 assert.equal(runtimeConfigDigest(reordered),runtimeConfigDigest(f.runtimeConfig));
 const changed=structuredClone(f.runtimeConfig);changed.email.activationFrom='different@example.test';assert.notEqual(runtimeConfigDigest(changed),runtimeConfigDigest(f.runtimeConfig));
});
test('generated settings satisfy the real auth, editorial and worker mail configuration contracts without provider I/O',()=>{
 const f=fixture(),files=buildRuntimeArtifacts(f),api={...env(files['api-features.env']),NODE_ENV:'production',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'300000'};
 const auth=require('../src/security/authConfig').loadAuthConfig(api);
 assert.equal(auth.privilegedLoginCategory,'recent-auth');assert.equal(auth.assurancePolicy['recent-auth'].mfa,false);assert.equal(auth.secureCookie,true);
 assert.equal(require('../src/config/editorialUi').editorialUiConfiguration(api).tokenKeyId,f.runtimeConfig.app.uiKeyId);
 const worker=JSON.parse(files['member-worker.json']);assert.deepEqual(require('../src/platformOnboarding/memberWorkerEmail').memberWorkerEmailConfiguration(worker,api),worker.email);
 const billing=env(files['billing-mail.env']);let contacted=false;
 assert.equal(typeof require('../src/billingValidation/worker').createValidationTransport({apiKey:billing.RESEND_API_KEY,from:billing.BILLING_EMAIL_FROM,origin:billing.PUBLIC_APP_URL,fetchImpl:()=>{contacted=true;throw Error('provider must not be contacted');}}),'function');
 assert.equal(contacted,false);
});
test('shipped runtime examples cannot activate with unresolved private inputs',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const read=name=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../deploy/production/'+name),'utf8'));
 assert.throws(()=>validateRuntimeConfig(read('runtime.config.example.json')),{code:'PRODUCTION_RUNTIME_CONFIG_INVALID'});
 assert.throws(()=>validateRuntimeCredentials(read('runtime.credentials.example.json')),{code:'PRODUCTION_RUNTIME_CREDENTIALS_INVALID'});
});
