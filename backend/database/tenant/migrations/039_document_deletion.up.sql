-- Physical document deletion (DELETE_PENDING reserves; only DELETED stops counting towards the quota).
SET ROLE c4g_document_owner;
-- Migration 003 forbids the DELETED state (CHECK state<>'DELETED', auto-named document_version_state_check).
-- Proven on disposable PostgreSQL 17: finish_document_deletion fails without relaxing it. Only the guarded
-- finish function below can set DELETED (runtime has no UPDATE on this table).
ALTER TABLE document_storage.document_version DROP CONSTRAINT document_version_state_check;
CREATE FUNCTION document_storage.begin_document_deletion(p_organization_id uuid,p_document_id uuid,p_version_id uuid,p_resource_id uuid,p_from document_storage.document_state) RETURNS SETOF document_storage.document_version
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid OR p_from NOT IN ('AVAILABLE','QUARANTINED','REJECTED') THEN RETURN; END IF;
  RETURN QUERY UPDATE document_storage.document_version v SET state='DELETE_PENDING',lock_version=v.lock_version+1,updated_at=transaction_timestamp()
    FROM document_storage.document d
    WHERE d.organization_id=v.organization_id AND d.document_id=v.document_id AND d.resource_id=p_resource_id
      AND v.organization_id=p_organization_id AND v.document_id=p_document_id AND v.version_id=p_version_id AND v.state=p_from
    RETURNING v.*;
END $$;
CREATE FUNCTION document_storage.cancel_document_deletion(p_organization_id uuid,p_document_id uuid,p_version_id uuid,p_to document_storage.document_state) RETURNS SETOF document_storage.document_version
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid OR p_to NOT IN ('AVAILABLE','QUARANTINED','REJECTED') THEN RETURN; END IF;
  RETURN QUERY UPDATE document_storage.document_version SET state=p_to,lock_version=lock_version+1,updated_at=transaction_timestamp()
    WHERE organization_id=p_organization_id AND document_id=p_document_id AND version_id=p_version_id AND state='DELETE_PENDING' RETURNING *;
END $$;
CREATE FUNCTION document_storage.finish_document_deletion(p_organization_id uuid,p_document_id uuid,p_version_id uuid) RETURNS SETOF document_storage.document_version
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid THEN RETURN; END IF;
  RETURN QUERY UPDATE document_storage.document_version SET state='DELETED',lock_version=lock_version+1,updated_at=transaction_timestamp()
    WHERE organization_id=p_organization_id AND document_id=p_document_id AND version_id=p_version_id AND state='DELETE_PENDING' RETURNING *;
END $$;
REVOKE ALL ON FUNCTION document_storage.begin_document_deletion(uuid,uuid,uuid,uuid,document_storage.document_state),document_storage.cancel_document_deletion(uuid,uuid,uuid,document_storage.document_state),document_storage.finish_document_deletion(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_storage.begin_document_deletion(uuid,uuid,uuid,uuid,document_storage.document_state),document_storage.cancel_document_deletion(uuid,uuid,uuid,document_storage.document_state),document_storage.finish_document_deletion(uuid,uuid,uuid) TO c4g_document_runtime;
RESET ROLE;
