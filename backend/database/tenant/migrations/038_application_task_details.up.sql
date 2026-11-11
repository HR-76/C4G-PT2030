SET LOCAL ROLE c4g_opportunity_tenant_owner;

ALTER TABLE opportunity_catalog.application_task
  ADD COLUMN description text CONSTRAINT application_task_description_length CHECK (char_length(description) <= 2000),
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE opportunity_catalog.application_work_change
  ADD COLUMN description text CONSTRAINT application_work_change_description_length CHECK (char_length(description) <= 2000),
  DROP CONSTRAINT application_work_change_kind_check,
  ADD CONSTRAINT application_work_change_kind_check CHECK (kind IN (
    'PARTICIPANT_ADDED', 'PARTICIPANT_REMOVED', 'TASK_CREATED', 'TASK_EDITED',
    'TASK_COMPLETED', 'TASK_CANCELLED', 'TASK_DELETED'
  ));

GRANT UPDATE (description, deleted_at) ON opportunity_catalog.application_task TO c4g_opportunity_tenant_runtime;

RESET ROLE;
