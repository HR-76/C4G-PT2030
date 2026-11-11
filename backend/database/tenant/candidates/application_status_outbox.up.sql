-- Runtime receives a closed enqueue function, never direct outbox table access.
GRANT USAGE ON SCHEMA async_exec TO c4g_opportunity_tenant_owner;
GRANT INSERT ON async_exec.outbox TO c4g_opportunity_tenant_owner;
SET ROLE c4g_opportunity_tenant_owner;
CREATE FUNCTION opportunity_catalog.enqueue_status_delivery(p_org uuid,p_delivery uuid,p_outbox uuid,p_envelope jsonb,p_digest text,p_available timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,opportunity_catalog,pg_temp AS $$
BEGIN
 IF p_org IS DISTINCT FROM nullif(current_setting('app.organization_id',true),'')::uuid
 OR NOT EXISTS(SELECT 1 FROM opportunity_catalog.application_status_delivery WHERE organization_id=p_org AND delivery_id=p_delivery AND state='PENDING')
 OR p_envelope->>'organizationId' IS DISTINCT FROM p_org::text
 OR p_envelope->>'jobType' IS DISTINCT FROM 'application.status.notify'
 OR p_envelope->>'operation' IS DISTINCT FROM 'application.status.notify'
 OR p_envelope->>'idempotencyKey' IS DISTINCT FROM p_delivery::text
 OR p_envelope->'payload' IS DISTINCT FROM jsonb_build_object('deliveryId',p_delivery)
 OR p_envelope->'actor' IS DISTINCT FROM '{"kind":"SERVICE","serviceActorCode":"APPLICATION_STATUS_NOTIFY"}'::jsonb
 OR p_envelope->>'envelopeVersion' IS DISTINCT FROM '1'
 OR p_envelope->>'jobVersion' IS DISTINCT FROM '1' OR p_envelope->>'payloadVersion' IS DISTINCT FROM '1'
 OR (SELECT count(*) FROM jsonb_object_keys(p_envelope))<>14
 THEN RAISE EXCEPTION 'STATUS_OUTBOX_CONTEXT_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO async_exec.outbox(outbox_id,organization_id,logical_id,envelope,digest_sha256,state,available_at)
 VALUES(p_outbox,p_org,p_delivery::text,p_envelope,p_digest,'PENDING',p_available);
 RETURN p_outbox;
END $$;
REVOKE ALL ON FUNCTION opportunity_catalog.enqueue_status_delivery(uuid,uuid,uuid,jsonb,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.enqueue_status_delivery(uuid,uuid,uuid,jsonb,text,timestamptz) TO c4g_opportunity_tenant_runtime;
RESET ROLE;
