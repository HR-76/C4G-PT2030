SET ROLE c4g_organization_profile_owner;
CREATE POLICY financial_metric_read ON organization_profile.metric_definition FOR SELECT USING(EXISTS(
 SELECT 1 FROM organization_profile.metric_catalog_release r WHERE r.metric_release_id=metric_definition.metric_release_id
  AND (r.organization_id IS NULL OR r.organization_id=current_setting('app.organization_id',true)::uuid)));
CREATE TABLE organization_profile.financial_catalog_release (
 release_id uuid PRIMARY KEY,organization_id uuid,release_version text NOT NULL CHECK(release_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 lifecycle text NOT NULL CHECK(lifecycle='PUBLISHED'),created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE organization_profile.financial_catalog_entry (
 entry_id uuid PRIMARY KEY,release_id uuid NOT NULL REFERENCES organization_profile.financial_catalog_release(release_id),organization_id uuid,
 kind text NOT NULL CHECK(kind IN('CURRENCY','METHOD','REASON','PURPOSE')),stable_code text NOT NULL CHECK(stable_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 currency_code text,unit_code text,operations text[] NOT NULL,
 CHECK(cardinality(operations)>0 AND operations <@ ARRAY['CREATE','EDIT','READ','SUBMIT','VERIFY','REJECT','DISPUTE','REVOKE']::text[]),
 CHECK((kind='CURRENCY' AND currency_code IS NOT NULL AND unit_code IS NOT NULL AND currency_code ~ '^[A-Z]{3}$' AND unit_code ~ '^[A-Z][A-Z0-9_]{0,31}$')
  OR (kind<>'CURRENCY' AND currency_code IS NULL AND unit_code IS NULL)),UNIQUE(release_id,kind,stable_code)
);
CREATE TABLE organization_profile.financial_assertion (
 assertion_id uuid PRIMARY KEY,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,head_revision bigint NOT NULL CHECK(head_revision>0),
 UNIQUE(organization_id,assertion_id),UNIQUE(organization_id,assertion_id,profile_scope_id),
 FOREIGN KEY(organization_id,profile_scope_id) REFERENCES organization_profile.profile_scope(organization_id,profile_scope_id)
);
CREATE TABLE organization_profile.financial_assertion_revision (
 organization_id uuid NOT NULL,assertion_id uuid NOT NULL,profile_scope_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 operation text NOT NULL CHECK(operation IN('CREATE','EDIT','SUBMIT','VERIFY','REJECT','DISPUTE','REVOKE')),
 state text NOT NULL CHECK(state IN('DRAFT','SUBMITTED','VERIFIED','REJECTED','DISPUTED','REVOKED')),
 knowledge_status text NOT NULL CHECK(knowledge_status='KNOWN'),amount_text text NOT NULL CHECK(amount_text ~ '^(0|[1-9][0-9]{0,17})\.[0-9]{6}$'),
 amount numeric(24,6) GENERATED ALWAYS AS (amount_text::numeric) STORED CHECK(amount>=0),
 currency_id uuid NOT NULL REFERENCES organization_profile.financial_catalog_entry(entry_id),metric_id uuid NOT NULL REFERENCES organization_profile.metric_definition(metric_id),
 start_date date NOT NULL,end_date date NOT NULL CHECK(start_date<=end_date),provenance_ref uuid NOT NULL,
 document_version_ids uuid[] NOT NULL CHECK(cardinality(document_version_ids)<=16 AND array_position(document_version_ids,NULL) IS NULL),
 method_id uuid REFERENCES organization_profile.financial_catalog_entry(entry_id),reason_id uuid REFERENCES organization_profile.financial_catalog_entry(entry_id),
 valid_from timestamptz,valid_until timestamptz,CHECK(valid_until IS NULL OR (valid_from IS NOT NULL AND valid_from<valid_until)),
 CHECK(state NOT IN('VERIFIED','DISPUTED','REVOKED') OR (method_id IS NOT NULL AND valid_from IS NOT NULL)),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,authorization_evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(organization_id,assertion_id,revision),
 FOREIGN KEY(organization_id,assertion_id,profile_scope_id) REFERENCES organization_profile.financial_assertion(organization_id,assertion_id,profile_scope_id)
);
ALTER TABLE organization_profile.financial_assertion ADD CONSTRAINT financial_head_fk
 FOREIGN KEY(organization_id,assertion_id,head_revision) REFERENCES organization_profile.financial_assertion_revision(organization_id,assertion_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE organization_profile.financial_idempotency_record (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('FINANCIAL_CREATE','FINANCIAL_EDIT','FINANCIAL_READ','FINANCIAL_SUBMIT','FINANCIAL_VERIFY','FINANCIAL_REJECT','FINANCIAL_DISPUTE','FINANCIAL_REVOKE')),
 idempotency_key uuid NOT NULL,intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),assertion_id uuid NOT NULL,revision bigint NOT NULL,result_projection jsonb NOT NULL,
 PRIMARY KEY(organization_id,operation,idempotency_key),FOREIGN KEY(organization_id,assertion_id,revision) REFERENCES organization_profile.financial_assertion_revision(organization_id,assertion_id,revision)
);
CREATE FUNCTION organization_profile.financial_entry_valid(id uuid,org uuid,expected_kind text,op text) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM organization_profile.financial_catalog_entry e JOIN organization_profile.financial_catalog_release r
  ON r.release_id=e.release_id AND r.organization_id IS NOT DISTINCT FROM e.organization_id
  WHERE e.entry_id=id AND e.kind=expected_kind AND (e.organization_id IS NULL OR e.organization_id=org) AND r.lifecycle='PUBLISHED' AND op=ANY(e.operations))
$$;
CREATE FUNCTION organization_profile.guard_financial_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous organization_profile.financial_assertion_revision; head bigint; scope_type text; unit text;
BEGIN
 IF TG_TABLE_NAME='financial_catalog_entry' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.financial_catalog_release WHERE release_id=NEW.release_id AND organization_id IS NOT DISTINCT FROM NEW.organization_id)
  THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF; RETURN NEW;
 END IF;
 SELECT s.scope_type INTO scope_type FROM organization_profile.profile_scope s WHERE s.organization_id=NEW.organization_id AND s.profile_scope_id=NEW.profile_scope_id;
 IF scope_type IS DISTINCT FROM 'ORGANIZATION' THEN RAISE EXCEPTION 'F13_FINANCIAL_ORG_ONLY'; END IF;
 SELECT head_revision INTO head FROM organization_profile.financial_assertion WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id FOR UPDATE;
 SELECT * INTO previous FROM organization_profile.financial_assertion_revision WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id AND revision=head;
 IF NOT FOUND THEN
  IF NEW.revision<>1 OR NEW.operation<>'CREATE' OR NEW.state<>'DRAFT' THEN RAISE EXCEPTION 'F13_FINANCIAL_STATE_CONFLICT'; END IF;
 ELSE
  IF NEW.revision<>head+1 OR NOT ((NEW.operation='EDIT' AND previous.state='DRAFT' AND NEW.state='DRAFT')
   OR (NEW.operation='SUBMIT' AND previous.state='DRAFT' AND NEW.state='SUBMITTED')
   OR (NEW.operation IN('VERIFY','REJECT') AND previous.state='SUBMITTED' AND NEW.state=CASE NEW.operation WHEN 'VERIFY' THEN 'VERIFIED' ELSE 'REJECTED' END)
   OR (NEW.operation='DISPUTE' AND previous.state='VERIFIED' AND NEW.state='DISPUTED')
   OR (NEW.operation='REVOKE' AND previous.state IN('VERIFIED','DISPUTED') AND NEW.state='REVOKED'))
  THEN RAISE EXCEPTION 'F13_FINANCIAL_STATE_CONFLICT'; END IF;
  IF NEW.operation IN('DISPUTE','REVOKE') AND previous.valid_until IS NOT NULL AND previous.valid_until<clock_timestamp()
  THEN RAISE EXCEPTION 'F13_FINANCIAL_STATE_CONFLICT'; END IF;
  IF NEW.operation<>'EDIT' AND ROW(NEW.amount_text,NEW.currency_id,NEW.metric_id,NEW.start_date,NEW.end_date,NEW.provenance_ref,NEW.document_version_ids)
   IS DISTINCT FROM ROW(previous.amount_text,previous.currency_id,previous.metric_id,previous.start_date,previous.end_date,previous.provenance_ref,previous.document_version_ids)
  THEN RAISE EXCEPTION 'F13_FINANCIAL_STATE_CONFLICT'; END IF;
 END IF;
 IF NOT organization_profile.financial_entry_valid(NEW.currency_id,NEW.organization_id,'CURRENCY','CREATE') THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF;
 SELECT e.unit_code INTO unit FROM organization_profile.financial_catalog_entry e WHERE e.entry_id=NEW.currency_id;
 IF NOT EXISTS(SELECT 1 FROM organization_profile.metric_definition m JOIN organization_profile.metric_catalog_release r ON r.metric_release_id=m.metric_release_id
  WHERE m.metric_id=NEW.metric_id AND m.value_kind='MONEY' AND m.unit_code=unit AND r.lifecycle='PUBLISHED' AND (r.organization_id IS NULL OR r.organization_id=NEW.organization_id))
 THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF;
 IF NEW.operation='VERIFY' AND NOT organization_profile.financial_entry_valid(NEW.method_id,NEW.organization_id,'METHOD','VERIFY') THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF;
 IF NEW.operation IN('REJECT','DISPUTE','REVOKE') AND (NEW.reason_id IS NULL OR NOT organization_profile.financial_entry_valid(NEW.reason_id,NEW.organization_id,'REASON',NEW.operation))
 THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.document_version_ids) AS x(id) WHERE NOT EXISTS(SELECT 1 FROM document_storage.load_financial_reference(NEW.organization_id,x.id,NEW.assertion_id)))
 THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organization_profile.guard_financial_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW.assertion_id,NEW.organization_id,NEW.profile_scope_id) IS DISTINCT FROM ROW(OLD.assertion_id,OLD.organization_id,OLD.profile_scope_id) OR NEW.head_revision<>OLD.head_revision+1)
 THEN RAISE EXCEPTION 'F13_FINANCIAL_STATE_CONFLICT'; END IF;
 IF (SELECT max(revision) FROM organization_profile.financial_assertion_revision WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id) IS DISTINCT FROM NEW.head_revision
 THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_HEAD'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER financial_revision_guard BEFORE INSERT ON organization_profile.financial_assertion_revision FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_financial_revision();
