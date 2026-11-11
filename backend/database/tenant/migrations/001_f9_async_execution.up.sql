CREATE SCHEMA async_exec AUTHORIZATION c4g_tenant_owner;
REVOKE ALL ON SCHEMA async_exec FROM PUBLIC;
GRANT USAGE ON SCHEMA async_exec TO c4g_tenant_runtime;
CREATE TYPE async_exec.outbox_state AS ENUM ('PENDING','CLAIMED','UNCERTAIN','PUBLISHED','FAILED','CANCELLED');
CREATE TYPE async_exec.inbox_state AS ENUM ('PROCESSING','COMPLETED','UNCERTAIN','FAILED','CANCELLED');
CREATE TABLE async_exec.outbox (
 outbox_id uuid PRIMARY KEY,organization_id uuid NOT NULL,logical_id text NOT NULL,envelope jsonb NOT NULL,
 digest_sha256 text NOT NULL CHECK(digest_sha256 ~ '^[a-f0-9]{64}$'),state async_exec.outbox_state NOT NULL,
 queue_id text,available_at timestamptz NOT NULL,claim_owner text,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),published_at timestamptz,
 UNIQUE(organization_id,logical_id),CHECK(octet_length(envelope::text)<=32768));
CREATE INDEX f9_tenant_outbox_claim ON async_exec.outbox(available_at,created_at) WHERE state IN ('PENDING','UNCERTAIN');
CREATE TABLE async_exec.inbox (
 consumer text NOT NULL,job_type text NOT NULL,job_version integer NOT NULL CHECK(job_version>0),organization_id uuid NOT NULL,
 idempotency_key text NOT NULL,digest_sha256 text NOT NULL CHECK(digest_sha256 ~ '^[a-f0-9]{64}$'),execution_id uuid NOT NULL,
 state async_exec.inbox_state NOT NULL,claim_owner text,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
 result_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,
 PRIMARY KEY(consumer,job_type,job_version,organization_id,idempotency_key));
CREATE TABLE async_exec.effect_fence (
 effect_key text PRIMARY KEY,organization_id uuid NOT NULL,fence bigint NOT NULL CHECK(fence>=0),digest_sha256 text NOT NULL CHECK(digest_sha256 ~ '^[a-f0-9]{64}$'),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE async_exec.reconciliation_item (
 reconciliation_id uuid PRIMARY KEY,kind text NOT NULL,reference_digest text NOT NULL CHECK(reference_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('OPEN','REPAIRED','ACKNOWLEDGED')),detail_code text,detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),resolved_at timestamptz,UNIQUE(kind,reference_digest));
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA async_exec TO c4g_tenant_runtime;
