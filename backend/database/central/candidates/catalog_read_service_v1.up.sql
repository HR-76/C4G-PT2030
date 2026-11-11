-- Isolated read package. No memberships or active application routes.
SET ROLE c4g_catalog_projection_owner;
ALTER TABLE catalog_read.revision_projection DROP CONSTRAINT revision_projection_mapping_version_check;
ALTER TABLE catalog_read.revision_projection ADD CONSTRAINT revision_projection_mapping_version_check CHECK(mapping_version IN ('gcni-catalog-projection/1.0','gcni-catalog-projection/1.1','gcni-catalog-projection/1.2'));
CREATE VIEW catalog_read.published_generation WITH(security_barrier=true) AS
 SELECT generation_id,as_of,published_at,expected_count FROM catalog_read.generation WHERE state='PUBLISHED';
REVOKE ALL ON catalog_read.published_generation FROM PUBLIC;
GRANT SELECT ON catalog_read.published_generation TO c4g_catalog_projection_reader;
RESET ROLE;

GRANT SELECT ON public.c4g_schema_migration TO c4g_catalog_projection_reader;
-- Separate central authority reader: column grants only, no catalogue writes.
CREATE ROLE c4g_catalog_projection_membership NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO c4g_catalog_projection_membership;
GRANT SELECT(sid,global_user_id,status,revocation_version,expires_at,selected_organization_id,selected_membership_id,selected_membership_version) ON public.application_session TO c4g_catalog_projection_membership;
GRANT SELECT(sid,sess,expire) ON public.application_session_store TO c4g_catalog_projection_membership;
GRANT SELECT(id,status,session_revocation_version) ON public.global_user TO c4g_catalog_projection_membership;
GRANT SELECT(id,global_user_id,organization_id,status,membership_version,base_role_code,valid_from,valid_until) ON public.organization_membership TO c4g_catalog_projection_membership;
GRANT SELECT(id,status) ON public.organization TO c4g_catalog_projection_membership;
