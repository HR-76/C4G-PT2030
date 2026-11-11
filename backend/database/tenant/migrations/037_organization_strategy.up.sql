SET LOCAL ROLE c4g_organizational_scope_owner;

ALTER TABLE organizational_scope.organization_card
  ADD COLUMN strategy jsonb NOT NULL DEFAULT '{"areaIds":[],"interests":[],"objectives":[]}'::jsonb,
  ADD CONSTRAINT organization_card_strategy_object CHECK (jsonb_typeof(strategy) = 'object');

ALTER TABLE organizational_scope.person_profile
  ADD COLUMN interest_area_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT person_profile_interest_area_limit CHECK (cardinality(interest_area_ids) <= 30);

RESET ROLE;
