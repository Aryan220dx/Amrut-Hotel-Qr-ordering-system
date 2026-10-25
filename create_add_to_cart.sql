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
  v_user_id uuid;
  v_session_status_val public.session_status;
  v_table_active boolean;
  v_member_id uuid;
  v_cart_batch_id uuid;
  v_menu_base_price bigint;
  v_menu_price_version integer;
  v_unit_price bigint;
begin
  -- Check authentication: must be anonymous user
  v_user_id := (select auth.uid());
  if v_user_id is null
     or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' then
    raise exception 'anonymous authentication required' using errcode = '42501';
  end if;

  -- Verify caller is a member of the session
  select tm.id into v_member_id
  from public.table_members tm
  where tm.session_id = p_session_id and tm.user_id = v_user_id;
  if not found then
    raise exception 'caller is not a member of the specified session' using errcode = '42501';
  end if;

  -- Verify session is active and table is available
  select ts.status, t.is_active into v_session_status_val, v_table_active
  from public.table_sessions ts
  join public.dining_tables t on t.id = ts.dining_table_id
  where ts.id = p_session_id
  for update of ts, t;

  if not found or v_session_status_val <> 'open'::public.session_status or not v_table_active then
    raise exception 'session is not active or table is unavailable' using errcode = '22023';
  end if;

  -- Get or create active cart batch for this session
  select id into v_cart_batch_id
  from public.cart_batches
  where session_id = p_session_id and status = 'active'
  for update;

  if not found then
    insert into public.cart_batches (session_id, status)
    values (p_session_id, 'active')
    returning id into v_cart_batch_id;
  end if;

  -- Get menu item details (using table alias mi to avoid ambiguity)
  select mi.base_price_paise, mi.price_version into v_menu_base_price, v_menu_price_version
  from public.menu_items mi
  where mi.id = p_menu_item_id and mi.is_published and mi.is_available;
  if not found then
    raise exception 'menu item is not available' using errcode = '22023';
  end if;

  -- Validate quantity
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'quantity must be between 1 and 99' using errcode = '22023';
  end if;

  -- Validate option_selections
  if p_option_selections is null or jsonb_typeof(p_option_selections) <> 'object' then
    raise exception 'option_selections must be a JSON object' using errcode = '22023';
  end if;

  -- Set unit price (no options implemented yet, so base price)
  v_unit_price := v_menu_base_price;

  -- Insert the cart line
  insert into public.cart_lines (
    cart_batch_id, session_id, member_id, menu_item_id,
    quantity, option_selections, unit_price_paise, price_version
  )
  values (
    v_cart_batch_id, p_session_id, v_member_id, p_menu_item_id,
    p_quantity, p_option_selections, v_unit_price, v_menu_price_version
  );

  -- Return the results using explicit table alias (cl.) to avoid ambiguity
  select cl.id, cl.quantity, cl.unit_price_paise, cl.price_version
  into cart_line_id, quantity, unit_price_paise, price_version
  from public.cart_lines cl
  where cl.cart_batch_id = v_cart_batch_id
    and cl.member_id = v_member_id
    and cl.menu_item_id = p_menu_item_id
    and cl.created_at >= now() - interval '1 second'
  limit 1;

  return next;
end;
$$;

grant execute on function public.add_to_cart(uuid, uuid, integer, jsonb) to authenticated;
