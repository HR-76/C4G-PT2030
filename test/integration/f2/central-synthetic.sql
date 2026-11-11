INSERT INTO public.global_user(id, display_name, primary_email, status)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Researcher', 'researcher@example.invalid', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic Administrator', 'admin@example.invalid', 'ACTIVE');

INSERT INTO public.auth_identity_ref(id, global_user_id, issuer, subject)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://localhost:8443/realms/c4g-test', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'https://localhost:8443/realms/c4g-test', '22222222-2222-4222-8222-222222222222');

INSERT INTO public.platform_admin_assignment(id, global_user_id, role_code, status)
VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'C4G_ADMIN', 'ACTIVE');
