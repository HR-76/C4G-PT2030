'use strict';
const {createHash}=require('node:crypto');
const {isSecretHex}=require('../../src/security/secretFormat');
const {bindingDigest}=require('../../src/security/localTenantCredentialAdapter');
const {accountIdentityErasureManifest}=require('../../src/security/tenantMigrationManifest');
const PROFILE='production-editorial-v1';
const SECRET_KEYS=Object.freeze(['sessionSecret','editorialUiKey','oidcClientSecret','memberBridgeSecret','memberOwnershipKey','memberClientSecret','memberResendApiKey','emailAuthenticationClientSecret','smtpPassword','billingResendApiKey','billingDatabasePassword']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const invalid=()=>fail('PRODUCTION_RUNTIME_CONFIG_INVALID');
function object(value,keys,code='PRODUCTION_RUNTIME_CONFIG_INVALID'){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
  ||Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(code);
 return value;
}
function text(value,max=200){if(typeof value!=='string'||!value.length||value.length>max||value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value)||/REPLACE|staging/i.test(value))invalid();return value;}
function origin(value,{admin=false}={}){
 text(value,2048);let url;try{url=new URL(value);}catch{invalid();}
 const privateHttp=admin&&url.protocol==='http:'&&['c4g-production-keycloak','c4g-rehearsal-keycloak'].includes(url.hostname)&&url.port==='8080';
 if((url.protocol!=='https:'&&!privateHttp)||url.origin!==value||url.username||url.password)invalid();return value;
}
function client(value){text(value,100);if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value))invalid();return value;}
function sender(value){text(value,254);if(!/^(?:[^<>]+ <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value)||value.includes('<')!==value.endsWith('>'))invalid();return value;}
function mailbox(value){sender(value);if(/[<>\s]/.test(value))invalid();return value;}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function validateRuntimeConfig(raw,bootstrapConfig){
 object(raw,['version','app','identity','email']);if(raw.version!==1)invalid();
 const app=object(raw.app,['origin','oidcClientId','trustedProxyHops','uiKeyId']);
 const identity=object(raw.identity,['issuer','adminOrigin','memberClientId','manualClientId','existingClientId','bridgeEndpoint','certificate']);
 const email=object(raw.email,['activationFrom','billingFrom','smtp']),smtp=object(email.smtp,['host','port','username','from','fromDisplayName']);
 let issuer;try{issuer=new URL(identity.issuer);}catch{invalid();}
 if(issuer.protocol!=='https:'||issuer.href!==identity.issuer||issuer.search||issuer.hash||issuer.username||issuer.password||!/^\/realms\/[a-zA-Z0-9_-]+$/.test(issuer.pathname))invalid();
 text(identity.issuer,2048);
 if(bootstrapConfig&&identity.issuer!==bootstrapConfig.administrator?.issuer)invalid();
 if(!Number.isInteger(app.trustedProxyHops)||app.trustedProxyHops<1||app.trustedProxyHops>5)invalid();
 if(identity.bridgeEndpoint!=='http://c4g-activation-bridge:5285/bridge/check')invalid();
 if(identity.certificate!==null&&(typeof identity.certificate!=='string'||!/^\/certs\/[a-zA-Z0-9._-]+\.pem$/.test(identity.certificate)||identity.certificate.includes('..')))invalid();
 text(smtp.host,253);if(!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(smtp.host)||![465,587].includes(smtp.port))invalid();
 const ids=[app.oidcClientId,identity.memberClientId,identity.manualClientId,identity.existingClientId,'c4g-email-templates'].map(client);
 if(new Set(ids).size!==ids.length)invalid();
 return freeze({version:1,app:{origin:origin(app.origin),oidcClientId:ids[0],trustedProxyHops:app.trustedProxyHops,uiKeyId:client(app.uiKeyId)},
  identity:{issuer:identity.issuer,adminOrigin:origin(identity.adminOrigin,{admin:true}),memberClientId:ids[1],manualClientId:ids[2],existingClientId:ids[3],bridgeEndpoint:identity.bridgeEndpoint,certificate:identity.certificate},
  email:{activationFrom:sender(email.activationFrom),billingFrom:sender(email.billingFrom),smtp:{host:smtp.host,port:smtp.port,username:text(smtp.username),from:mailbox(smtp.from),fromDisplayName:text(smtp.fromDisplayName)}}});
}
function validateRuntimeCredentials(raw){
 const code='PRODUCTION_RUNTIME_CREDENTIALS_INVALID';object(raw,SECRET_KEYS,code);
 const values=SECRET_KEYS.map(key=>raw[key]);
 if(values.some(value=>typeof value!=='string'||value.length<32||value.length>4096||/[^\x21-\x7e]/.test(value)||/REPLACE/i.test(value))||new Set(values).size!==values.length)fail(code);
 for(const key of ['sessionSecret','editorialUiKey','memberOwnershipKey'])if(!isSecretHex(raw[key]))fail(code);
 if(!/^[a-f0-9]{64}$/.test(raw.memberBridgeSecret))fail(code);
 return freeze(Object.fromEntries(SECRET_KEYS.map(key=>[key,raw[key]])));
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const runtimeConfigDigest=config=>createHash('sha256').update(JSON.stringify(canonical(validateRuntimeConfig(config)))).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
function technicalUuid(issuer,label){const b=createHash('sha256').update(issuer+':'+label).digest().subarray(0,16);b[6]=(b[6]&15)|0x50;b[8]=(b[8]&63)|0x80;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function buildIdentityArtifacts({runtimeConfig:raw,runtimeCredentials:privateInput}){
 const c=validateRuntimeConfig(raw),s=validateRuntimeCredentials(privateInput),realm=new URL(c.identity.issuer).pathname.split('/').at(-1);
 const browser='c4g-production-optional-browser',forms=browser+'-forms',otp=browser+'-otp',manual='c4g-production-member-activation';
 const flowId=alias=>technicalUuid(c.identity.issuer,alias);
 const execution=(authenticator,requirement,priority,authenticatorConfig)=>({authenticator,requirement,priority,authenticatorFlow:false,userSetupAllowed:false,...(authenticatorConfig?{authenticatorConfig}:{})});
 const sub=(alias,requirement,priority)=>({flowAlias:alias,requirement,priority,authenticatorFlow:true,userSetupAllowed:false});
 const flow=(alias,topLevel,authenticationExecutions)=>({id:flowId(alias),alias,providerId:'basic-flow',topLevel,builtIn:false,authenticationExecutions});
 const browserClient=(clientId,callback,browserId,secret)=>({clientId,enabled:true,protocol:'openid-connect',publicClient:!secret,...(secret?{secret}:{}),standardFlowEnabled:true,directAccessGrantsEnabled:false,serviceAccountsEnabled:false,fullScopeAllowed:false,
  rootUrl:c.app.origin,redirectUris:[c.app.origin+callback],webOrigins:[c.app.origin],defaultClientScopes:['profile','email','roles'],
  attributes:{'pkce.code.challenge.method':'S256','post.logout.redirect.uris':c.app.origin+'/login','default.acr.values':'c4g-loa1','minimum.acr.value':'c4g-loa1'},
  authenticationFlowBindingOverrides:{browser:browserId},protocolMappers:[{name:'c4g-amr',protocol:'openid-connect',protocolMapper:'oidc-amr-mapper',config:{'id.token.claim':'true','access.token.claim':'true','lightweight.claim':'false'}}]});
 const serviceClient=(clientId,secret)=>({clientId,secret,enabled:true,protocol:'openid-connect',publicClient:false,standardFlowEnabled:false,directAccessGrantsEnabled:false,serviceAccountsEnabled:true,fullScopeAllowed:false,defaultClientScopes:['roles'],protocolMappers:[{name:'service-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':clientId,'access.token.claim':'true','id.token.claim':'false'}}]});
 const mailRoles=['publish-password-reset','read-delivery-history'],memberRoles=['manage-users','view-users','query-users'];
 const profile={attributes:[
  {name:'username',permissions:{view:['admin','user'],edit:['admin','user']},validations:{length:{min:3,max:255},'username-prohibited-characters':{},'up-username-not-idn-homograph':{}}},
  {name:'email',required:{roles:['user']},permissions:{view:['admin','user'],edit:['admin','user']},validations:{email:{},length:{max:255}}},
  ...['firstName','lastName'].map(name=>({name,permissions:{view:['admin','user'],edit:['admin','user']},validations:{length:{max:255},'person-name-prohibited-characters':{}}})),
  {name:'c4g_onboarding_owner',multivalued:false,permissions:{view:['admin'],edit:['admin']}}],groups:[]};
 const desired={realm,enabled:true,displayName:'C4G',sslRequired:'external',registrationAllowed:false,resetPasswordAllowed:true,editUsernameAllowed:false,loginWithEmailAllowed:true,duplicateEmailsAllowed:false,bruteForceProtected:true,passwordPolicy:'length(12)',
  loginTheme:'c4g',accountTheme:'c4g',browserFlow:browser,internationalizationEnabled:true,supportedLocales:['pt'],defaultLocale:'pt',attributes:{'acr.loa.map':JSON.stringify({'c4g-loa1':1,'c4g-loa2':2})},eventsEnabled:false,eventsListeners:['jboss-logging','c4g-email-delivery'],
  smtpServer:{host:c.email.smtp.host,port:String(c.email.smtp.port),user:c.email.smtp.username,password:s.smtpPassword,from:c.email.smtp.from,fromDisplayName:c.email.smtp.fromDisplayName,auth:'true',ssl:String(c.email.smtp.port===465),starttls:String(c.email.smtp.port===587)},
  clients:[browserClient(c.app.oidcClientId,'/api/auth/oidc/callback',flowId(browser),s.oidcClientSecret),browserClient(c.identity.manualClientId,'/api/activation/callback',flowId(manual)),browserClient(c.identity.existingClientId,'/api/activation/callback',flowId(browser)),serviceClient(c.identity.memberClientId,s.memberClientSecret),serviceClient('c4g-email-templates',s.emailAuthenticationClientSecret)],
  roles:{client:{'c4g-email-templates':mailRoles.map(name=>({name}))}},clientScopeMappings:{'realm-management':[{client:c.identity.memberClientId,roles:memberRoles}],'c4g-email-templates':[{client:'c4g-email-templates',roles:mailRoles}]},
  users:[{username:'service-account-'+c.identity.memberClientId,enabled:true,serviceAccountClientId:c.identity.memberClientId,clientRoles:{'realm-management':memberRoles}},{username:'service-account-c4g-email-templates',enabled:true,serviceAccountClientId:'c4g-email-templates',clientRoles:{'c4g-email-templates':mailRoles}}],
  authenticationFlows:[flow(browser,true,[execution('auth-cookie','ALTERNATIVE',10),sub(forms,'ALTERNATIVE',20)]),flow(forms,false,[execution('auth-username-password-form','REQUIRED',10,'c4g-password-amr'),sub(otp,'CONDITIONAL',20)]),flow(otp,false,[execution('conditional-user-configured','REQUIRED',10),execution('auth-otp-form','REQUIRED',20,'c4g-otp-amr')]),flow(manual,true,[execution('c4g-manual-manual','REQUIRED',10)])],
  authenticatorConfig:[{alias:'c4g-password-amr',config:{'default.reference.value':'pwd','default.reference.maxAge':'300'}},{alias:'c4g-otp-amr',config:{'default.reference.value':'otp','default.reference.maxAge':'300'}}],
  requiredActions:[{alias:'c4g-manual-password',name:'Definir password C4G',providerId:'c4g-manual-password',enabled:true,defaultAction:false,priority:10}],
  // Keycloak 26.8 declarative profile component; only administrators can write the ownership evidence.
  components:{'org.keycloak.userprofile.UserProfileProvider':[{providerId:'declarative-user-profile',config:{'kc.user.profile.config':[JSON.stringify(profile)]}}]}};
 return {'keycloak-production.json':json(desired),'c4g-activation.properties':`realm=${realm}\nclient=${c.identity.manualClientId}\nendpoint=${c.identity.bridgeEndpoint}\nsecret=${s.memberBridgeSecret}\n`};
}
function assertBinding({bootstrapConfig:c,tenantCredentials:t,snapshot:s}){
 const invalid=()=>fail('PRODUCTION_RUNTIME_BINDING_INVALID'),last=accountIdentityErasureManifest.at(-1);
 if(!c||!t||!s||s.organizationId!==c.organization.id||s.tenantId!==c.tenant.id||s.databaseGenerationId!==c.tenant.generationId
  ||s.databaseRef!==c.target.tenantDatabase||s.credentialRef!==c.tenant.credentialRef||s.observedSystemIdentifier!==c.target.expectedSystemIdentifier
  ||s.connectionVersion!==1||s.workload!=='API'||s.provisioningStatus!=='READY'||s.connectionState!=='AVAILABLE'||s.versionState!=='VALIDATED'
  ||s.deploymentMode!=='DATABASE_PER_ORGANIZATION'||!Number.isSafeInteger(s.connectionRevision)||s.connectionRevision<1||!Number.isSafeInteger(s.fence)||s.fence<0
  ||s.regionCode!==c.tenant.regionCode||s.residencyPolicyVersion!==c.tenant.residencyPolicyVersion
  ||s.schema?.currentVersion!==last.version||s.schema.schemaFingerprint!==last.schemaFingerprint||s.schema.compatibilityState!=='COMPATIBLE'
  ||!Number.isSafeInteger(s.schema.revision)||s.schema.revision<1||last.capabilities.some(code=>s.schema.verifiedCapabilities?.[code]!==true)
  ||t.tenantId!==c.tenant.id||t.credentialRef!==c.tenant.credentialRef||t.connectionVersion!==1||t.host!==c.target.host||t.port!==c.target.port
  ||t.database!==c.target.tenantDatabase||t.login!==c.tenant.apiLogin||t.ssl!==Boolean(c.target.ssl)||typeof t.password!=='string'||t.password.length<32)invalid();
 try{if(s.bindingDigest!==bindingDigest({...t,workload:'API'}))invalid();}catch{invalid();}
}
function buildRuntimeArtifacts({bootstrapConfig,runtimeConfig:raw,runtimeCredentials:privateInput,tenantCredentials,snapshot}){
 const c=validateRuntimeConfig(raw,bootstrapConfig),s=validateRuntimeCredentials(privateInput);assertBinding({bootstrapConfig,tenantCredentials,snapshot});
 const http={installationId:bootstrapConfig.installationId,issuer:c.identity.issuer,origin:c.app.origin,manualClientId:c.identity.manualClientId,existingClientId:c.identity.existingClientId,bridgeSecret:s.memberBridgeSecret,dataResidencyCode:bootstrapConfig.organization.dataResidencyCode};
 const worker={issuer:c.identity.issuer,adminOrigin:c.identity.adminOrigin,clientId:c.identity.memberClientId,clientSecret:s.memberClientSecret,ownershipKey:s.memberOwnershipKey,purpose:'MEMBERSHIP',tenantApiProfile:PROFILE,
  ...(c.identity.certificate?{certificate:c.identity.certificate}:{}),allowedResidency:[{regionCode:snapshot.regionCode,policyVersion:snapshot.residencyPolicyVersion}],bindings:[{organizationId:bootstrapConfig.organization.id,credentials:tenantCredentials,snapshot}],email:{apiKey:s.memberResendApiKey,from:c.email.activationFrom,origin:c.app.origin}};
 const api={PUBLIC_APP_URL:c.app.origin,CORS_ORIGIN:c.app.origin,AUTH_MODE:'oidc',OIDC_ISSUER:c.identity.issuer,OIDC_CLIENT_ID:c.app.oidcClientId,OIDC_CLIENT_SECRET:s.oidcClientSecret,OIDC_REDIRECT_URI:c.app.origin+'/api/auth/oidc/callback',OIDC_POST_LOGOUT_REDIRECT_URI:c.app.origin+'/login',SESSION_COOKIE_NAME:'__Host-c4g_production_session',SESSION_SECRET:s.sessionSecret,AUTH_POLICY_VERSION:'c4g-user-mfa-v1',PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',
  AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':{mfa:false,maxAgeSeconds:300,acceptedAcr:['c4g-loa1'],acceptedAmr:['pwd'],amrMode:'any'}}),TRUST_PROXY_HOPS:c.app.trustedProxyHops,
  CENTRAL_API_ORGANIZATIONS_JSON:JSON.stringify([bootstrapConfig.organization.id]),OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([tenantCredentials]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify(worker.allowedResidency),
  PROFILE_EDITORIAL_RUNTIME:'f13-editorial',PQ1_ACTIVATION_RUNTIME:'f13-f14-pq1',PROFILE_EDITORIAL_UI_KEY_ID:c.app.uiKeyId,PROFILE_EDITORIAL_UI_KEYS_JSON:JSON.stringify({[c.app.uiKeyId]:s.editorialUiKey}),
  PLATFORM_ACCESS_RUNTIME:'central',MEMBER_ONBOARDING_RUNTIME:'central',MEMBER_ONBOARDING_DIRECTORY:'/run/private/members',MEMBER_ACTIVATION_BRIDGE_HOST:'0.0.0.0',MEMBER_ACTIVATION_BRIDGE_PORT:5285,USER_DELETION_RUNTIME:'central',BILLING_VALIDATION_RUNTIME:'central',EMAIL_AUTHENTICATION_RUNTIME:'keycloak-restricted-v1',EMAIL_AUTHENTICATION_CLIENT_SECRET:s.emailAuthenticationClientSecret,EMAIL_HISTORY_RUNTIME:'central-keycloak-v1'};
 const url=new URL('postgresql://localhost');url.hostname=bootstrapConfig.target.host.includes(':')?'['+bootstrapConfig.target.host+']':bootstrapConfig.target.host;url.port=String(bootstrapConfig.target.port);url.pathname='/'+bootstrapConfig.target.centralDatabase;url.username='c4g_prod_billing_mail';url.password=encodeURIComponent(s.billingDatabasePassword);url.searchParams.set('sslmode','verify-full');
 const billing={NODE_ENV:'production',PUBLIC_APP_URL:c.app.origin,BILLING_VALIDATION_DATABASE_URL:url.href,RESEND_API_KEY:s.billingResendApiKey,BILLING_EMAIL_FROM:c.email.billingFrom,...(bootstrapConfig.target.ssl?.ca?{NODE_EXTRA_CA_CERTS:'/certs/ca.pem'}:{})};
 const env=value=>Object.entries(value).map(([key,value])=>key+'='+value).join('\n')+'\n';
 return {...buildIdentityArtifacts({runtimeConfig:c,runtimeCredentials:s}),'member-http.json':json(http),'member-worker.json':json(worker),'api-features.env':env(api),'billing-mail.env':env(billing)};
}
module.exports={validateRuntimeConfig,validateRuntimeCredentials,runtimeConfigDigest,buildRuntimeArtifacts,buildIdentityArtifacts,SECRET_KEYS};
