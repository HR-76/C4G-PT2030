SET ROLE c4g_document_owner;
DROP FUNCTION document_storage.claim_document_transport_recovery(uuid,integer);
DROP FUNCTION document_storage.claim_expired_multipart_uploads(uuid,integer);
DROP FUNCTION document_storage.finish_multipart_upload(uuid,uuid,text,text);
DROP FUNCTION document_storage.record_multipart_part(uuid,uuid,smallint,integer,char);
DROP FUNCTION document_storage.register_multipart_upload(uuid,uuid,uuid,text,timestamptz);
DROP TABLE document_storage.multipart_upload;
GRANT INSERT ON document_storage.multipart_part TO c4g_document_runtime;
RESET ROLE;
