-- S6 candidate: isolated rehearsal only, excluded from the active manifest.
-- Existing v1 revisions and digests are never rewritten.
ALTER TABLE opportunity_catalog.opportunity ADD COLUMN current_schema_version smallint NOT NULL DEFAULT 1 CHECK(current_schema_version IN(1,2));
ALTER TABLE opportunity_catalog.opportunity ALTER COLUMN funder_name DROP NOT NULL;
ALTER TABLE opportunity_catalog.opportunity ALTER COLUMN quality_score DROP NOT NULL;
ALTER TABLE opportunity_catalog.opportunity ALTER COLUMN quality_bucket DROP NOT NULL;
ALTER TABLE opportunity_catalog.opportunity DROP CONSTRAINT opportunity_normalization_version_check;
ALTER TABLE opportunity_catalog.opportunity DROP CONSTRAINT opportunity_quality_rule_version_check;
ALTER TABLE opportunity_catalog.opportunity ADD CONSTRAINT opportunity_versioned_aliases CHECK(
 (current_schema_version=1 AND funder_name IS NOT NULL AND quality_score IS NOT NULL AND quality_bucket IS NOT NULL AND normalization_version='opportunity-normalization-v1' AND quality_rule_version='opportunity-quality-v1') OR
 (current_schema_version=2 AND normalization_version='opportunity-normalization-v2' AND quality_rule_version='opportunity-quality-v2.0'));
ALTER TABLE opportunity_catalog.revision ADD COLUMN snapshot_schema_version smallint GENERATED ALWAYS AS ((snapshot->>'schemaVersion')::smallint) STORED;
ALTER TABLE opportunity_catalog.revision ADD CONSTRAINT revision_versioned_contract CHECK(snapshot_schema_version IS NOT NULL AND (snapshot_schema_version=1 OR (snapshot_schema_version=2 AND (snapshot->>'contractVersion') IS NOT DISTINCT FROM 'opportunity-v2.0' AND octet_length(snapshot::text)<=262144)));
ALTER TABLE opportunity_catalog.revision ADD CONSTRAINT revision_opportunity_pair UNIQUE(opportunity_id,revision_id);
ALTER TABLE opportunity_catalog.opportunity ADD CONSTRAINT opportunity_current_revision_pair FOREIGN KEY(opportunity_id,current_revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER revision_no_truncate BEFORE TRUNCATE ON opportunity_catalog.revision FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE FUNCTION opportunity_catalog.guard_current_revision_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.opportunity o LEFT JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE o.opportunity_id=NEW.opportunity_id AND
  (r.revision_id IS NULL OR r.snapshot_schema_version<>o.current_schema_version OR r.revision_number<>o.revision_number OR r.row_version<>o.row_version OR r.content_digest<>o.content_digest)) THEN
  RAISE EXCEPTION 'OPPORTUNITY_CURRENT_REVISION_MISMATCH';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER opportunity_current_revision_version AFTER INSERT OR UPDATE ON opportunity_catalog.opportunity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_current_revision_version();

