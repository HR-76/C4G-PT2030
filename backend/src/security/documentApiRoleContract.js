'use strict';
const TABLES=['document','document_version','upload_capability','scan_result','reconciliation_finding'];
const FUNCTIONS=['consume_upload_capability','transition_version','confirm_version','register_multipart_upload','record_multipart_part','finish_multipart_upload','claim_expired_multipart_uploads','claim_document_transport_recovery'];
async function validateDocumentRole(client){
 const rows=(await client.query(`WITH grants AS (
 SELECT 'SCHEMA' kind,n.nspname object_name,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
 UNION ALL SELECT 'TABLE',n.nspname||'.'||c.relname,a.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
 UNION ALL SELECT 'COLUMN',n.nspname||'.'||c.relname||'.'||t.attname,a.* FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a
 UNION ALL SELECT 'FUNCTION',n.nspname||'.'||p.proname,a.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
 UNION ALL SELECT 'TYPE',n.nspname||'.'||t.typname,a.* FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(t.typacl) a
 UNION ALL SELECT 'DATABASE',d.datname,a.* FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a)
 SELECT kind,object_name,privilege_type,is_grantable FROM grants WHERE grantee=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime') ORDER BY 1,2,3`)).rows;
 const expected=new Set(['SCHEMA:document_storage:USAGE',...TABLES.flatMap(name=>['SELECT','INSERT'].map(p=>`TABLE:document_storage.${name}:${p}`)),...['multipart_part','multipart_upload'].map(name=>`TABLE:document_storage.${name}:SELECT`),...FUNCTIONS.map(name=>`FUNCTION:document_storage.${name}:EXECUTE`)]);
 for(const row of rows){const key=`${row.kind}:${row.object_name}:${row.privilege_type}`;if(row.is_grantable||!expected.delete(key))throw Error('DOCUMENT_API_DOCUMENT_ACL_DRIFT');}if(expected.size)throw Error('DOCUMENT_API_DOCUMENT_ACL_DRIFT');
 const bad=(await client.query(`SELECT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime')) OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime')) OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime')) OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime')) OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime')) AS bad`)).rows[0];
 if(bad?.bad!==false)throw Error('DOCUMENT_API_DOCUMENT_ROLE_DRIFT');
 return Object.freeze({permissions:rows.length});
}
module.exports={validateDocumentRole};
