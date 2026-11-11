-- Performance indexes for high-frequency dashboard, sync and access-control queries.
CREATE INDEX IF NOT EXISTS idx_opportunities_raw_external_id
  ON opportunities ((raw_payload->>'externalId'));

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_application_members_user_id
  ON application_members (user_id);

CREATE INDEX IF NOT EXISTS idx_applications_coordinator_id
  ON applications (coordinator_id);

CREATE INDEX IF NOT EXISTS idx_application_partner_people_partner_role
  ON application_partner_people (partner_id, role);
