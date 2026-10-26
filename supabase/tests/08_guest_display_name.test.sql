begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000081', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-0000-0000-000000000082', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-0000-0000-000000000083', 'authenticated', 'authenticated', true, now(), now());

insert into public.dining_tables (id, label)
values ('20000000-0000-0000-0000-000000000081', 'Test Guest Display Name');

insert into public.table_sessions (id, dining_table_id, status, closed_at)
values ('30000000-0000-0000-0000-000000000081', '20000000-0000-0000-0000-000000000081', 'open', null);

insert into public.table_invites (session_id, token_hash, expires_at, revoked_at)
values (
  '30000000-0000-0000-0000-000000000081',
  extensions.digest(convert_to(repeat('N', 43), 'UTF8'), 'sha256'),
  now() + interval '1 hour',
  null
);

select ok(to_regprocedure('public.join_table_session(text,text)') is not null, 'named join RPC is installed');
select ok(has_function_privilege('authenticated', 'public.join_table_session(text,text)', 'EXECUTE'), 'authenticated role can invoke named join RPC');
select ok(not has_function_privilege('anon', 'public.join_table_session(text,text)', 'EXECUTE'), 'anon role cannot invoke named join RPC');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000081', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000081","role":"authenticated","is_anonymous":true}', true);
select is(
  (select display_label from public.join_table_session(repeat('N', 43), E'  Asha\t M.\n')),
  'Asha M.',
  'custom name trims and collapses whitespace'
);
select is(
  (select display_label from public.join_table_session(repeat('N', 43), E' \t\n ')),
  'Asha M.',
  'whitespace-only retry leaves an existing member label unchanged'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000082', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000082","role":"authenticated","is_anonymous":true}', true);
select is(
  (select display_label from public.join_table_session(repeat('N', 43), E' \t\n ')),
  'Guest 2',
  'whitespace-only name uses the default guest label'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000081', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000081","role":"authenticated","is_anonymous":true}', true);
select is(
  (select display_label from public.join_table_session(repeat('N', 43), 'Asha R')),
  'Asha R',
  'an existing member can update their display label'
);
select is(
  (select guest_number from public.join_table_session(repeat('N', 43), 'Asha R')),
  1,
  'renaming an existing member preserves their guest number'
);
select is(
  (select length(display_label) from public.join_table_session(repeat('N', 43), repeat('x', 40))),
  32,
  'custom display name is limited to 32 characters'
);

reset role;
select * from finish();
rollback;
