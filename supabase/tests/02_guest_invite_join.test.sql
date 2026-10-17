begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', false, now(), now());
insert into public.dining_tables (id, label) values
  ('20000000-0000-0000-0000-000000000001', 'Test Join Valid'),
  ('20000000-0000-0000-0000-000000000002', 'Test Join Expired'),
  ('20000000-0000-0000-0000-000000000003', 'Test Join Revoked'),
  ('20000000-0000-0000-0000-000000000004', 'Test Join Closed');
insert into public.table_sessions (id, dining_table_id, status, closed_at) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'open', null),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'open', null),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'open', null),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'closed', now());
insert into public.table_invites (session_id, token_hash, expires_at, revoked_at) values
  ('30000000-0000-0000-0000-000000000001', extensions.digest(convert_to(repeat('A', 43), 'UTF8'), 'sha256'), now() + interval '1 hour', null),
  ('30000000-0000-0000-0000-000000000002', extensions.digest(convert_to(repeat('B', 43), 'UTF8'), 'sha256'), now() - interval '1 minute', null),
  ('30000000-0000-0000-0000-000000000003', extensions.digest(convert_to(repeat('C', 43), 'UTF8'), 'sha256'), now() + interval '1 hour', now()),
  ('30000000-0000-0000-0000-000000000004', extensions.digest(convert_to(repeat('D', 43), 'UTF8'), 'sha256'), now() + interval '1 hour', null);

select ok(to_regprocedure('public.join_table_session(text)') is not null, 'join RPC is installed');
select ok(not has_function_privilege('anon', 'public.join_table_session(text)', 'EXECUTE'), 'anon role cannot invoke join RPC');
select ok(has_function_privilege('authenticated', 'public.join_table_session(text)', 'EXECUTE'), 'authenticated role can invoke join RPC');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
select is((select session_id from public.join_table_session(repeat('A', 43))), '30000000-0000-0000-0000-000000000001'::uuid, 'valid invite joins its session');
select is((select guest_number from public.join_table_session(repeat('A', 43))), 1, 'repeat join returns the existing guest number');
select is((select display_label from public.join_table_session(repeat('A', 43))), 'Guest 1', 'membership receives a table-local label');
select is((select count(*)::integer from public.table_members where session_id = '30000000-0000-0000-0000-000000000001'), 1, 'repeat join does not create duplicate membership');
select throws_ok($$select * from public.join_table_session('bad-token')$$, '22023', 'invalid or expired table invite', 'malformed invite is rejected without revealing details');
select throws_ok($$select * from public.join_table_session(repeat('Z', 43))$$, '22023', 'invalid or expired table invite', 'unknown invite is rejected');
select throws_ok($$select * from public.join_table_session(repeat('B', 43))$$, '22023', 'invalid or expired table invite', 'expired invite is rejected');
select throws_ok($$select * from public.join_table_session(repeat('C', 43))$$, '22023', 'invalid or expired table invite', 'revoked invite is rejected');
select throws_ok($$select * from public.join_table_session(repeat('D', 43))$$, '22023', 'invalid or expired table invite', 'closed session is rejected');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select throws_ok($$select * from public.join_table_session(repeat('A', 43))$$, '42501', 'anonymous authentication required', 'permanent users cannot use the guest join flow');
reset role;

select * from finish();
rollback;
