-- Fix add_to_cart RPC to resolve column reference ambiguity
-- Alias the price_version column in the SELECT to avoid conflict with output column name

drop function if exists public.add_to_cart(uuid, uuid, integer, jsonb);

create or replace function public.add_to_cart(
  p_session_id uuid,
  p_menu_item_id uuid,
  p_quantity integer default 1,
  p_option_selections jsonb default '{}'::jsonb
)
returns table (cart_line_id uuid, quantity integer, unit_price_paise bigint, price_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session_status_val public.session_status;
  v_table_active boolean;
  v_member_id uuid;
  v_batch_id uuid;
  v_base_price_val bigint;
  v_item_ver integer;
  v_unit_price_val bigint;
  v_out_id uuid;
  v_out_qty integer;
  v_out_price_val bigint;
  v_out_ver integer;
begin
  if v_user_id is null
     or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' then
    raise exception 'anonymous authentication required' using errcode = '42501';
  end if;

  select tm.id into v_member_id
  from public.table_members tm
  where tm.session_id = p_session_id and tm.user_id = v_user_id;
  if not found then
    raise exception 'caller is not a member of the specified session' using errcode = '42501';
  end if;

  select ts.status, t.is_active into v_session_status_val, v_table_active
  from public.table_sessions ts
  join public.dining_tables t on t.id = ts.dining_table_id
  where ts.id = p_session_id
  for update of ts, t;

  if not found or v_session_status_val <> 'open'::public.session_status or not v_table_active then
    raise exception 'session is not active or table is unavailable' using errcode = '22023';
  end if;

  select id into v_batch_id
  from public.cart_batches
  where session_id = p_session_id and status = 'active'
  for update;

  if not found then
    insert into public.cart_batches (session_id, status)
    values (p_session_id, 'active')
    returning id into v_batch_id;
  end if;

  select base_price_paise, price_version into v_base_price_val, v_item_ver
  from public.menu_items
  where id = p_menu_item_id and is_published and is_available;
  if not found then
    raise exception 'menu item is not available' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'quantity must be between 1 and 99' using errcode = '22023';
  end if;

  if p_option_selections is null or jsonb_typeof(p_option_selections) <> 'object' then
    raise exception 'option_selections must be a JSON object' using errcode = '22023';
  end if;

  v_unit_price_val := v_base_price_val;

  insert into public.cart_lines (
    cart_batch_id, session_id, member_id, menu_item_id,
    quantity, option_selections, unit_price_paise, price_version
  )
  values (
    v_batch_id, p_session_id, v_member_id, p_menu_item_id,
    p_quantity, p_option_selections, v_unit_price_val, v_item_ver
  );

  select cl.id, cl.quantity, cl.unit_price_paise, cl.price_version as price_version_col
  into v_out_id, v_out_qty, v_out_price_val, v_out_ver
  from public.cart_lines cl
  where cl.cart_batch_id = v_batch_id
    and cl.member_id = v_member_id
    and cl.menu_item_id = p_menu_item_id
    and cl.created_at >= now() - interval '1 second'
  limit 1;

  cart_line_id := v_out_id;
  quantity := v_out_qty;
  unit_price_paise := v_out_price_val;
  price_version := v_out_ver;
  return next;
end;
$$;

grant execute on function public.add_to_cart(uuid, uuid, integer, jsonb) to authenticated;
