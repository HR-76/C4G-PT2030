async function documentPreflight(pool){if(!pool||typeof pool.query!=='function')throw new TypeError('F11 preflight requires a pool.');const result=await pool.query(`SELECT current_setting('server_version_num')::int AS version_num,to_regnamespace('document_storage') IS NOT NULL AS schema_exists,has_schema_privilege('c4g_document_runtime','document_storage','USAGE') AS runtime_usage`);const row=result.rows[0];if(!row||row.version_num<170000||row.version_num>=180000||!row.schema_exists||!row.runtime_usage)throw new Error('F11_DOCUMENT_SCHEMA_NOT_READY');return Object.freeze({ready:true,major:17,schemaFingerprint:require('./migrationManifest').entry.schemaFingerprint});}
async function documentTransportPreflight(pool){if(!pool||typeof pool.query!=='function')throw new TypeError('Document transport preflight requires a pool.');const result=await pool.query(`SELECT
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
   WHERE n.nspname='document_storage' AND c.relname='multipart_upload' AND r.rolname='c4g_document_owner'
     AND c.relrowsecurity AND c.relforcerowsecurity) AS multipart_table,
 (SELECT count(*)=1 AND bool_and(p.polpermissive AND p.polcmd='*' AND p.polroles=ARRAY[0::oid]
   AND pg_get_expr(p.polqual,p.polrelid,true)=pg_get_expr(p.polwithcheck,p.polrelid,true)
   AND pg_get_expr(p.polqual,p.polrelid,true) LIKE '%app.organization_id%')
   FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='document_storage' AND c.relname='multipart_upload' AND p.polname='multipart_upload_org_isolation') AS tenant_policy,
 has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','SELECT') AS runtime_read,
 NOT has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','INSERT')
   AND NOT has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','UPDATE')
   AND NOT has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','DELETE')
   AND NOT has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','TRUNCATE') AS runtime_write_closed,
 NOT has_table_privilege('c4g_document_runtime','document_storage.multipart_part','INSERT') AS direct_part_write_closed,
 to_regprocedure('document_storage.register_multipart_upload(uuid,uuid,uuid,text,timestamp with time zone)') IS NOT NULL AS register_function,
 to_regprocedure('document_storage.record_multipart_part(uuid,uuid,smallint,integer,character)') IS NOT NULL AS part_function,
 to_regprocedure('document_storage.finish_multipart_upload(uuid,uuid,text,text)') IS NOT NULL AS finish_function,
 to_regprocedure('document_storage.claim_expired_multipart_uploads(uuid,integer)') IS NOT NULL AS claim_function,
 to_regprocedure('document_storage.claim_document_transport_recovery(uuid,integer)') IS NOT NULL AS recovery_function,
 (SELECT count(*)=5 AND bool_and(r.rolname='c4g_document_owner' AND p.prosecdef
   AND array_to_string(p.proconfig,',')='search_path=pg_catalog, document_storage'
   AND has_function_privilege('c4g_document_runtime',p.oid,'EXECUTE')
   AND NOT has_function_privilege('public',p.oid,'EXECUTE'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
   WHERE n.nspname='document_storage' AND p.proname=ANY($1::text[])) AS functions_closed`, [[
 'register_multipart_upload','record_multipart_part','finish_multipart_upload',
 'claim_expired_multipart_uploads','claim_document_transport_recovery'
 ]]);const row=result.rows[0];if(!row||!Object.values(row).every(Boolean))throw new Error('DOCUMENT_TRANSPORT_SCHEMA_NOT_READY');return Object.freeze({ready:true,version:'031_application_document_transport'});}
module.exports={documentPreflight,documentTransportPreflight};
