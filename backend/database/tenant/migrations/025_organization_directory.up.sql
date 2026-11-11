-- Organization identity remains central. Descriptive data and people stay private.
SET ROLE c4g_organizational_scope_owner;
CREATE TABLE organizational_scope.organization_card (
 organization_id uuid PRIMARY KEY, description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=254), website text NOT NULL DEFAULT '' CHECK(length(website)<=500),
 revision bigint NOT NULL CHECK(revision>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE organizational_scope.person (
 organization_id uuid NOT NULL, person_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 256),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=254), function_label text NOT NULL DEFAULT '' CHECK(length(function_label)<=256),
 active boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,person_id)
);
CREATE TABLE organizational_scope.person_unit (
 organization_id uuid NOT NULL, person_id uuid NOT NULL, scope_id uuid NOT NULL, is_primary boolean NOT NULL,
 PRIMARY KEY(organization_id,person_id,scope_id),
 FOREIGN KEY(organization_id,person_id) REFERENCES organizational_scope.person(organization_id,person_id),
 FOREIGN KEY(organization_id,scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id)
);
CREATE UNIQUE INDEX person_primary_unit ON organizational_scope.person_unit(organization_id,person_id) WHERE is_primary;
CREATE INDEX person_unit_lookup ON organizational_scope.person_unit(organization_id,scope_id,person_id);
CREATE TABLE organizational_scope.directory_receipt (
 organization_id uuid NOT NULL, idempotency_key uuid NOT NULL, subject_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('PROFILE_EDIT','PERSON_CREATE','PERSON_EDIT')),
 resource_id uuid NOT NULL, intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,idempotency_key)
);
CREATE FUNCTION organizational_scope.guard_directory_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.organization_id<>OLD.organization_id OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'DIRECTORY_IMMUTABLE_OR_STALE';
 END IF;
 IF TG_TABLE_NAME='person' THEN
  IF NEW.person_id<>OLD.person_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
   RAISE EXCEPTION 'DIRECTORY_IMMUTABLE_FIELD';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organizational_scope.guard_person_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organizational_scope AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organizational_scope.scope WHERE organization_id=NEW.organization_id
   AND scope_id=NEW.scope_id AND scope_type='UNIT' AND lifecycle='ACTIVE') THEN
  RAISE EXCEPTION 'DIRECTORY_UNIT_UNAVAILABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organizational_scope.guard_directory_unit_archive() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organizational_scope AS $$
BEGIN
 IF NEW.lifecycle='ARCHIVED' AND OLD.lifecycle='ACTIVE' AND EXISTS(
  SELECT 1 FROM organizational_scope.person_unit WHERE organization_id=NEW.organization_id AND scope_id=NEW.scope_id
 ) THEN RAISE EXCEPTION 'DIRECTORY_UNIT_HAS_PEOPLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER directory_unit_archive BEFORE UPDATE ON organizational_scope.scope
 FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_directory_unit_archive();
CREATE TRIGGER person_unit_valid BEFORE INSERT OR UPDATE ON organizational_scope.person_unit
 FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_person_unit();
CREATE FUNCTION organizational_scope.guard_primary_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organizational_scope AS $$
DECLARE n integer; primaries integer;
BEGIN
 SELECT count(*),count(*) FILTER(WHERE is_primary) INTO n,primaries FROM organizational_scope.person_unit
  WHERE organization_id=COALESCE(NEW.organization_id,OLD.organization_id) AND person_id=COALESCE(NEW.person_id,OLD.person_id);
 IF n>50 OR (n>0 AND primaries<>1) THEN RAISE EXCEPTION 'DIRECTORY_PRIMARY_UNIT_REQUIRED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER person_unit_primary AFTER INSERT OR UPDATE OR DELETE ON organizational_scope.person_unit
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_primary_unit();
CREATE TRIGGER directory_person_revision BEFORE UPDATE ON organizational_scope.person
 FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_directory_revision();
CREATE TRIGGER directory_card_revision BEFORE UPDATE ON organizational_scope.organization_card
 FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_directory_revision();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['organization_card','person','person_unit','directory_receipt'] LOOP
  EXECUTE format('ALTER TABLE organizational_scope.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organizational_scope.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY directory_isolation ON organizational_scope.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER directory_lock BEFORE INSERT OR UPDATE OR DELETE ON organizational_scope.%I FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.lock_scope_tree_mutation()',tab);
  EXECUTE format('CREATE TRIGGER directory_no_truncate BEFORE TRUNCATE ON organizational_scope.%I FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.reject_history_mutation()',tab);
  EXECUTE format('REVOKE ALL ON organizational_scope.%I FROM PUBLIC',tab);
  EXECUTE format('GRANT SELECT,INSERT ON organizational_scope.%I TO c4g_opportunity_tenant_runtime',tab);
 END LOOP;
END $$;
CREATE TRIGGER person_no_delete BEFORE DELETE ON organizational_scope.person FOR EACH ROW EXECUTE FUNCTION organizational_scope.reject_history_mutation();
CREATE TRIGGER card_no_delete BEFORE DELETE ON organizational_scope.organization_card FOR EACH ROW EXECUTE FUNCTION organizational_scope.reject_history_mutation();
CREATE TRIGGER directory_receipt_immutable BEFORE UPDATE OR DELETE ON organizational_scope.directory_receipt FOR EACH ROW EXECUTE FUNCTION organizational_scope.reject_history_mutation();
GRANT UPDATE ON organizational_scope.organization_card,organizational_scope.person TO c4g_opportunity_tenant_runtime;
GRANT DELETE ON organizational_scope.person_unit TO c4g_opportunity_tenant_runtime;
GRANT SELECT ON organizational_scope.person_unit TO c4g_organizational_scope_runtime;
GRANT USAGE ON SCHEMA organizational_scope TO c4g_opportunity_tenant_runtime;
GRANT SELECT,INSERT,UPDATE ON organizational_scope.scope TO c4g_opportunity_tenant_runtime;
GRANT SELECT,INSERT ON organizational_scope.idempotency_record TO c4g_opportunity_tenant_runtime;
RESET ROLE;
-- Extend, rather than replace, the current closed audit event catalog.
DO $$ DECLARE tab text; constraint_name text; expression text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  constraint_name := tab || '_event_code_check';
  SELECT pg_get_constraintdef(oid) INTO STRICT expression FROM pg_constraint
   WHERE conrelid=('audit.'||tab)::regclass AND conname=constraint_name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,constraint_name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK (%s OR event_code IN (''ORGANIZATION_CARD_CHANGED'',''ORGANIZATION_PERSON_CREATED'',''ORGANIZATION_PERSON_CHANGED''))',tab,constraint_name,substring(expression FROM 8 FOR length(expression)-8));
 END LOOP;
END $$;
