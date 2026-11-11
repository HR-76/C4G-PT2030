SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.organization_notice (
 organization_id uuid NOT NULL, notice_id uuid NOT NULL,
 author_subject_id uuid NOT NULL, author_membership_id uuid NOT NULL, author_name text NOT NULL,
 idempotency_key uuid NOT NULL, intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), message text NOT NULL CHECK(length(message) BETWEEN 1 AND 5000),
 recipient_count integer NOT NULL CHECK(recipient_count BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,notice_id), UNIQUE(organization_id,idempotency_key)
);
CREATE TABLE opportunity_catalog.organization_notice_recipient (
 organization_id uuid NOT NULL, notice_id uuid NOT NULL, recipient_membership_id uuid NOT NULL,
 notification_id uuid NOT NULL, recipient_name text NOT NULL, read_at timestamptz,
 PRIMARY KEY(organization_id,notice_id,recipient_membership_id), UNIQUE(organization_id,notification_id),
 FOREIGN KEY(organization_id,notice_id) REFERENCES opportunity_catalog.organization_notice(organization_id,notice_id)
);
CREATE INDEX notice_history ON opportunity_catalog.organization_notice(organization_id,created_at DESC,notice_id DESC);
CREATE INDEX notice_recipient_inbox ON opportunity_catalog.organization_notice_recipient(organization_id,recipient_membership_id,notice_id);
ALTER TABLE opportunity_catalog.organization_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.organization_notice FORCE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.organization_notice_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.organization_notice_recipient FORCE ROW LEVEL SECURITY;
CREATE POLICY notice_select ON opportunity_catalog.organization_notice FOR SELECT USING(
 organization_id=current_setting('app.organization_id',true)::uuid AND
 (current_setting('app.notice_admin',true)='true' OR EXISTS(SELECT 1 FROM opportunity_catalog.organization_notice_recipient r WHERE r.organization_id=organization_notice.organization_id AND r.notice_id=organization_notice.notice_id AND r.recipient_membership_id=current_setting('app.membership_id',true)::uuid)));
CREATE POLICY notice_insert ON opportunity_catalog.organization_notice FOR INSERT WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid AND current_setting('app.notice_admin',true)='true');
CREATE POLICY notice_recipient_select ON opportunity_catalog.organization_notice_recipient FOR SELECT USING(
 organization_id=current_setting('app.organization_id',true)::uuid AND (recipient_membership_id=current_setting('app.membership_id',true)::uuid OR current_setting('app.notice_admin',true)='true'));
CREATE POLICY notice_recipient_insert ON opportunity_catalog.organization_notice_recipient FOR INSERT WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid AND current_setting('app.notice_admin',true)='true');
CREATE POLICY notice_recipient_ack ON opportunity_catalog.organization_notice_recipient FOR UPDATE USING(organization_id=current_setting('app.organization_id',true)::uuid AND recipient_membership_id=current_setting('app.membership_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid AND recipient_membership_id=current_setting('app.membership_id',true)::uuid);
CREATE TRIGGER notice_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON opportunity_catalog.organization_notice FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER notice_recipient_no_delete BEFORE DELETE OR TRUNCATE ON opportunity_catalog.organization_notice_recipient FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER notice_recipient_read_once BEFORE UPDATE ON opportunity_catalog.organization_notice_recipient FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_alert_read();
REVOKE ALL ON opportunity_catalog.organization_notice,opportunity_catalog.organization_notice_recipient FROM PUBLIC,c4g_opportunity_tenant_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.organization_notice,opportunity_catalog.organization_notice_recipient TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(read_at) ON opportunity_catalog.organization_notice_recipient TO c4g_opportunity_tenant_runtime;
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''ORGANIZATION_NOTICE_SENT'',''ORGANIZATION_NOTICE_READ''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
