SET ROLE c4g_document_owner;

CREATE TABLE document_storage.multipart_upload (
  version_id uuid PRIMARY KEY REFERENCES document_storage.document_version(version_id),
  organization_id uuid NOT NULL,
  object_id uuid NOT NULL,
  provider_upload_id text NOT NULL CHECK(length(provider_upload_id) BETWEEN 1 AND 1024 AND provider_upload_id !~ '[[:cntrl:]]'),
  state text NOT NULL CHECK(state IN ('INITIATED','ABORTING','COMPLETED','ABORTED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(organization_id,provider_upload_id)
);
CREATE INDEX multipart_upload_expiry ON document_storage.multipart_upload(organization_id,expires_at,version_id)
  WHERE state IN ('INITIATED','ABORTING');
ALTER TABLE document_storage.multipart_upload ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_storage.multipart_upload FORCE ROW LEVEL SECURITY;
CREATE POLICY multipart_upload_org_isolation ON document_storage.multipart_upload
  USING(organization_id=current_setting('app.organization_id',true)::uuid)
  WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);

CREATE FUNCTION document_storage.register_multipart_upload(p_organization_id uuid,p_version_id uuid,p_object_id uuid,p_provider_upload_id text,p_expires_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
DECLARE existing document_storage.multipart_upload%ROWTYPE;
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'DOCUMENT_TENANT_CONTEXT_INVALID'; END IF;
  IF p_expires_at<=transaction_timestamp() OR length(p_provider_upload_id) NOT BETWEEN 1 AND 1024 OR p_provider_upload_id ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'MULTIPART_INPUT_INVALID'; END IF;
  SELECT * INTO existing FROM document_storage.multipart_upload WHERE version_id=p_version_id;
  IF FOUND THEN
    IF existing.organization_id<>p_organization_id OR existing.object_id<>p_object_id OR existing.provider_upload_id<>p_provider_upload_id THEN RAISE EXCEPTION 'MULTIPART_BINDING_CONFLICT'; END IF;
    RETURN;
  END IF;
  INSERT INTO document_storage.multipart_upload(version_id,organization_id,object_id,provider_upload_id,state,expires_at)
  SELECT p_version_id,p_organization_id,p_object_id,p_provider_upload_id,'INITIATED',p_expires_at
  FROM document_storage.document_version v
  WHERE v.organization_id=p_organization_id AND v.version_id=p_version_id AND v.object_id=p_object_id AND v.state='UPLOADING';
  IF NOT FOUND THEN RAISE EXCEPTION 'MULTIPART_VERSION_INVALID'; END IF;
END $$;

CREATE FUNCTION document_storage.record_multipart_part(p_organization_id uuid,p_version_id uuid,p_part_number smallint,p_size integer,p_sha char(64)) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'DOCUMENT_TENANT_CONTEXT_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM document_storage.multipart_upload WHERE organization_id=p_organization_id AND version_id=p_version_id AND state='INITIATED') THEN RAISE EXCEPTION 'MULTIPART_SESSION_INVALID'; END IF;
  INSERT INTO document_storage.multipart_part(version_id,part_number,size_bytes,sha256)
  VALUES(p_version_id,p_part_number,p_size,p_sha)
  ON CONFLICT(version_id,part_number) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM document_storage.multipart_part WHERE version_id=p_version_id AND part_number=p_part_number AND size_bytes=p_size AND sha256=p_sha) THEN RAISE EXCEPTION 'MULTIPART_PART_CONFLICT'; END IF;
END $$;

CREATE FUNCTION document_storage.finish_multipart_upload(p_organization_id uuid,p_version_id uuid,p_provider_upload_id text,p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'DOCUMENT_TENANT_CONTEXT_INVALID'; END IF;
  IF p_state NOT IN ('COMPLETED','ABORTED') THEN RAISE EXCEPTION 'MULTIPART_STATE_INVALID'; END IF;
  UPDATE document_storage.multipart_upload SET state=p_state,updated_at=transaction_timestamp()
  WHERE organization_id=p_organization_id AND version_id=p_version_id AND provider_upload_id=p_provider_upload_id
    AND state IN ('INITIATED','ABORTING',p_state);
  IF NOT FOUND THEN RAISE EXCEPTION 'MULTIPART_SESSION_INVALID'; END IF;
END $$;

CREATE FUNCTION document_storage.claim_expired_multipart_uploads(p_organization_id uuid,p_limit integer) RETURNS TABLE(version_id uuid,object_id uuid,provider_upload_id text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'DOCUMENT_TENANT_CONTEXT_INVALID'; END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'MULTIPART_LIMIT_INVALID'; END IF;
  RETURN QUERY WITH claimed AS (
    SELECT m.version_id FROM document_storage.multipart_upload m
    WHERE m.organization_id=p_organization_id AND m.state IN ('INITIATED','ABORTING') AND m.expires_at<=transaction_timestamp()
    ORDER BY m.expires_at,m.version_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE document_storage.multipart_upload m SET state='ABORTING',updated_at=transaction_timestamp()
  FROM claimed WHERE m.version_id=claimed.version_id
  RETURNING m.version_id,m.object_id,m.provider_upload_id,m.expires_at;
END $$;

CREATE FUNCTION document_storage.claim_document_transport_recovery(p_organization_id uuid,p_limit integer) RETURNS SETOF document_storage.document_version
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'DOCUMENT_TENANT_CONTEXT_INVALID'; END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'DOCUMENT_RECOVERY_LIMIT_INVALID'; END IF;
  RETURN QUERY
    SELECT v.* FROM document_storage.document_version v
    WHERE v.organization_id=p_organization_id
      AND ((v.state='UPLOADING' AND v.updated_at<=transaction_timestamp()-interval '5 minutes')
        OR (v.state='UPLOADED' AND v.observed_size IS NOT NULL AND v.sha256 IS NOT NULL)
        OR (v.state='SCANNING' AND v.scan_state='PENDING' AND v.confirmed_at IS NOT NULL))
    ORDER BY v.updated_at,v.version_id FOR UPDATE SKIP LOCKED LIMIT p_limit;
END $$;

REVOKE ALL ON document_storage.multipart_upload FROM PUBLIC,c4g_document_runtime;
GRANT SELECT ON document_storage.multipart_upload TO c4g_document_runtime;
REVOKE INSERT ON document_storage.multipart_part FROM c4g_document_runtime;
GRANT EXECUTE ON FUNCTION document_storage.register_multipart_upload(uuid,uuid,uuid,text,timestamptz),document_storage.record_multipart_part(uuid,uuid,smallint,integer,char),document_storage.finish_multipart_upload(uuid,uuid,text,text),document_storage.claim_expired_multipart_uploads(uuid,integer),document_storage.claim_document_transport_recovery(uuid,integer) TO c4g_document_runtime;
REVOKE ALL ON FUNCTION document_storage.register_multipart_upload(uuid,uuid,uuid,text,timestamptz),document_storage.record_multipart_part(uuid,uuid,smallint,integer,char),document_storage.finish_multipart_upload(uuid,uuid,text,text),document_storage.claim_expired_multipart_uploads(uuid,integer),document_storage.claim_document_transport_recovery(uuid,integer) FROM PUBLIC;
REVOKE DELETE,TRUNCATE ON document_storage.multipart_upload FROM c4g_document_runtime;
RESET ROLE;
