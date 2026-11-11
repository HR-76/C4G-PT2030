\set ON_ERROR_STOP on
SET statement_timeout = '30s';
SET lock_timeout = '2s';
SELECT version();
-- Synthetic projection only: no application tables, credentials or data.
CREATE TEMP TABLE fingerprint_sample (
  application_id integer PRIMARY KEY, title text, revision integer,
  responsible_name text, notes text, total_budget numeric(16,2)
);
-- Use the exact fingerprint expression from applications/browseSql.js.
-- The NULL control is a cost estimate, NOT a proposed runtime replacement.
CREATE FUNCTION pg_temp.measure_fingerprint(sample_size integer) RETURNS SETOF json
LANGUAGE plpgsql AS $$
DECLARE variant text; statement text; plan json; iteration integer;
BEGIN
  TRUNCATE fingerprint_sample;
  INSERT INTO fingerprint_sample
    SELECT n, 'Synthetic application ' || n, 1, 'Synthetic owner', repeat('x',512), n * 1.25
    FROM generate_series(1,sample_size) n;
  ANALYZE fingerprint_sample;
  FOR iteration IN 1..8 LOOP
    variant := CASE WHEN iteration IN (1,4,5,8) THEN 'fingerprint' ELSE 'control' END;
    statement := 'WITH filtered AS MATERIALIZED (SELECT * FROM fingerprint_sample),
      page AS (SELECT * FROM filtered ORDER BY lower(title),application_id LIMIT 25)
      SELECT (SELECT count(*) FROM filtered) AS total, ' ||
      CASE WHEN variant='fingerprint' THEN
        '(SELECT encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(to_jsonb(f)::text,''UTF8'')),''hex''),'''' ORDER BY application_id),''''),''UTF8'')),''hex'') FROM filtered f)'
      ELSE 'NULL::text' END ||
      ' AS fingerprint, (SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(title),application_id) FROM page) AS items';
    EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || statement INTO plan;
    RETURN NEXT json_build_object('rows',sample_size,'iteration',iteration,'variant',variant,'plan',plan);
  END LOOP;
END $$;
SELECT pg_temp.measure_fingerprint(1000);
SELECT pg_temp.measure_fingerprint(10000);
SELECT pg_temp.measure_fingerprint(50000);
