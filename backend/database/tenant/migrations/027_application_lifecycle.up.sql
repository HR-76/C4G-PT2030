-- Additive pilot recovery. Existing rows, revisions and receipts are untouched.
SET ROLE c4g_opportunity_tenant_owner;
ALTER TABLE opportunity_catalog.application DROP CONSTRAINT application_status_check;
ALTER TABLE opportunity_catalog.application ALTER COLUMN status SET DEFAULT 'IDENTIFIED';
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_status_check
 CHECK(status IN ('IDENTIFIED','INTENTION','PREPARATION','SUBMITTED','APPROVED','REJECTED','CANCELLED','ARCHIVED'));
ALTER TABLE opportunity_catalog.application_change DROP CONSTRAINT application_change_to_status_check;
ALTER TABLE opportunity_catalog.application_change DROP CONSTRAINT application_change_check;
ALTER TABLE opportunity_catalog.application_change ADD CONSTRAINT application_change_to_status_check
 CHECK(to_status IN ('IDENTIFIED','INTENTION','PREPARATION','SUBMITTED','APPROVED','REJECTED','CANCELLED','ARCHIVED'));
ALTER TABLE opportunity_catalog.application_change ADD CONSTRAINT application_change_check
 CHECK((kind='CREATE' AND revision=1 AND from_status IS NULL AND to_status IN ('INTENTION','IDENTIFIED') AND reason IS NULL)
 OR (kind='EDIT' AND revision>1 AND from_status=to_status AND reason IS NULL)
 OR (kind='TRANSITION' AND revision>1 AND from_status IS NOT NULL AND from_status<>to_status AND length(btrim(reason)) BETWEEN 1 AND 500));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application','application_change'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ADD COLUMN notes text CHECK(length(notes)<=10000), ADD COLUMN total_budget numeric CHECK(total_budget>=0 AND total_budget<=99999999999999.99 AND scale(total_budget)<=2), ADD COLUMN organization_budget numeric CHECK(organization_budget>=0 AND organization_budget<=99999999999999.99 AND scale(organization_budget)<=2)',tab);
 END LOOP;
END $$;
GRANT UPDATE(notes,total_budget,organization_budget) ON opportunity_catalog.application TO c4g_opportunity_tenant_runtime;
RESET ROLE;
