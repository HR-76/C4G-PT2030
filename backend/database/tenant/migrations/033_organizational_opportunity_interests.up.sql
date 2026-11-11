-- Candidate migration. Register the measured schema fingerprint only after an authorized isolated gate.
-- No existing opportunity, application, history or receipt is reinterpreted.
GRANT USAGE ON SCHEMA organizational_scope TO c4g_opportunity_tenant_owner;
GRANT REFERENCES(organization_id,scope_id) ON organizational_scope.scope TO c4g_opportunity_tenant_owner;
SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.opportunity_interest (
 organization_id uuid NOT NULL, interest_id uuid NOT NULL,
 central_opportunity_id uuid NOT NULL, central_revision_id uuid NOT NULL,
 central_snapshot jsonb NOT NULL CHECK(jsonb_typeof(central_snapshot)='object'),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 2000),
 notes text CHECK(length(notes)<=10000), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL, created_membership_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,interest_id), UNIQUE(organization_id,central_opportunity_id),
 UNIQUE(organization_id,interest_id,central_opportunity_id)
);
CREATE TABLE opportunity_catalog.interest_unit (
 organization_id uuid NOT NULL, interest_id uuid NOT NULL, scope_id uuid NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,interest_id,scope_id),
 FOREIGN KEY(organization_id,interest_id) REFERENCES opportunity_catalog.opportunity_interest(organization_id,interest_id),
 FOREIGN KEY(organization_id,scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id)
);
CREATE INDEX interest_unit_lookup ON opportunity_catalog.interest_unit(organization_id,scope_id,interest_id) WHERE active;
CREATE TABLE opportunity_catalog.interest_change (
 organization_id uuid NOT NULL, interest_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 kind text NOT NULL CHECK(kind IN ('REGISTER','EDIT','ARCHIVE')), title text NOT NULL, notes text CHECK(length(notes)<=10000),
 status text NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')), unit_ids uuid[] NOT NULL DEFAULT '{}',
 unit_snapshot jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(unit_snapshot)='array'), reason text CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 actor_subject_id uuid NOT NULL, actor_membership_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,interest_id,revision),
 FOREIGN KEY(organization_id,interest_id) REFERENCES opportunity_catalog.opportunity_interest(organization_id,interest_id),
 CHECK((kind='REGISTER' AND revision=1 AND status='ACTIVE' AND reason IS NULL) OR (kind='EDIT' AND revision>1 AND status='ACTIVE' AND reason IS NULL) OR (kind='ARCHIVE' AND revision>1 AND status='ARCHIVED' AND reason IS NOT NULL))
);
CREATE TABLE opportunity_catalog.interest_receipt (
 organization_id uuid NOT NULL, idempotency_key uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('REGISTER','EDIT','ARCHIVE')),
 subject_id uuid NOT NULL, resource_id uuid NOT NULL, intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection)='object'), recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,idempotency_key)
);
ALTER TABLE opportunity_catalog.application ADD COLUMN source_interest_id uuid, ADD COLUMN source_interest_revision bigint;
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_interest_pair CHECK((source_interest_id IS NULL AND source_interest_revision IS NULL) OR (source_interest_id IS NOT NULL AND source_interest_revision IS NOT NULL AND source_interest_revision>0 AND central_opportunity_id IS NOT NULL));
-- Validate the new FKs over every existing row as the table owner, independent
-- of a pooled session's organization setting. The enclosing migration is atomic
-- and already holds ACCESS EXCLUSIVE; restore forced RLS before it can commit.
ALTER TABLE opportunity_catalog.application NO FORCE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_interest_origin FOREIGN KEY(organization_id,source_interest_id,central_opportunity_id) REFERENCES opportunity_catalog.opportunity_interest(organization_id,interest_id,central_opportunity_id);
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_interest_revision FOREIGN KEY(organization_id,source_interest_id,source_interest_revision) REFERENCES opportunity_catalog.interest_change(organization_id,interest_id,revision);
ALTER TABLE opportunity_catalog.application FORCE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application_change ADD COLUMN source_interest_id uuid, ADD COLUMN source_interest_revision bigint,
 ADD COLUMN unit_ids uuid[] NOT NULL DEFAULT '{}', ADD COLUMN unit_snapshot jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(unit_snapshot)='array');
CREATE TABLE opportunity_catalog.application_unit (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, scope_id uuid NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,application_id,scope_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id),
 FOREIGN KEY(organization_id,scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id)
);
CREATE INDEX application_unit_lookup ON opportunity_catalog.application_unit(organization_id,scope_id,application_id) WHERE active;
CREATE FUNCTION opportunity_catalog.guard_interest_unit_active() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT NEW.active THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.active THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('F13-P1:' || NEW.organization_id::text,43001301));
 IF NOT EXISTS(SELECT 1 FROM organizational_scope.scope WHERE organization_id=NEW.organization_id AND scope_id=NEW.scope_id AND scope_type='UNIT' AND lifecycle='ACTIVE') THEN
  RAISE EXCEPTION 'INTEREST_UNIT_UNAVAILABLE';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_interest_unit_active() FROM PUBLIC;
CREATE TRIGGER interest_active_unit BEFORE INSERT OR UPDATE OF active ON opportunity_catalog.interest_unit FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_interest_unit_active();
CREATE TRIGGER application_active_unit BEFORE INSERT OR UPDATE OF active ON opportunity_catalog.application_unit FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_interest_unit_active();
CREATE FUNCTION opportunity_catalog.guard_interest_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.organization_id<>OLD.organization_id OR NEW.interest_id<>OLD.interest_id OR NEW.central_opportunity_id<>OLD.central_opportunity_id
 OR NEW.central_revision_id<>OLD.central_revision_id OR NEW.central_snapshot<>OLD.central_snapshot OR NEW.title<>OLD.title
 OR NEW.created_by<>OLD.created_by OR NEW.created_membership_id<>OLD.created_membership_id OR NEW.created_at<>OLD.created_at
 OR NEW.revision<>OLD.revision+1 OR OLD.status='ARCHIVED' THEN RAISE EXCEPTION 'INTEREST_IMMUTABLE_OR_STALE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_interest_revision() FROM PUBLIC;
CREATE TRIGGER interest_revision BEFORE UPDATE ON opportunity_catalog.opportunity_interest FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_interest_revision();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['opportunity_interest','interest_unit','interest_change','interest_receipt','application_unit'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY interest_organization_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER interest_no_delete BEFORE DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('CREATE TRIGGER interest_no_truncate BEFORE TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
 END LOOP;
END $$;
CREATE TRIGGER interest_change_immutable BEFORE UPDATE ON opportunity_catalog.interest_change FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER interest_receipt_immutable BEFORE UPDATE ON opportunity_catalog.interest_receipt FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
GRANT UPDATE(notes,status,revision,updated_at) ON opportunity_catalog.opportunity_interest TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(active) ON opportunity_catalog.interest_unit,opportunity_catalog.application_unit TO c4g_opportunity_tenant_runtime;
-- Origin is fixed at INSERT; application runtime must not rewrite it afterwards.
RESET ROLE;
-- Keep the database allowlist aligned with the three new critical audit events.
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''OPPORTUNITY_INTEREST_REGISTERED'',''OPPORTUNITY_INTEREST_CHANGED'',''OPPORTUNITY_INTEREST_ARCHIVED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
