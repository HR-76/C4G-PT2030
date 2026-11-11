DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.application_work LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_participant LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_task LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_work_change LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_work_receipt LIMIT 1)
 THEN RAISE EXCEPTION 'Application work history is occupied; downgrade refused'; END IF;
END $$;
DROP TABLE opportunity_catalog.application_work_receipt;
DROP TABLE opportunity_catalog.application_work_change;
DROP TABLE opportunity_catalog.application_task;
DROP TABLE opportunity_catalog.application_participant;
DROP TABLE opportunity_catalog.application_work;
