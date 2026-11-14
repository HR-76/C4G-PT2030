-- Explicit account deletion only. Installation does not anonymize existing records.
SET LOCAL ROLE c4g_organizational_scope_owner;
CREATE TABLE organizational_scope.account_identity_erasure (
 organization_id uuid NOT NULL,person_id uuid NOT NULL,membership_id uuid NOT NULL,
 global_user_id uuid NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,person_id),UNIQUE(organization_id,membership_id),
 FOREIGN KEY(organization_id,person_id) REFERENCES organizational_scope.person(organization_id,person_id)
);
ALTER TABLE organizational_scope.account_identity_erasure ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizational_scope.account_identity_erasure FORCE ROW LEVEL SECURITY;
CREATE POLICY directory_isolation ON organizational_scope.account_identity_erasure
 USING(organization_id=current_setting('app.organization_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
REVOKE ALL ON organizational_scope.account_identity_erasure FROM PUBLIC,c4g_opportunity_tenant_runtime;

CREATE FUNCTION organizational_scope.guard_erased_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,organizational_scope AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM organizational_scope.account_identity_erasure WHERE organization_id=OLD.organization_id AND person_id=OLD.person_id) THEN
  IF TG_TABLE_NAME='person' THEN
   IF NEW.name<>'Utilizador eliminado' OR NEW.email<>'' OR NEW.function_label<>'' OR NEW.active THEN RAISE EXCEPTION 'ACCOUNT_IDENTITY_ERASED'; END IF;
  ELSE
   IF NEW.biography<>'' OR NEW.keywords<>'' OR cardinality(NEW.area_ids)>0 OR cardinality(NEW.interest_area_ids)>0 OR NEW.membership_id IS DISTINCT FROM OLD.membership_id THEN RAISE EXCEPTION 'ACCOUNT_IDENTITY_ERASED'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION organizational_scope.guard_erased_identity() FROM PUBLIC;
CREATE TRIGGER person_erased_identity BEFORE UPDATE ON organizational_scope.person FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_erased_identity();
CREATE TRIGGER profile_erased_identity BEFORE UPDATE ON organizational_scope.person_profile FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_erased_identity();

CREATE FUNCTION organizational_scope.guard_receipt_identity_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organizational_scope AS $$
BEGIN
 IF TG_OP='UPDATE' AND current_user='c4g_organizational_scope_owner'
  AND (to_jsonb(NEW)-'result_projection')=(to_jsonb(OLD)-'result_projection')
  AND NEW.result_projection=OLD.result_projection-ARRAY['name','email','functionLabel','biography','keywords','areaIds','interestAreaIds']
  AND EXISTS(SELECT 1 FROM organizational_scope.account_identity_erasure WHERE organization_id=OLD.organization_id AND person_id=OLD.resource_id)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'DIRECTORY_HISTORY_IMMUTABLE';
END $$;
REVOKE ALL ON FUNCTION organizational_scope.guard_receipt_identity_erasure() FROM PUBLIC;
DROP TRIGGER directory_receipt_immutable ON organizational_scope.directory_receipt;
CREATE TRIGGER directory_receipt_immutable BEFORE UPDATE OR DELETE ON organizational_scope.directory_receipt FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_receipt_identity_erasure();

CREATE FUNCTION organizational_scope.erase_account_identity(org uuid,member uuid,subject uuid,request uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,organizational_scope AS $$
DECLARE erased_person_id uuid;prior organizational_scope.account_identity_erasure;
BEGIN
 IF org IS DISTINCT FROM current_setting('app.organization_id',true)::uuid OR member IS NULL OR subject IS NULL OR request IS NULL THEN RAISE EXCEPTION 'ACCOUNT_ERASURE_BINDING_INVALID'; END IF;
 SELECT person_id INTO STRICT erased_person_id FROM organizational_scope.person_profile WHERE organization_id=org AND membership_id=member FOR UPDATE;
 PERFORM 1 FROM organizational_scope.person WHERE organization_id=org AND person_id=erased_person_id FOR UPDATE;
 SELECT * INTO prior FROM organizational_scope.account_identity_erasure WHERE organization_id=org AND person_id=erased_person_id;
 IF FOUND THEN
  IF prior.membership_id<>member OR prior.global_user_id<>subject OR prior.request_id<>request THEN RAISE EXCEPTION 'ACCOUNT_ERASURE_CONFLICT'; END IF;
  RETURN erased_person_id;
 END IF;
 INSERT INTO organizational_scope.account_identity_erasure(organization_id,person_id,membership_id,global_user_id,request_id) VALUES(org,erased_person_id,member,subject,request);
 UPDATE organizational_scope.person SET name='Utilizador eliminado',email='',function_label='',active=false,revision=revision+1,updated_by=subject,updated_at=clock_timestamp() WHERE organization_id=org AND person_id=erased_person_id;
 UPDATE organizational_scope.person_profile SET biography='',keywords='',area_ids='{}',interest_area_ids='{}',revision=revision+1,updated_by=subject,updated_at=clock_timestamp() WHERE organization_id=org AND person_id=erased_person_id;
 UPDATE organizational_scope.directory_receipt SET result_projection=result_projection-ARRAY['name','email','functionLabel','biography','keywords','areaIds','interestAreaIds'] WHERE organization_id=org AND resource_id=erased_person_id AND result_projection ?| ARRAY['name','email','functionLabel','biography','keywords','areaIds','interestAreaIds'];
 RETURN erased_person_id;
END $$;
REVOKE ALL ON FUNCTION organizational_scope.erase_account_identity(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organizational_scope.erase_account_identity(uuid,uuid,uuid,uuid) TO c4g_opportunity_tenant_runtime;
RESET ROLE;
