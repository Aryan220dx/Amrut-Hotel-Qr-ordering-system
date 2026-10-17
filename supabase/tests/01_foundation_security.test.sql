begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('public', 'dining_tables', 'dining tables exist');
select has_table('public', 'table_sessions', 'table sessions exist');
select has_table('public', 'table_invites', 'QR invites exist');
select has_table('public', 'table_members', 'table members exist');
select has_table('public', 'menu_items', 'menu items exist');
select has_table('public', 'menu_option_groups', 'menu option groups exist');
select has_table('public', 'menu_options', 'menu options exist');
select has_table('public', 'cart_batches', 'cart batches exist');
select has_table('public', 'cart_lines', 'cart lines exist');
select has_table('public', 'orders', 'orders exist');
select has_table('public', 'order_items', 'immutable order snapshots exist');
select has_table('public', 'order_status_events', 'order status events exist');
select has_table('public', 'staff_members', 'staff membership exists');

select ok((select relrowsecurity from pg_class where oid = 'public.cart_lines'::regclass), 'cart lines have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.table_invites'::regclass), 'invites have RLS');
select ok(not has_table_privilege('anon', 'public.cart_lines', 'INSERT'), 'anon cannot write cart lines');
select ok(not has_table_privilege('authenticated', 'public.cart_lines', 'INSERT'), 'authenticated guests cannot write cart lines');
select ok(not has_table_privilege('authenticated', 'public.orders', 'INSERT'), 'authenticated guests cannot create orders');
select ok(not has_table_privilege('authenticated', 'public.table_invites', 'SELECT'), 'guests cannot read invite tokens');
select ok(has_table_privilege('anon', 'public.menu_items', 'SELECT'), 'anon can request published menu rows (filtered by RLS)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'cart_batches_one_active_per_session'), 'only one active cart batch is indexed per session');
select ok((select count(*) = 5 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status'), 'order lifecycle has explicit status values');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.order_items'::regclass and tgname = 'order_items_append_only' and not tgisinternal), 'order item snapshots have an append-only guard');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cart_lines' and policyname = 'cart_lines_member_read'), 'cart reads require session membership');
select ok(not has_table_privilege('authenticated', 'public.staff_members', 'INSERT'), 'guests cannot assign staff roles');
select ok((select data_type = 'bigint' from information_schema.columns where table_schema = 'public' and table_name = 'menu_items' and column_name = 'base_price_paise'), 'menu prices are stored as integer paise');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'table_invites_one_unrevoked_per_session'), 'sessions have at most one unrevoked invite');

select * from finish();
rollback;
