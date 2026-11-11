const {Pool}=require('../../../backend/node_modules/pg');
const {applyCentralMigrations,rollbackCentralMigration}=require('../../../backend/scripts/runCentralMigrations');
const {centralSchemaSnapshot,schemaFingerprint}=require('../../../backend/src/security/centralSchemaManifest');
const {authoritySecuritySnapshot,digest}=require('../../../backend/src/security/authoritySecurityManifest');
(async()=>{const target=new URL(process.env.F13_EDITORIAL_ADMIN_URL);
if(process.env.F13_EDITORIAL_DISPOSABLE_PROOF!=='C4G_F13_EDITORIAL_DISPOSABLE_V1'||target.hostname!=='127.0.0.1'||target.port!=='5575'||target.pathname!=='/postgres')throw new Error('Unsafe disposable target');
const p=new Pool({connectionString:target.toString()});try{
await p.query("CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN; CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
await applyCentralMigrations(p);
const snap=async version=>console.log(JSON.stringify({version,schemaFingerprint:schemaFingerprint(await centralSchemaSnapshot(p)),authoritySecurityFingerprint:digest(await authoritySecuritySnapshot(p))}));
await snap('010');
const assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto');
const {execute,intentionLookupQuery}=require('../../../backend/src/security/authorityProtocolQueries');
const {assertAuthorityAdmission}=require('../../../backend/src/security/authoritySecurityManifest');
const url=new URL(process.env.F13_EDITORIAL_ADMIN_URL);url.username='c4g_authority_runtime';url.password=randomBytes(32).toString('hex');
await p.query("ALTER ROLE c4g_authority_runtime PASSWORD '"+url.password+"'");
const runtime=new Pool({connectionString:url.toString()});
try {const c=await runtime.connect();try{await assertAuthorityAdmission(c);
const params=[randomUUID(),randomUUID(),randomUUID(),'EDITORIAL_PUBLISH',randomUUID()];
assert.deepEqual((await execute(c,intentionLookupQuery,params)).rows,[]);
await assert.rejects(()=>c.query('SELECT * FROM public.authority_commit_guard'),{code:'42501'});
await rollbackCentralMigration(p,'010');await snap('009');
await assert.rejects(()=>execute(c,intentionLookupQuery,params),{code:'42501'});await c.query('RESET ROLE');
await assert.rejects(()=>assertAuthorityAdmission(c),{code:'AUTHORITY_SECURITY_DRIFT'});
await applyCentralMigrations(p);await snap('010-reapply');await assertAuthorityAdmission(c);
console.log('CENTRAL_010_INSTALL_UPGRADE_DOWNGRADE_ADMISSION_ACL: PASS');
}finally{c.release();}}finally{await runtime.end();}
}finally{await p.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});
