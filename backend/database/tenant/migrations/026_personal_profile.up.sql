SET LOCAL ROLE c4g_organizational_scope_owner;
CREATE TABLE organizational_scope.person_profile (
 organization_id uuid NOT NULL,
 person_id uuid NOT NULL,
 membership_id uuid,
 biography text NOT NULL DEFAULT '' CHECK(length(biography)<=4000),
 keywords text NOT NULL DEFAULT '' CHECK(length(keywords)<=1000),
 area_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(area_ids)<=30),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_by uuid NOT NULL,
 PRIMARY KEY(organization_id,person_id),
 FOREIGN KEY(organization_id,person_id) REFERENCES organizational_scope.person(organization_id,person_id),
 UNIQUE(organization_id,membership_id)
);
ALTER TABLE organizational_scope.person_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizational_scope.person_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY directory_isolation ON organizational_scope.person_profile
 USING(organization_id=current_setting('app.organization_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE FUNCTION organizational_scope.guard_person_profile_revision() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 BEGIN
  IF NEW.organization_id<>OLD.organization_id OR NEW.person_id<>OLD.person_id OR NEW.revision<>OLD.revision+1 THEN
   RAISE EXCEPTION 'DIRECTORY_IMMUTABLE_OR_STALE';
  END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER profile_revision BEFORE UPDATE ON organizational_scope.person_profile
 FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_person_profile_revision();
REVOKE ALL ON organizational_scope.person_profile FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON organizational_scope.person_profile TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER profile_no_delete BEFORE DELETE ON organizational_scope.person_profile
 FOR EACH ROW EXECUTE FUNCTION organizational_scope.reject_history_mutation();
CREATE TRIGGER profile_no_truncate BEFORE TRUNCATE ON organizational_scope.person_profile
 FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.reject_history_mutation();
CREATE TRIGGER directory_lock BEFORE INSERT OR UPDATE OR DELETE ON organizational_scope.person_profile
 FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.lock_scope_tree_mutation();
ALTER TABLE organizational_scope.directory_receipt DROP CONSTRAINT directory_receipt_operation_check;
ALTER TABLE organizational_scope.directory_receipt ADD CONSTRAINT directory_receipt_operation_check
 CHECK(operation IN ('PROFILE_EDIT','PERSON_CREATE','PERSON_EDIT','PERSON_PROFILE_EDIT','PERSON_LINK_EDIT','SELF_EDIT'));
RESET ROLE;
