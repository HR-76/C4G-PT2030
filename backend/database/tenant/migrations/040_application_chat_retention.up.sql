-- Chat retention: delete the chat of an application 90+ days after it reached a final state.
-- Messages stay immutable for the runtime; only the SECURITY DEFINER function below can delete them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_chat_retention_runtime') THEN
    CREATE ROLE c4g_chat_retention_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

SET ROLE c4g_opportunity_tenant_owner;

CREATE TABLE opportunity_catalog.application_chat_purge (
  organization_id uuid NOT NULL,
  application_id uuid NOT NULL,
  terminal_status text NOT NULL CHECK (terminal_status IN ('APPROVED','REJECTED','CANCELLED','ARCHIVED')),
  terminal_at timestamptz NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  message_count integer NOT NULL CHECK (message_count >= 0),
  retention_days integer NOT NULL CHECK (retention_days >= 90),
  PRIMARY KEY (organization_id, application_id),
  FOREIGN KEY (organization_id, application_id) REFERENCES opportunity_catalog.application (organization_id, application_id)
);
ALTER TABLE opportunity_catalog.application_chat_purge ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application_chat_purge FORCE ROW LEVEL SECURITY;
CREATE POLICY application_chat_purge_isolation ON opportunity_catalog.application_chat_purge
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
REVOKE ALL ON opportunity_catalog.application_chat_purge FROM PUBLIC, c4g_opportunity_tenant_runtime;
GRANT SELECT ON opportunity_catalog.application_chat_purge TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER application_chat_purge_immutable BEFORE UPDATE OR DELETE
  ON opportunity_catalog.application_chat_purge FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_chat_purge_no_truncate BEFORE TRUNCATE
  ON opportunity_catalog.application_chat_purge FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();

-- The shared append-only guard always raises. Chat tables get a guard that lets a DELETE through only while the
-- purge function has named the application being purged in a transaction-local setting.
CREATE FUNCTION opportunity_catalog.guard_chat_retention() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' AND nullif(current_setting('app.chat_purge_application', true), '') IS NOT NULL THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'F13_AUTHORING_APPEND_ONLY';
END $$;
DROP TRIGGER application_chat_message_immutable ON opportunity_catalog.application_chat_message;
CREATE TRIGGER application_chat_message_immutable BEFORE UPDATE OR DELETE
  ON opportunity_catalog.application_chat_message FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_chat_retention();
DROP TRIGGER application_chat_receipt_immutable ON opportunity_catalog.application_chat_receipt;
CREATE TRIGGER application_chat_receipt_immutable BEFORE UPDATE OR DELETE
  ON opportunity_catalog.application_chat_receipt FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_chat_retention();

-- FORCE ROW LEVEL SECURITY applies to the owner: give it access to exactly the application being purged.
CREATE POLICY application_chat_message_purge ON opportunity_catalog.application_chat_message
  FOR ALL TO c4g_opportunity_tenant_owner
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND application_id = nullif(current_setting('app.chat_purge_application', true), '')::uuid);
CREATE POLICY application_chat_receipt_purge ON opportunity_catalog.application_chat_receipt
  FOR ALL TO c4g_opportunity_tenant_owner
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM opportunity_catalog.application_chat_message m
    WHERE m.organization_id = application_chat_receipt.organization_id AND m.message_id = application_chat_receipt.message_id
      AND m.application_id = nullif(current_setting('app.chat_purge_application', true), '')::uuid));

CREATE FUNCTION opportunity_catalog.purge_closed_application_chat_v1(p_organization_id uuid, p_retention_days integer, p_limit integer)
RETURNS TABLE (purged_application_id uuid, purged_message_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, opportunity_catalog AS $$
DECLARE
  previous_org text := current_setting('app.organization_id', true);
  item record;
  receipts integer;
  messages integer;
BEGIN
  IF p_organization_id IS NULL OR p_retention_days IS NULL OR p_retention_days < 90 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'CHAT_RETENTION_INVALID';
  END IF;
  PERFORM set_config('app.organization_id', p_organization_id::text, true);
  FOR item IN
    SELECT a.application_id AS id, a.status, t.closed_at
      FROM opportunity_catalog.application a
      CROSS JOIN LATERAL (
        SELECT max(c.recorded_at) AS closed_at FROM opportunity_catalog.application_change c
         WHERE c.organization_id = a.organization_id AND c.application_id = a.application_id
           AND c.kind = 'TRANSITION' AND c.to_status = a.status) t
     WHERE a.organization_id = p_organization_id
       AND a.status IN ('APPROVED','REJECTED','CANCELLED','ARCHIVED')
       AND t.closed_at IS NOT NULL
       AND t.closed_at <= clock_timestamp() - make_interval(days => p_retention_days)
       AND NOT EXISTS (SELECT 1 FROM opportunity_catalog.application_chat_purge p
                        WHERE p.organization_id = a.organization_id AND p.application_id = a.application_id)
     ORDER BY t.closed_at, a.application_id
     LIMIT p_limit
  LOOP
    PERFORM set_config('app.chat_purge_application', item.id::text, true);
    DELETE FROM opportunity_catalog.application_chat_receipt WHERE organization_id = p_organization_id;
    GET DIAGNOSTICS receipts = ROW_COUNT;
    DELETE FROM opportunity_catalog.application_chat_message WHERE organization_id = p_organization_id AND application_id = item.id;
    GET DIAGNOSTICS messages = ROW_COUNT;
    INSERT INTO opportunity_catalog.application_chat_purge
      (organization_id, application_id, terminal_status, terminal_at, message_count, retention_days)
    VALUES (p_organization_id, item.id, item.status, item.closed_at, messages, p_retention_days);
    PERFORM set_config('app.chat_purge_application', '', true);
    purged_application_id := item.id;
    purged_message_count := messages;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.organization_id', coalesce(previous_org, ''), true);
END $$;

REVOKE ALL ON FUNCTION opportunity_catalog.purge_closed_application_chat_v1(uuid, integer, integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_chat_retention_runtime;
GRANT EXECUTE ON FUNCTION opportunity_catalog.purge_closed_application_chat_v1(uuid, integer, integer) TO c4g_chat_retention_runtime;

RESET ROLE;
