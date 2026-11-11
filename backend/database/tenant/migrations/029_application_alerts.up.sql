SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application_alert (
 organization_id uuid NOT NULL, alert_id uuid NOT NULL,
 recipient_membership_id uuid NOT NULL, application_id uuid NOT NULL,
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 200),
 type text NOT NULL CHECK(type IN ('APPLICATION_STATUS_CHANGED','APPLICATION_TEAM_ADDED','DEADLINE_30_DAYS','DEADLINE_7_DAYS','DEADLINE_1_DAYS')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300), message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 deadline date, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), read_at timestamptz,
 PRIMARY KEY(organization_id,alert_id), UNIQUE(organization_id,recipient_membership_id,event_key),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id),
 CHECK(read_at IS NULL OR read_at>=created_at)
);
CREATE INDEX application_alert_inbox ON opportunity_catalog.application_alert(organization_id,recipient_membership_id,created_at DESC,alert_id DESC);
ALTER TABLE opportunity_catalog.application_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application_alert FORCE ROW LEVEL SECURITY;
CREATE POLICY application_alert_read ON opportunity_catalog.application_alert FOR SELECT USING(
 organization_id=current_setting('app.organization_id',true)::uuid AND recipient_membership_id=current_setting('app.membership_id',true)::uuid);
CREATE POLICY application_alert_insert ON opportunity_catalog.application_alert FOR INSERT WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY application_alert_ack ON opportunity_catalog.application_alert FOR UPDATE USING(
 organization_id=current_setting('app.organization_id',true)::uuid AND recipient_membership_id=current_setting('app.membership_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid AND recipient_membership_id=current_setting('app.membership_id',true)::uuid);
CREATE TRIGGER application_alert_no_delete BEFORE DELETE OR TRUNCATE ON opportunity_catalog.application_alert FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE FUNCTION opportunity_catalog.guard_alert_read() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.read_at IS NOT NULL OR NEW.read_at IS NULL THEN RAISE EXCEPTION 'Alert read receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_alert_read_once BEFORE UPDATE ON opportunity_catalog.application_alert FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_alert_read();
REVOKE ALL ON FUNCTION opportunity_catalog.guard_alert_read() FROM PUBLIC;
REVOKE ALL ON opportunity_catalog.application_alert FROM PUBLIC,c4g_opportunity_tenant_runtime;
GRANT SELECT,INSERT,UPDATE(read_at) ON opportunity_catalog.application_alert TO c4g_opportunity_tenant_runtime;
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''APPLICATION_ALERT_READ'',''APPLICATION_ALERT_CREATED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