CREATE FUNCTION opportunity_catalog.v2_decimal_valid(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$ SELECT value ~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{0,7}[1-9])?$' $$;
CREATE FUNCTION opportunity_catalog.v2_iso_date(value text) RETURNS date LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $$ SELECT make_date(CASE WHEN substring(value,1,4)::int=0 THEN -1 ELSE substring(value,1,4)::int END,substring(value,6,2)::int,substring(value,9,2)::int) $$;
CREATE FUNCTION opportunity_catalog.v2_iso_instant(value text) RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $$ SELECT (opportunity_catalog.v2_iso_date(value)+substring(value,12,12)::time) AT TIME ZONE 'UTC' $$;
ALTER TABLE opportunity_catalog.opportunity ADD COLUMN last_v2_observed_at text CHECK(last_v2_observed_at IS NULL OR
 (last_v2_observed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$' AND opportunity_catalog.v2_iso_instant(last_v2_observed_at) IS NOT NULL));

CREATE TABLE opportunity_catalog.source_identity_v2 (
 source_namespace text NOT NULL,external_identifier text NOT NULL,opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(source_namespace,external_identifier),CHECK(length(external_identifier) BETWEEN 1 AND 256));
CREATE TABLE opportunity_catalog.source_observation_v2 (
 observation_id uuid PRIMARY KEY,source_namespace text NOT NULL,external_identifier text NOT NULL,observed_at timestamptz NOT NULL,artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object'),recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp());
CREATE TABLE opportunity_catalog.revision_evidence_v2 (
 opportunity_id uuid NOT NULL,revision_id uuid NOT NULL,local_evidence_id text NOT NULL,observation_id uuid NOT NULL REFERENCES opportunity_catalog.source_observation_v2(observation_id),evidence jsonb NOT NULL,
 PRIMARY KEY(revision_id,local_evidence_id),FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id));
CREATE TABLE opportunity_catalog.revision_allocation_v2 (
 opportunity_id uuid NOT NULL,revision_id uuid NOT NULL,allocation_key text NOT NULL,payload jsonb NOT NULL,
 amount_canonical text NOT NULL CHECK(opportunity_catalog.v2_decimal_valid(amount_canonical)),amount numeric(32,8) GENERATED ALWAYS AS (amount_canonical::numeric(32,8)) STORED,
 currency_state text NOT NULL,currency_code text,PRIMARY KEY(revision_id,allocation_key),FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id),
 CHECK(amount_canonical=payload#>>'{money,amount}'),CHECK(currency_state=payload#>>'{money,currency,state}'),CHECK(currency_code IS NOT DISTINCT FROM payload#>>'{money,currency,value}'),
 CHECK((currency_state='PRESENT' AND currency_code IS NOT NULL AND currency_code ~ '^[A-Z]{3}$') OR (currency_state IN('NOT_FOUND','NOT_COLLECTED','NOT_APPLICABLE','CONFLICT','UNSUPPORTED') AND currency_code IS NULL)));
CREATE TABLE opportunity_catalog.revision_financial_detail_v2 (
 opportunity_id uuid NOT NULL,revision_id uuid NOT NULL,collection text NOT NULL CHECK(collection IN('support','rates','eligibleCosts')),ordinal integer NOT NULL CHECK(ordinal>=0),payload jsonb NOT NULL,
 minimum_canonical text CHECK(minimum_canonical IS NULL OR opportunity_catalog.v2_decimal_valid(minimum_canonical)),maximum_canonical text CHECK(maximum_canonical IS NULL OR opportunity_catalog.v2_decimal_valid(maximum_canonical)),
 minimum_amount numeric(32,8) GENERATED ALWAYS AS (minimum_canonical::numeric(32,8)) STORED,maximum_amount numeric(32,8) GENERATED ALWAYS AS (maximum_canonical::numeric(32,8)) STORED,
 PRIMARY KEY(revision_id,collection,ordinal),FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id),
 CHECK(minimum_canonical IS NOT DISTINCT FROM CASE WHEN collection='rates' THEN payload->>'minimumPercent' ELSE payload->>'minimum' END),
 CHECK(maximum_canonical IS NOT DISTINCT FROM CASE WHEN collection='rates' THEN payload->>'maximumPercent' ELSE payload->>'maximum' END),
 CHECK(minimum_amount IS NULL OR maximum_amount IS NULL OR minimum_amount<=maximum_amount),CHECK(collection<>'rates' OR (COALESCE(minimum_amount,0)<=100 AND COALESCE(maximum_amount,0)<=100)));
CREATE TABLE opportunity_catalog.revision_concept_v2 (
 opportunity_id uuid NOT NULL,revision_id uuid NOT NULL,collection text NOT NULL CHECK(collection IN('programmes','funds')),concept_key text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(revision_id,collection,concept_key),FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id));
CREATE TABLE opportunity_catalog.revision_allocation_concept_v2 (
 revision_id uuid NOT NULL,allocation_key text NOT NULL,collection text NOT NULL,concept_key text NOT NULL,
 PRIMARY KEY(revision_id,allocation_key,collection,concept_key),FOREIGN KEY(revision_id,allocation_key) REFERENCES opportunity_catalog.revision_allocation_v2(revision_id,allocation_key),
 FOREIGN KEY(revision_id,collection,concept_key) REFERENCES opportunity_catalog.revision_concept_v2(revision_id,collection,concept_key));
