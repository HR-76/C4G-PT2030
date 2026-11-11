-- Rehearsal-only package. Not an ordinary GCNI migration or installer.
BEGIN;
CREATE ROLE gcni_control_owner NOLOGIN NOINHERIT;
CREATE ROLE gcni_control_reader NOLOGIN NOINHERIT;
CREATE ROLE gcni_control_operator NOLOGIN NOINHERIT;
CREATE SCHEMA gcni_catalog_control_rehearsal AUTHORIZATION gcni_control_owner;
SET LOCAL ROLE gcni_control_owner;
CREATE TABLE gcni_catalog_control_rehearsal.state (
  singleton boolean PRIMARY KEY CHECK(singleton),
  policy jsonb NOT NULL
);
CREATE TABLE gcni_catalog_control_rehearsal.history (
  revision bigint PRIMARY KEY,
  policy jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor name NOT NULL DEFAULT session_user
);
INSERT INTO gcni_catalog_control_rehearsal.state VALUES(true,
  '{"revision":0,"mode":"OFF","organizations":[],"roles":[],"blockedGenerations":[],"expiresAt":null}');
INSERT INTO gcni_catalog_control_rehearsal.history(revision,policy) SELECT 0,policy FROM gcni_catalog_control_rehearsal.state;
CREATE FUNCTION gcni_catalog_control_rehearsal.transition(expected bigint, next_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_policy jsonb; field text; item jsonb; n bigint; db_now bigint;
BEGIN
  SELECT policy INTO STRICT old_policy FROM gcni_catalog_control_rehearsal.state WHERE singleton=true FOR UPDATE;
  IF (old_policy->>'revision')::bigint <> expected THEN
    RAISE EXCEPTION 'POLICY_VERSION_CONFLICT' USING ERRCODE='40001';
  END IF;
  IF jsonb_typeof(next_policy) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(next_policy))<>6 OR
     NOT next_policy ?& ARRAY['revision','mode','organizations','roles','blockedGenerations','expiresAt'] OR
     jsonb_typeof(next_policy->'revision') IS DISTINCT FROM 'number' OR
     next_policy->>'revision' !~ '^[0-9]+$' OR
     (next_policy->>'revision')::numeric <> expected+1 OR
     (next_policy->>'revision')::numeric > 9007199254740991 OR
     next_policy->>'mode' NOT IN ('OFF','COHORT') OR
     jsonb_typeof(next_policy->'mode') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_EXPOSURE_POLICY' USING ERRCODE='23514';
  END IF;
  FOREACH field IN ARRAY ARRAY['organizations','roles','blockedGenerations'] LOOP
    IF jsonb_typeof(next_policy->field) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_EXPOSURE_POLICY' USING ERRCODE='23514';
    END IF;
    n:=jsonb_array_length(next_policy->field);
    IF n>1000 OR n<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(next_policy->field)) THEN
      RAISE EXCEPTION 'INVALID_EXPOSURE_POLICY' USING ERRCODE='23514';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(next_policy->field) LOOP
      IF jsonb_typeof(item)<>'string' OR
         (field='roles' AND item#>>'{}' NOT IN ('ORG_ADMIN','CONTRIBUTOR')) OR
         (field<>'roles' AND item#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'INVALID_EXPOSURE_POLICY' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT ((old_policy->'blockedGenerations') <@ (next_policy->'blockedGenerations')) THEN
    RAISE EXCEPTION 'WITHDRAWAL_CANNOT_BE_REMOVED' USING ERRCODE='23514';
  END IF;
  IF next_policy->>'mode'='OFF' THEN
    IF next_policy->'expiresAt'<>'null'::jsonb OR next_policy->'organizations'<>'[]'::jsonb OR next_policy->'roles'<>'[]'::jsonb THEN
      RAISE EXCEPTION 'INVALID_EXPOSURE_POLICY' USING ERRCODE='23514';
    END IF;
  ELSE
    db_now:=floor(extract(epoch FROM clock_timestamp())*1000);
    IF jsonb_typeof(next_policy->'expiresAt') IS DISTINCT FROM 'number' OR next_policy->>'expiresAt' !~ '^[0-9]+$' OR
       ((next_policy->>'expiresAt')::numeric<=db_now AND NOT
         (old_policy->>'mode'='COHORT' AND (old_policy->>'expiresAt')::numeric<=db_now AND
          ((next_policy->>'expiresAt')::numeric=0 OR next_policy->'expiresAt'=old_policy->'expiresAt'))) OR
       (next_policy->>'expiresAt')::numeric>db_now+300000 OR
       jsonb_array_length(next_policy->'organizations')=0 OR jsonb_array_length(next_policy->'roles')=0 THEN
      RAISE EXCEPTION 'INVALID_EXPOSURE_POLICY' USING ERRCODE='23514';
    END IF;
  END IF;
  UPDATE gcni_catalog_control_rehearsal.state SET policy=next_policy WHERE singleton=true;
  INSERT INTO gcni_catalog_control_rehearsal.history(revision,policy) VALUES(expected+1,next_policy);
  RETURN next_policy;
END $$;
REVOKE ALL ON SCHEMA gcni_catalog_control_rehearsal FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA gcni_catalog_control_rehearsal FROM PUBLIC;
REVOKE ALL ON FUNCTION gcni_catalog_control_rehearsal.transition(bigint,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA gcni_catalog_control_rehearsal TO gcni_control_reader,gcni_control_operator;
GRANT SELECT ON gcni_catalog_control_rehearsal.state TO gcni_control_reader,gcni_control_operator;
GRANT EXECUTE ON FUNCTION gcni_catalog_control_rehearsal.transition(bigint,jsonb) TO gcni_control_operator;
COMMIT;
