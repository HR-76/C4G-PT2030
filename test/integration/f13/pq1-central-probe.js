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

const fs=require('node:fs'),path=require('node:path');
const sql=direction=>fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/migrations/012_pq1_intention_lookup.'+direction+'.sql'),'utf8');
await p.query(sql('up'));await snap('012');
await p.query(sql('down'));await snap('011-restored');
await p.query(sql('up'));await snap('012-reapply');
}finally{await p.end();}})().catch(e=>{console.error(e.message);process.exitCode=1});