CREATE FUNCTION organization_profile.guard_financial_revision_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF (SELECT head_revision FROM organization_profile.financial_assertion WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id)
  IS DISTINCT FROM (SELECT max(revision) FROM organization_profile.financial_assertion_revision WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id)
 THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_HEAD'; END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER financial_revision_head_guard AFTER INSERT ON organization_profile.financial_assertion_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_financial_revision_head();
CREATE TRIGGER financial_catalog_guard BEFORE INSERT ON organization_profile.financial_catalog_entry FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_financial_revision();
CREATE CONSTRAINT TRIGGER financial_head_guard AFTER INSERT OR UPDATE ON organization_profile.financial_assertion DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_financial_head();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['financial_catalog_release','financial_catalog_entry','financial_assertion','financial_assertion_revision','financial_idempotency_record'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  IF tab LIKE 'financial_catalog_%' THEN
   EXECUTE format('CREATE POLICY financial_read ON organization_profile.%I FOR SELECT USING(organization_id IS NULL OR organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  ELSE
   EXECUTE format('CREATE POLICY financial_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  END IF;
  IF tab<>'financial_assertion' THEN EXECUTE format('CREATE TRIGGER financial_immutable BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  ELSE EXECUTE format('CREATE TRIGGER financial_no_delete BEFORE DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab); END IF;
  EXECUTE format('CREATE TRIGGER financial_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
 END LOOP;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION organization_profile.financial_entry_valid(uuid,uuid,text,text),organization_profile.guard_financial_revision(),organization_profile.guard_financial_head(),organization_profile.guard_financial_revision_head() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organization_profile.financial_entry_valid(uuid,uuid,text,text) TO c4g_organization_profile_runtime;
GRANT SELECT ON organization_profile.financial_catalog_release,organization_profile.financial_catalog_entry TO c4g_organization_profile_runtime;
GRANT SELECT ON organization_profile.metric_catalog_release,organization_profile.metric_definition TO c4g_organization_profile_runtime;
GRANT SELECT,INSERT ON organization_profile.financial_assertion,organization_profile.financial_assertion_revision,organization_profile.financial_idempotency_record TO c4g_organization_profile_runtime;
GRANT UPDATE(head_revision) ON organization_profile.financial_assertion TO c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
CREATE FUNCTION document_storage.load_financial_reference(expected_organization uuid,expected_version uuid,expected_assertion uuid)
 RETURNS TABLE(document_id uuid,version_id uuid,author_subject_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF expected_organization IS DISTINCT FROM current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'F13_FINANCIAL_INVALID_REFERENCE'; END IF;
 RETURN QUERY SELECT d.document_id,v.version_id,v.created_by_actor_id FROM document_storage.document d JOIN document_storage.document_version v
  ON v.organization_id=d.organization_id AND v.document_id=d.document_id
  WHERE v.organization_id=expected_organization AND v.version_id=expected_version AND d.resource_type='FINANCIAL_FACT'
   AND d.resource_id=expected_assertion AND v.state='AVAILABLE' AND v.scan_state='CLEAN' FOR SHARE OF d,v;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION document_storage.load_financial_reference(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_storage.load_financial_reference(uuid,uuid,uuid) TO c4g_organization_profile_runtime;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''FINANCIAL_ASSERTION_CREATED'',''FINANCIAL_ASSERTION_EDITED'',''FINANCIAL_ASSERTION_READ'',''FINANCIAL_ASSERTION_SUBMITTED'',''FINANCIAL_FACT_VERIFIED'',''FINANCIAL_ASSERTION_REJECTED'',''FINANCIAL_ASSERTION_DISPUTED'',''FINANCIAL_ASSERTION_REVOKED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK (('||substring(definition from 8 for length(definition)-8)||') OR catalog_version=''f13-financial-events-v1'')';
END $$;
