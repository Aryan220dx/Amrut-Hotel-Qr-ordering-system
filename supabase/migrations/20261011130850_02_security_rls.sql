-- Fail closed: authenticated guests can read only menu and data for their memberships.
-- Mutations are intentionally withheld until server-validated commands are implemented.
create or replace function private.is_session_member(p_session_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.table_members m
    where m.session_id = p_session_id and m.user_id = (select auth.uid())
  );
$$;
create or replace function private.is_active_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = (select auth.uid()) and s.is_active
  );
$$;
revoke all on function private.is_session_member(uuid) from public, anon;
revoke all on function private.is_active_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_session_member(uuid), private.is_active_staff() to authenticated;

alter table public.dining_tables enable row level security;
alter table public.table_sessions enable row level security;
alter table public.table_invites enable row level security;
alter table public.table_members enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_option_groups enable row level security;
alter table public.menu_options enable row level security;
alter table public.cart_batches enable row level security;
alter table public.cart_lines enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_events enable row level security;
alter table public.staff_members enable row level security;

-- Strip Supabase's commonly preconfigured broad API grants; add only deliberate reads.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres revoke all on tables from anon, authenticated;
alter default privileges for role postgres revoke all on sequences from anon, authenticated;
grant select on public.menu_items, public.menu_option_groups, public.menu_options to anon, authenticated;
grant select on public.dining_tables, public.table_sessions, public.table_members,
  public.cart_batches, public.cart_lines, public.orders, public.order_items,
  public.order_status_events, public.staff_members to authenticated;
-- No table_invites grants. No guest INSERT/UPDATE/DELETE grants or policies.

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant usage on schema private to service_role;

create policy menu_items_available_read on public.menu_items for select to anon, authenticated
  using (is_published and is_available);
create policy menu_option_groups_available_read on public.menu_option_groups for select to anon, authenticated
  using (exists (select 1 from public.menu_items i where i.id = menu_item_id and i.is_published and i.is_available));
create policy menu_options_available_read on public.menu_options for select to anon, authenticated
  using (is_available and exists (
    select 1 from public.menu_option_groups g join public.menu_items i on i.id = g.menu_item_id
    where g.id = group_id and i.is_published and i.is_available
  ));

create policy dining_tables_member_read on public.dining_tables for select to authenticated
  using (exists (select 1 from public.table_sessions s where s.dining_table_id = id and private.is_session_member(s.id)));
create policy dining_tables_staff_read on public.dining_tables for select to authenticated
  using (private.is_active_staff());
create policy table_sessions_member_read on public.table_sessions for select to authenticated
  using (private.is_session_member(id));
create policy table_sessions_staff_read on public.table_sessions for select to authenticated
  using (private.is_active_staff());
create policy table_members_same_session_read on public.table_members for select to authenticated
  using (private.is_session_member(session_id));
create policy table_members_staff_read on public.table_members for select to authenticated
  using (private.is_active_staff());
create policy cart_batches_member_read on public.cart_batches for select to authenticated
  using (private.is_session_member(session_id));
create policy cart_batches_staff_read on public.cart_batches for select to authenticated
  using (private.is_active_staff());
create policy cart_lines_member_read on public.cart_lines for select to authenticated
  using (private.is_session_member(session_id));
create policy cart_lines_staff_read on public.cart_lines for select to authenticated
  using (private.is_active_staff());
create policy orders_member_read on public.orders for select to authenticated
  using (private.is_session_member(session_id));
create policy orders_staff_read on public.orders for select to authenticated
  using (private.is_active_staff());
create policy order_items_member_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and private.is_session_member(o.session_id)));
create policy order_items_staff_read on public.order_items for select to authenticated
  using (private.is_active_staff());
create policy order_status_events_member_read on public.order_status_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and private.is_session_member(o.session_id)));
create policy order_status_events_staff_read on public.order_status_events for select to authenticated
  using (private.is_active_staff());
create policy staff_members_self_read on public.staff_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_members_staff_read on public.staff_members for select to authenticated
  using (private.is_active_staff());
-- table_invites intentionally has RLS enabled, no API grant and no policy.
