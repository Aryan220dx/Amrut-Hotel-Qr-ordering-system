BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(2);

INSERT INTO auth.users (id, aud, role, is_anonymous, created_at, updated_at) VALUES
  ('71000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', true, now(), now());

INSERT INTO public.dining_tables (id, label) VALUES
  ('72000000-0000-0000-0000-000000000001', 'Member Read Test'),
  ('72000000-0000-0000-0000-000000000002', 'Other Member Read Test');

INSERT INTO public.table_sessions (id, dining_table_id, status, closed_at) VALUES
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'open', NULL),
  ('73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000002', 'open', NULL);

INSERT INTO public.table_members (session_id, user_id, guest_number, display_label) VALUES
  ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 1, 'Guest 1');

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::integer FROM public.dining_tables WHERE id = '72000000-0000-0000-0000-000000000001'),
  1,
  'a guest can read the table for their own session'
);
SELECT is(
  (SELECT count(*)::integer FROM public.dining_tables WHERE id = '72000000-0000-0000-0000-000000000002'),
  0,
  'a guest cannot read another session table'
);

SELECT * FROM finish();
ROLLBACK;