CREATE TABLE opportunity_catalog.revision_deadline_v2 (
 opportunity_id uuid NOT NULL,revision_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),payload jsonb NOT NULL,
 temporal_precision text GENERATED ALWAYS AS (payload#>>'{at,precision}') STORED NOT NULL,
 date_value date GENERATED ALWAYS AS (CASE WHEN payload#>>'{at,precision}'='DATE' THEN opportunity_catalog.v2_iso_date(payload#>>'{at,value}') END) STORED,
 instant_value timestamptz GENERATED ALWAYS AS (CASE WHEN payload#>>'{at,precision}'='INSTANT' THEN opportunity_catalog.v2_iso_instant(payload#>>'{at,value}') END) STORED,
 period_start date GENERATED ALWAYS AS (CASE WHEN payload#>>'{at,precision}'='PERIOD' THEN opportunity_catalog.v2_iso_date(payload#>>'{at,start}') END) STORED,
 period_end date GENERATED ALWAYS AS (CASE WHEN payload#>>'{at,precision}'='PERIOD' THEN opportunity_catalog.v2_iso_date(payload#>>'{at,end}') END) STORED,
 PRIMARY KEY(revision_id,ordinal),FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id),
 CHECK((temporal_precision='DATE' AND date_value IS NOT NULL) OR (temporal_precision='INSTANT' AND instant_value IS NOT NULL) OR (temporal_precision='PERIOD' AND period_start IS NOT NULL AND period_end IS NOT NULL AND period_end>=period_start)));
CREATE TABLE opportunity_catalog.accepted_receipt_v2 (
 request_id text PRIMARY KEY CHECK(length(request_id) BETWEEN 8 AND 128),intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),opportunity_id uuid NOT NULL,revision_id uuid NOT NULL,
 mapping_digest text NOT NULL CHECK(mapping_digest ~ '^[a-f0-9]{64}$'),approval_digest text NOT NULL CHECK(approval_digest ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id));

CREATE FUNCTION opportunity_catalog.guard_v2_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source jsonb;expected jsonb;observation jsonb;expected_observation jsonb;
BEGIN
 SELECT snapshot INTO source FROM opportunity_catalog.revision WHERE revision_id=NEW.revision_id AND opportunity_id=NEW.opportunity_id AND snapshot_schema_version=2;
 SELECT value INTO expected FROM jsonb_array_elements(source#>'{provenance,evidence}') WHERE value->>'id'=NEW.local_evidence_id;
 SELECT o.observation INTO observation FROM opportunity_catalog.source_observation_v2 o WHERE o.observation_id=NEW.observation_id;
 SELECT value INTO expected_observation FROM jsonb_array_elements(source#>'{provenance,observations}') WHERE value->>'id'=NEW.evidence->>'observationId';
 IF source IS NULL OR expected IS NULL OR expected IS DISTINCT FROM NEW.evidence OR observation IS NULL OR expected_observation IS DISTINCT FROM observation THEN RAISE EXCEPTION 'V2_EVIDENCE_BINDING_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_evidence_v2_binding BEFORE INSERT ON opportunity_catalog.revision_evidence_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_v2_evidence();
CREATE FUNCTION opportunity_catalog.guard_v2_allocation_link() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source jsonb;refs jsonb;
BEGIN
 SELECT payload INTO source FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=NEW.revision_id AND allocation_key=NEW.allocation_key;
 refs:=CASE NEW.collection WHEN 'programmes' THEN source->'programmeRefs' WHEN 'funds' THEN source->'fundRefs' END;
 IF source IS NULL OR refs IS NULL OR NOT(refs ? NEW.concept_key) THEN RAISE EXCEPTION 'V2_ALLOCATION_LINK_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_allocation_concept_v2_binding BEFORE INSERT ON opportunity_catalog.revision_allocation_concept_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_v2_allocation_link();

-- Derived rows must describe their own immutable snapshot, even when a caller
-- bypasses the JavaScript writer. Fact envelopes remain the source of absence.
CREATE FUNCTION opportunity_catalog.guard_v2_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source jsonb;expected jsonb;
BEGIN
 SELECT snapshot INTO source FROM opportunity_catalog.revision WHERE revision_id=NEW.revision_id AND opportunity_id=NEW.opportunity_id AND snapshot_schema_version=2;
 IF source IS NULL THEN RAISE EXCEPTION 'V2_REVISION_BINDING_REQUIRED'; END IF;
 IF TG_TABLE_NAME='revision_allocation_v2' THEN SELECT value INTO expected FROM jsonb_array_elements(source#>'{financing,allocations,value}') WHERE value->>'key'=NEW.allocation_key;
 ELSIF TG_TABLE_NAME='revision_concept_v2' THEN SELECT value INTO expected FROM jsonb_array_elements(source#>ARRAY[NEW.collection,'value']) WHERE value->>'key'=NEW.concept_key;
 ELSIF TG_TABLE_NAME='revision_financial_detail_v2' THEN expected:=source#>ARRAY['financing',NEW.collection,'value',NEW.ordinal::text];
 ELSIF TG_TABLE_NAME='revision_deadline_v2' THEN expected:=source#>ARRAY['schedule','deadlines','value',NEW.ordinal::text];
 END IF;
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.payload THEN RAISE EXCEPTION 'V2_PROJECTION_MISMATCH'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['source_identity_v2','source_observation_v2','revision_evidence_v2','revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2','accepted_receipt_v2'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I OWNER TO c4g_opportunity_central_owner',table_name);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_catalog_reader',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_central_runtime',table_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation()',table_name||'_immutable',table_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation()',table_name||'_no_truncate',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_deadline_v2'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_v2_projection()',table_name||'_binding',table_name);
 END LOOP;
END $$;
ALTER FUNCTION opportunity_catalog.v2_decimal_valid(text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.v2_iso_date(text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.v2_iso_instant(text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_v2_projection() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_current_revision_version() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_v2_evidence() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_v2_allocation_link() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.v2_decimal_valid(text),opportunity_catalog.v2_iso_date(text),opportunity_catalog.v2_iso_instant(text),opportunity_catalog.guard_v2_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_current_revision_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_v2_evidence(),opportunity_catalog.guard_v2_allocation_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.v2_decimal_valid(text),opportunity_catalog.v2_iso_date(text),opportunity_catalog.v2_iso_instant(text),opportunity_catalog.guard_v2_projection() TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION opportunity_catalog.guard_current_revision_version() TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION opportunity_catalog.guard_v2_evidence(),opportunity_catalog.guard_v2_allocation_link() TO c4g_opportunity_central_runtime;
GRANT SELECT ON opportunity_catalog.revision_allocation_v2,opportunity_catalog.revision_financial_detail_v2,opportunity_catalog.revision_concept_v2,opportunity_catalog.revision_allocation_concept_v2,opportunity_catalog.revision_deadline_v2 TO c4g_catalog_reader;
