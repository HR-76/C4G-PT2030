SET ROLE c4g_opportunity_tenant_owner;

CREATE TABLE opportunity_catalog.application_chat_message (
  organization_id uuid NOT NULL,
  application_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  message_id uuid NOT NULL,
  sequence_no bigint GENERATED ALWAYS AS IDENTITY,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000 AND body ~ '[^[:space:]]'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, message_id),
  FOREIGN KEY (organization_id, application_id, author_membership_id)
    REFERENCES opportunity_catalog.application_participant (organization_id, application_id, membership_id)
);

CREATE UNIQUE INDEX application_chat_message_page
  ON opportunity_catalog.application_chat_message (organization_id, application_id, sequence_no DESC);

ALTER TABLE opportunity_catalog.application_chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application_chat_message FORCE ROW LEVEL SECURITY;
CREATE POLICY application_chat_team ON opportunity_catalog.application_chat_message
  TO c4g_opportunity_tenant_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM opportunity_catalog.application_participant p
    WHERE p.organization_id = application_chat_message.organization_id
      AND p.application_id = application_chat_message.application_id
      AND p.membership_id = nullif(current_setting('app.membership_id', true), '')::uuid
      AND p.active
  ))
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND author_membership_id = nullif(current_setting('app.membership_id', true), '')::uuid AND EXISTS (
      SELECT 1 FROM opportunity_catalog.application_participant p
      WHERE p.organization_id = application_chat_message.organization_id
        AND p.application_id = application_chat_message.application_id
        AND p.membership_id = application_chat_message.author_membership_id
        AND p.active
    ));

REVOKE ALL ON opportunity_catalog.application_chat_message FROM PUBLIC, c4g_opportunity_tenant_runtime;
GRANT SELECT ON opportunity_catalog.application_chat_message TO c4g_opportunity_tenant_runtime;
GRANT INSERT (organization_id, application_id, author_membership_id, message_id, body)
  ON opportunity_catalog.application_chat_message TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER application_chat_message_immutable BEFORE UPDATE OR DELETE
  ON opportunity_catalog.application_chat_message FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_chat_message_no_truncate BEFORE TRUNCATE
  ON opportunity_catalog.application_chat_message FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();

CREATE TABLE opportunity_catalog.application_chat_receipt (
  organization_id uuid NOT NULL,
  message_id uuid NOT NULL,
  intention_digest char(64) NOT NULL CHECK (intention_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (organization_id, message_id),
  FOREIGN KEY (organization_id, message_id)
    REFERENCES opportunity_catalog.application_chat_message (organization_id, message_id)
);
ALTER TABLE opportunity_catalog.application_chat_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application_chat_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY application_chat_receipt_isolation ON opportunity_catalog.application_chat_receipt
  TO c4g_opportunity_tenant_runtime
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
REVOKE ALL ON opportunity_catalog.application_chat_receipt FROM PUBLIC, c4g_opportunity_tenant_runtime;
GRANT SELECT, INSERT ON opportunity_catalog.application_chat_receipt TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER application_chat_receipt_immutable BEFORE UPDATE OR DELETE
  ON opportunity_catalog.application_chat_receipt FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_chat_receipt_no_truncate BEFORE TRUNCATE
  ON opportunity_catalog.application_chat_receipt FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();

RESET ROLE;
