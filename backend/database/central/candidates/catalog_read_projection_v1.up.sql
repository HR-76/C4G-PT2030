-- GCNI-CAT-01: candidate only. Never registered or installed by application startup.
-- Requires the existing opportunity_catalog v2 pair FK/immutable revision contract.
CREATE ROLE c4g_catalog_projection_owner NOLOGIN NOINHERIT;
CREATE ROLE c4g_catalog_projection_writer NOLOGIN NOINHERIT;
CREATE ROLE c4g_catalog_projection_reader NOLOGIN NOINHERIT;
CREATE SCHEMA catalog_read AUTHORIZATION c4g_catalog_projection_owner;
REVOKE ALL ON SCHEMA catalog_read FROM PUBLIC;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_catalog_projection_owner;
GRANT SELECT,REFERENCES ON opportunity_catalog.revision TO c4g_catalog_projection_owner;
SET ROLE c4g_catalog_projection_owner;
CREATE TABLE catalog_read.revision_extension (
 extension_id uuid PRIMARY KEY, opportunity_id uuid NOT NULL, revision_id uuid NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 acceptance_digest text NOT NULL CHECK(acceptance_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 UNIQUE(opportunity_id,revision_id,extension_id),
 FOREIGN KEY(opportunity_id,revision_id) REFERENCES opportunity_catalog.revision(opportunity_id,revision_id),
 CHECK(octet_length(payload::text)<=4194304),
 CHECK((payload->>'version') IS NOT DISTINCT FROM 'gcni-revision-extension/1.0'),
 CHECK((payload->>'extensionId') IS NOT DISTINCT FROM extension_id::text),
 CHECK((payload->>'opportunityId') IS NOT DISTINCT FROM opportunity_id::text),
 CHECK((payload->>'revisionId') IS NOT DISTINCT FROM revision_id::text),
 CHECK((payload->>'sourceDigest') IS NOT DISTINCT FROM source_digest),
 CHECK((payload->>'acceptanceDigest') IS NOT DISTINCT FROM acceptance_digest),
 CHECK((payload->>'recordedAt')::timestamptz IS NOT DISTINCT FROM recorded_at)
);
CREATE TABLE catalog_read.revision_projection (
 projection_id uuid PRIMARY KEY, opportunity_id uuid NOT NULL, revision_id uuid NOT NULL, extension_id uuid NOT NULL,
 mapping_version text NOT NULL CHECK(mapping_version='gcni-catalog-projection/1.0'), as_of timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8388608),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(opportunity_id,revision_id,projection_id),
 FOREIGN KEY(opportunity_id,revision_id,extension_id) REFERENCES catalog_read.revision_extension(opportunity_id,revision_id,extension_id),
 CHECK((payload->>'version') IS NOT DISTINCT FROM mapping_version),
 CHECK((payload->>'opportunityId') IS NOT DISTINCT FROM opportunity_id::text),
 CHECK((payload->>'revisionId') IS NOT DISTINCT FROM revision_id::text),
 CHECK((payload->>'extensionId') IS NOT DISTINCT FROM extension_id::text),
 CHECK((payload->>'projectionId') IS NOT DISTINCT FROM projection_id::text),
 CHECK((payload->>'asOf')::timestamptz IS NOT DISTINCT FROM as_of),
 CHECK((payload#>>'{detail,summary,id}') IS NOT DISTINCT FROM opportunity_id::text),
 CHECK((payload#>>'{detail,summary,revisionId}') IS NOT DISTINCT FROM revision_id::text)
);
CREATE TABLE catalog_read.generation (
 generation_id uuid PRIMARY KEY, as_of timestamptz NOT NULL, expected_count integer NOT NULL CHECK(expected_count>=0),
 state text NOT NULL DEFAULT 'BUILDING' CHECK(state IN('BUILDING','PUBLISHED')),
 published_at timestamptz, CHECK((state='BUILDING' AND published_at IS NULL) OR (state='PUBLISHED' AND published_at IS NOT NULL))
);
CREATE TABLE catalog_read.generation_item (
 generation_id uuid NOT NULL REFERENCES catalog_read.generation(generation_id),
 opportunity_id uuid NOT NULL, revision_id uuid NOT NULL, projection_id uuid NOT NULL,
 PRIMARY KEY(generation_id,opportunity_id),
 FOREIGN KEY(opportunity_id,revision_id,projection_id) REFERENCES catalog_read.revision_projection(opportunity_id,revision_id,projection_id)
);
CREATE TABLE catalog_read.active_generation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation_id uuid NOT NULL REFERENCES catalog_read.generation(generation_id)
);
CREATE FUNCTION catalog_read.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'CATALOG_READ_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE FUNCTION catalog_read.guard_extension() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source_record record;
BEGIN
 SELECT content_digest,snapshot_schema_version INTO source_record FROM opportunity_catalog.revision WHERE opportunity_id=NEW.opportunity_id AND revision_id=NEW.revision_id;
 IF NOT FOUND OR source_record.snapshot_schema_version<>2 OR source_record.content_digest<>NEW.source_digest THEN
  RAISE EXCEPTION 'CATALOG_READ_SOURCE_BINDING' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION catalog_read.guard_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source_record record;
BEGIN
 SELECT source_digest,recorded_at INTO source_record FROM catalog_read.revision_extension WHERE extension_id=NEW.extension_id;
 IF NOT FOUND OR (NEW.payload->>'sourceDigest') IS DISTINCT FROM source_record.source_digest OR NEW.as_of<source_record.recorded_at THEN
  RAISE EXCEPTION 'CATALOG_READ_PROJECTION_BINDING' USING ERRCODE='23514';
 END IF;
 NEW.payload_digest:=encode(sha256(convert_to(NEW.payload::text,'UTF8')),'hex');
 RETURN NEW;
END $$;
CREATE FUNCTION catalog_read.guard_generation_item() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE g catalog_read.generation; p catalog_read.revision_projection;
BEGIN
 SELECT * INTO g FROM catalog_read.generation WHERE generation_id=NEW.generation_id FOR UPDATE;
 IF NOT FOUND OR g.state<>'BUILDING' THEN RAISE EXCEPTION 'CATALOG_READ_GENERATION_SEALED' USING ERRCODE='55000'; END IF;
 SELECT * INTO p FROM catalog_read.revision_projection WHERE projection_id=NEW.projection_id;
 IF NOT FOUND OR p.as_of<>g.as_of THEN RAISE EXCEPTION 'CATALOG_READ_GENERATION_CLOCK' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION catalog_read.guard_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'BUILDING' THEN RAISE EXCEPTION 'CATALOG_READ_BUILD_REQUIRED' USING ERRCODE='55000'; END IF;
 ELSE
  IF OLD.state<>'BUILDING' OR NEW.state<>'PUBLISHED' OR NEW.generation_id<>OLD.generation_id OR NEW.as_of<>OLD.as_of OR NEW.expected_count<>OLD.expected_count THEN
   RAISE EXCEPTION 'CATALOG_READ_GENERATION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM catalog_read.generation_item WHERE generation_id=NEW.generation_id)<>NEW.expected_count THEN
   RAISE EXCEPTION 'CATALOG_READ_GENERATION_INCOMPLETE' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION catalog_read.guard_active() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM catalog_read.generation WHERE generation_id=NEW.generation_id AND state='PUBLISHED') THEN
  RAISE EXCEPTION 'CATALOG_READ_PUBLICATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_extension_binding BEFORE INSERT ON catalog_read.revision_extension FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_extension();
CREATE TRIGGER revision_projection_binding BEFORE INSERT ON catalog_read.revision_projection FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_projection();
CREATE TRIGGER generation_item_binding BEFORE INSERT ON catalog_read.generation_item FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_generation_item();
CREATE TRIGGER generation_lifecycle BEFORE INSERT OR UPDATE ON catalog_read.generation FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_generation();
CREATE TRIGGER active_binding BEFORE INSERT OR UPDATE ON catalog_read.active_generation FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_active();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['revision_extension','revision_projection','generation_item'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON catalog_read.%I FOR EACH ROW EXECUTE FUNCTION catalog_read.reject_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['revision_extension','revision_projection','generation_item','generation','active_generation'] LOOP
  EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON catalog_read.%I FOR EACH STATEMENT EXECUTE FUNCTION catalog_read.reject_mutation()',t);
 END LOOP;
END $$;
CREATE TRIGGER generation_no_delete BEFORE DELETE ON catalog_read.generation FOR EACH ROW EXECUTE FUNCTION catalog_read.reject_mutation();
CREATE VIEW catalog_read.published_projection WITH(security_barrier=true) AS
 SELECT i.generation_id,i.opportunity_id,i.revision_id,i.projection_id,p.payload,p.payload_digest,g.as_of,g.published_at
 FROM catalog_read.generation g JOIN catalog_read.generation_item i USING(generation_id)
 JOIN catalog_read.revision_projection p USING(projection_id,opportunity_id,revision_id)
 WHERE g.state='PUBLISHED';
CREATE VIEW catalog_read.current_generation WITH(security_barrier=true) AS
 SELECT g.generation_id,g.as_of,g.published_at FROM catalog_read.active_generation a JOIN catalog_read.generation g USING(generation_id) WHERE g.state='PUBLISHED';
REVOKE ALL ON ALL TABLES IN SCHEMA catalog_read FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA catalog_read FROM PUBLIC;
GRANT USAGE ON SCHEMA catalog_read TO c4g_catalog_projection_writer,c4g_catalog_projection_reader;
GRANT SELECT,INSERT ON catalog_read.revision_extension,catalog_read.revision_projection,catalog_read.generation_item TO c4g_catalog_projection_writer;
GRANT SELECT,INSERT,UPDATE ON catalog_read.generation,catalog_read.active_generation TO c4g_catalog_projection_writer;
GRANT SELECT ON catalog_read.published_projection,catalog_read.current_generation TO c4g_catalog_projection_reader;
RESET ROLE;
-- No memberships for application roles; admission/authority integration is a later increment.
