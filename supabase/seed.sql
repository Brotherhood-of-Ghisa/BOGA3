-- Deterministic local fixtures for backend development.
-- `db reset` recreates the database, but we still make inserts explicit and stable.

truncate table public.dev_fixture_principals;
truncate table public.local_runtime_bootstrap_markers;

insert into public.dev_fixture_principals (
  fixture_key,
  subject_uuid,
  subject_kind,
  email,
  description
)
values
  (
    'anonymous',
    '00000000-0000-0000-0000-000000000000',
    'anonymous',
    null,
    'Placeholder principal used for unauthenticated/guest-path tests.'
  ),
  (
    'user_a',
    '11111111-1111-1111-1111-111111111111',
    'user',
    'user_a.local@example.test',
    'Primary deterministic owner fixture for auth/RLS/API contract tests.'
  ),
  (
    'user_b',
    '22222222-2222-2222-2222-222222222222',
    'user',
    'user_b.local@example.test',
    'Secondary deterministic owner fixture for cross-user denial tests.'
  ),
  (
    'service_role_helper',
    '99999999-9999-9999-9999-999999999999',
    'service_role',
    null,
    'Optional helper fixture for service-role-only setup paths.'
  );

insert into public.local_runtime_bootstrap_markers (marker, details)
values (
  'm5_local_runtime_seed_v1',
  'Baseline schema + deterministic fixtures'
);
