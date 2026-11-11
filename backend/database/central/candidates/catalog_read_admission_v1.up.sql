-- Isolated catalog-read package, additive to projection_v1. Not an APP grant.
CREATE ROLE c4g_catalog_projection_approver NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SET ROLE c4g_catalog_projection_owner;
ALTER TABLE catalog_read.revision_projection DROP CONSTRAINT revision_projection_mapping_version_check;
ALTER TABLE catalog_read.revision_projection ADD CONSTRAINT revision_projection_mapping_version_check CHECK(mapping_version IN ('gcni-catalog-projection/1.0','gcni-catalog-projection/1.1'));
CREATE TABLE catalog_read.projection_approval (
 approval_id uuid PRIMARY KEY,
 projection_id uuid NOT NULL UNIQUE,
 extension_id uuid NOT NULL REFERENCES catalog_read.revision_extension(extension_id),
 acceptance_digest text NOT NULL CHECK(acceptance_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 approved_by name NOT NULL DEFAULT session_user,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK(expires_at>approved_at),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000)
);
CREATE TABLE catalog_read.approval_revocation (
 approval_id uuid PRIMARY KEY REFERENCES catalog_read.projection_approval(approval_id),
 revoked_by name NOT NULL DEFAULT session_user,
 revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000)
);
CREATE FUNCTION catalog_read.stamp_approval_actor() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 -- SQL principal is recorded by the DB, not supplied by an untrusted caller.
 IF TG_TABLE_NAME='projection_approval' THEN NEW.approved_by:=session_user;NEW.approved_at:=clock_timestamp();
 ELSE NEW.revoked_by:=session_user;NEW.revoked_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stamp_approval BEFORE INSERT ON catalog_read.projection_approval FOR EACH ROW EXECUTE FUNCTION catalog_read.stamp_approval_actor();
CREATE TRIGGER stamp_revocation BEFORE INSERT ON catalog_read.approval_revocation FOR EACH ROW EXECUTE FUNCTION catalog_read.stamp_approval_actor();
CREATE FUNCTION catalog_read.assert_projection_approved(p_id uuid,p_ext uuid,p_digest text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a catalog_read.projection_approval;
BEGIN
 SELECT * INTO a FROM catalog_read.projection_approval WHERE projection_id=p_id FOR SHARE;
 IF NOT FOUND OR a.extension_id<>p_ext OR a.payload_digest<>p_digest OR a.expires_at<=clock_timestamp()
 OR EXISTS(SELECT 1 FROM catalog_read.approval_revocation WHERE approval_id=a.approval_id)
 OR NOT EXISTS(SELECT 1 FROM catalog_read.revision_extension e WHERE e.extension_id=p_ext AND e.acceptance_digest=a.acceptance_digest)
 THEN RAISE EXCEPTION 'CATALOG_READ_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION catalog_read.guard_projection_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM catalog_read.assert_projection_approved(NEW.projection_id,NEW.extension_id,encode(sha256(convert_to(NEW.payload::text,'UTF8')),'hex'));
 RETURN NEW;
END $$;
CREATE TRIGGER projection_approval_required BEFORE INSERT ON catalog_read.revision_projection FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_projection_approval();
CREATE FUNCTION catalog_read.guard_generation_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p catalog_read.revision_projection;
BEGIN
 IF NEW.state='PUBLISHED' THEN
  FOR p IN SELECT r.* FROM catalog_read.generation_item i JOIN catalog_read.revision_projection r USING(projection_id) WHERE i.generation_id=NEW.generation_id LOOP
   PERFORM catalog_read.assert_projection_approved(p.projection_id,p.extension_id,p.payload_digest);
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.payload#>'{collections,conflicts}') c WHERE c->>'severity'='material' AND c->>'status'='unresolved')
    OR (p.payload#>'{detail,summary,quality,flags}') ? 'conflicted'
   THEN RAISE EXCEPTION 'CATALOG_READ_CONFLICT_PUBLICATION_BLOCKED' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_approval BEFORE INSERT OR UPDATE ON catalog_read.generation FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_generation_approval();
CREATE FUNCTION catalog_read.guard_activation_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p catalog_read.revision_projection;
BEGIN
 FOR p IN SELECT r.* FROM catalog_read.generation_item i JOIN catalog_read.revision_projection r USING(projection_id) WHERE i.generation_id=NEW.generation_id LOOP
  PERFORM catalog_read.assert_projection_approved(p.projection_id,p.extension_id,p.payload_digest);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER active_approval BEFORE INSERT OR UPDATE ON catalog_read.active_generation FOR EACH ROW EXECUTE FUNCTION catalog_read.guard_activation_approval();
-- Revocation takes the same row lock as publication, serializing the boundary.
CREATE FUNCTION catalog_read.lock_revocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM 1 FROM catalog_read.projection_approval WHERE approval_id=NEW.approval_id FOR UPDATE;RETURN NEW;END $$;
CREATE TRIGGER revocation_lock BEFORE INSERT ON catalog_read.approval_revocation FOR EACH ROW EXECUTE FUNCTION catalog_read.lock_revocation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['projection_approval','approval_revocation'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON catalog_read.%I FOR EACH ROW EXECUTE FUNCTION catalog_read.reject_mutation()',t);
  EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON catalog_read.%I FOR EACH STATEMENT EXECUTE FUNCTION catalog_read.reject_mutation()',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA catalog_read FROM PUBLIC;
REVOKE ALL ON catalog_read.projection_approval,catalog_read.approval_revocation FROM PUBLIC;
GRANT USAGE ON SCHEMA catalog_read TO c4g_catalog_projection_approver;
GRANT SELECT ON catalog_read.revision_extension,catalog_read.revision_projection,catalog_read.projection_approval,catalog_read.approval_revocation TO c4g_catalog_projection_approver;
GRANT INSERT ON catalog_read.projection_approval,catalog_read.approval_revocation TO c4g_catalog_projection_approver;
RESET ROLE;
