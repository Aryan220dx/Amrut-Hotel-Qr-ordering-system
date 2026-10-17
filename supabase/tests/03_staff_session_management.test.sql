begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select has_function('public', 'open_table_session', array['uuid'], 'staff session open RPC exists');
select has_function('public', 'issue_table_invite', array['uuid', 'integer'], 'invite issuance and rotation RPC exists');
select has_function('public', 'revoke_table_invite', array['uuid'], 'invite revocation RPC exists');
select ok(not has_function_privilege('anon', 'public.open_table_session(uuid)', 'EXECUTE'), 'anon cannot open sessions');
select ok(not has_function_privilege('anon', 'public.issue_table_invite(uuid,integer)', 'EXECUTE'), 'anon cannot issue invites');
select ok(not has_function_privilege('anon', 'public.revoke_table_invite(uuid)', 'EXECUTE'), 'anon cannot revoke invites');
select ok(has_function_privilege('authenticated', 'public.open_table_session(uuid)', 'EXECUTE'), 'authenticated role can reach the guarded open RPC');
select ok(has_function_privilege('authenticated', 'public.issue_table_invite(uuid,integer)', 'EXECUTE'), 'authenticated role can reach the guarded issue RPC');
select ok(has_function_privilege('authenticated', 'public.revoke_table_invite(uuid)', 'EXECUTE'), 'authenticated role can reach the guarded revoke RPC');
select ok(not has_function_privilege('authenticated', 'private.assert_staff_management_access()', 'EXECUTE'), 'internal staff assertion is not directly callable');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff_members' and policyname = 'staff_members_staff_read'), 'staff cannot list other staff assignments');
select ok((select prosecdef from pg_proc where oid = 'public.open_table_session(uuid)'::regprocedure), 'open RPC uses definer only for guarded table writes');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'table_sessions_one_open_per_table'), 'unique open-session index remains the final concurrency guard');

select * from finish();
rollback;
