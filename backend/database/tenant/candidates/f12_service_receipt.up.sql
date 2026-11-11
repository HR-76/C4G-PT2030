-- Isolated candidate. A trusted issuer and recovery reader are still required.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c4g_f12_receipt_issuer') THEN
    CREATE ROLE c4g_f12_receipt_issuer NOLOGIN NOINHERIT;
  END IF;
END $$;
CREATE SCHEMA f12_service_receipts AUTHORIZATION c4g_tenant_owner;
REVOKE ALL ON SCHEMA f12_service_receipts FROM PUBLIC;

CREATE TABLE f12_service_receipts.effect_receipt (
  transaction_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  database_generation_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('opportunity.duplicate.scan', 'opportunity.catalog.reconcile')),
  grant_version bigint NOT NULL CHECK (grant_version > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION f12_service_receipts.check_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'F12_RECEIPT_IMMUTABLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM c4g_system.tenant_identity
    WHERE tenant_id = NEW.tenant_id AND database_generation_id = NEW.database_generation_id) THEN
    RAISE EXCEPTION 'F12_RECEIPT_TENANT_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER check_receipt BEFORE INSERT OR UPDATE OR DELETE ON f12_service_receipts.effect_receipt
  FOR EACH ROW EXECUTE FUNCTION f12_service_receipts.check_receipt();
ALTER TABLE f12_service_receipts.effect_receipt OWNER TO c4g_tenant_owner;
ALTER FUNCTION f12_service_receipts.check_receipt() OWNER TO c4g_tenant_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA f12_service_receipts FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA f12_service_receipts FROM PUBLIC;

CREATE FUNCTION f12_service_receipts.observe_effect(
  p_nonce uuid, p_organization uuid, p_tenant uuid, p_generation uuid
) RETURNS TABLE (pending boolean, receipt jsonb)
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
    OR NOT EXISTS (SELECT 1 FROM c4g_system.tenant_identity
      WHERE tenant_id = p_tenant AND database_generation_id = p_generation
        AND product_code = 'C4G' AND database_role = 'TENANT') THEN
    RAISE EXCEPTION 'F12_RECEIPT_TENANT_MISMATCH';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_nonce::text, 43001305)) THEN
    RETURN QUERY SELECT true, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, (SELECT to_jsonb(r) || jsonb_build_object('grant_version', r.grant_version::text)
    FROM f12_service_receipts.effect_receipt r WHERE r.transaction_id = p_nonce
      AND r.organization_id = p_organization);
  IF EXISTS (SELECT 1 FROM f12_service_receipts.effect_receipt r WHERE r.transaction_id = p_nonce
    AND r.organization_id <> p_organization) THEN
    RAISE EXCEPTION 'F12_RECEIPT_BINDING_MISMATCH';
  END IF;
END $$;
ALTER FUNCTION f12_service_receipts.observe_effect(uuid, uuid, uuid, uuid) OWNER TO c4g_tenant_owner;
GRANT SELECT ON c4g_system.tenant_identity TO c4g_tenant_owner;
REVOKE ALL ON FUNCTION f12_service_receipts.observe_effect(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA f12_service_receipts TO c4g_opportunity_tenant_runtime;
GRANT EXECUTE ON FUNCTION f12_service_receipts.observe_effect(uuid, uuid, uuid, uuid) TO c4g_opportunity_tenant_runtime;
GRANT USAGE ON SCHEMA f12_service_receipts, c4g_system TO c4g_f12_receipt_issuer;
GRANT SELECT (tenant_id, database_generation_id, product_code, database_role)
  ON c4g_system.tenant_identity TO c4g_f12_receipt_issuer;
GRANT INSERT (transaction_id, organization_id, tenant_id, database_generation_id, execution_id,
  job_type, grant_version, content_digest) ON f12_service_receipts.effect_receipt TO c4g_f12_receipt_issuer;
