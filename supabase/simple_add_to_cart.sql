CREATE OR REPLACE FUNCTION public.add_to_cart(
  p_session_id uuid,
  p_menu_item_id uuid,
  p_quantity integer default 1,
  p_option_selections jsonb default '{}'::jsonb
)
RETURNS TABLE (
  cart_line_id uuid,
  quantity integer,
  unit_price_paise bigint,
  price_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_session_status_val public.session_status;
  v_table_active boolean;
  v_member_id uuid;
  v_cart_batch_id uuid;
  v_menu_base_price bigint;
  v_menu_price_version integer;
  v_unit_price bigint;
BEGIN
  -- Check authentication: must be anonymous user
  v_user_id := (select auth.uid());
  IF v_user_id IS NULL
     OR coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE exception 'anonymous authentication required' USING errcode = '42501';
  END IF;

  -- Verify caller is a member of the session
  SELECT tm.id INTO v_member_id
  FROM public.table_members tm
  WHERE tm.session_id = p_session_id AND tm.user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE exception 'caller is not a member of the specified session' USING errcode = '42501';
  END IF;

  -- Verify session is active and table is available
  SELECT ts.status, t.is_active INTO v_session_status_val, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = p_session_id
  FOR UPDATE OF ts, t;

  IF NOT FOUND OR v_session_status_val <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE exception 'session is not active or table is unavailable' USING errcode = '22023';
  END IF;

  -- Get or create active cart batch for this session
  SELECT id INTO v_cart_batch_id
  FROM public.cart_batches
  WHERE session_id = p_session_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.cart_batches (session_id, status)
    VALUES (p_session_id, 'active')
    RETURNING id INTO v_cart_batch_id;
  END IF;

  -- Get menu item details (using table alias mi to avoid ambiguity)
  SELECT mi.base_price_paise, mi.price_version INTO v_menu_base_price, v_menu_price_version
  FROM public.menu_items mi
  WHERE mi.id = p_menu_item_id AND mi.is_published AND mi.is_available;
  IF NOT FOUND THEN
    RAISE exception 'menu item is not available' USING errcode = '22023';
  END IF;

  -- Validate quantity
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 THEN
    RAISE exception 'quantity must be between 1 and 99' USING errcode = '22023';
  END IF;

  -- Validate option_selections
  IF p_option_selections IS NULL OR jsonb_typeof(p_option_selections) <> 'object' THEN
    RAISE exception 'option_selections must be a JSON object' USING errcode = '22023';
  END IF;

  -- Set unit price (no options implemented yet, so base price)
  v_unit_price := v_menu_base_price;

  -- Insert the cart line
  INSERT INTO public.cart_lines (
    cart_batch_id, session_id, member_id, menu_item_id,
    quantity, option_selections, unit_price_paise, price_version
  )
  VALUES (
    v_cart_batch_id, p_session_id, v_member_id, p_menu_item_id,
    p_quantity, p_option_selections, v_unit_price, v_menu_price_version
  );

  -- Return the results using explicit table alias (cl.) to avoid ambiguity
  SELECT cl.id, cl.quantity, cl.unit_price_paise, cl.price_version
  INTO cart_line_id, quantity, unit_price_paise, price_version
  FROM public.cart_lines cl
  WHERE cl.cart_batch_id = v_cart_batch_id
    AND cl.member_id = v_member_id
    AND cl.menu_item_id = p_menu_item_id
    AND cl.created_at >= NOW() - INTERVAL '1 second'
  LIMIT 1;

  RETURN NEXT;
END;
$$;