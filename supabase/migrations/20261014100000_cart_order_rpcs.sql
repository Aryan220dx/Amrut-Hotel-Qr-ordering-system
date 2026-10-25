-- Secure guest cart operations and retry-safe order submission.
-- This migration is still pending locally and has not been applied to a hosted project.

ALTER TABLE public.orders
  ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'one',
  ADD COLUMN guest_note TEXT;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_mode_check CHECK (payment_mode IN ('one', 'equal', 'items')),
  ADD CONSTRAINT orders_guest_note_length_check CHECK (guest_note IS NULL OR length(guest_note) <= 500);

CREATE TABLE public.order_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  session_id UUID NOT NULL,
  member_id UUID NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  allocation_method TEXT NOT NULL CHECK (allocation_method IN ('one', 'equal', 'items')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, member_id),
  FOREIGN KEY (order_id, session_id) REFERENCES public.orders(id, session_id) ON DELETE RESTRICT,
  FOREIGN KEY (member_id, session_id) REFERENCES public.table_members(id, session_id) ON DELETE RESTRICT
);
CREATE INDEX order_allocations_session ON public.order_allocations(session_id, order_id);
CREATE INDEX order_allocations_order_session ON public.order_allocations(order_id, session_id);
CREATE INDEX order_allocations_member_session ON public.order_allocations(member_id, session_id);
ALTER TABLE public.order_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_allocations TO authenticated;
CREATE POLICY order_allocations_member_read ON public.order_allocations FOR SELECT TO authenticated
  USING (private.is_session_member(session_id));
CREATE POLICY order_allocations_staff_read ON public.order_allocations FOR SELECT TO authenticated
  USING (private.is_active_staff());
CREATE TRIGGER order_allocations_append_only
  BEFORE UPDATE OR DELETE ON public.order_allocations
  FOR EACH ROW EXECUTE FUNCTION private.reject_row_mutation();

-- Cover the child columns used by composite and single-column foreign keys.
CREATE INDEX cart_lines_batch_session ON public.cart_lines(cart_batch_id, session_id);
CREATE INDEX cart_lines_member_session ON public.cart_lines(member_id, session_id);
CREATE INDEX cart_lines_menu_item ON public.cart_lines(menu_item_id);
CREATE INDEX orders_batch_session ON public.orders(cart_batch_id, session_id);
CREATE INDEX orders_placed_member_session ON public.orders(placed_by_member_id, session_id);
CREATE INDEX order_items_order_session ON public.order_items(order_id, session_id);
CREATE INDEX order_items_source_cart_line ON public.order_items(source_cart_line_id);
CREATE INDEX order_items_contributor_session ON public.order_items(contributor_member_id, session_id);
CREATE INDEX order_status_events_actor ON public.order_status_events(actor_staff_user_id);

-- Validate each requested group and option, then return its server-owned price delta.
CREATE OR REPLACE FUNCTION private.validate_cart_options(
  p_menu_item_id UUID,
  p_selections JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group RECORD;
  v_selected JSONB;
  v_values JSONB;
  v_count INTEGER;
  v_distinct_count INTEGER;
  v_valid_count INTEGER;
  v_group_delta BIGINT;
  v_total_delta BIGINT := 0;
BEGIN
  IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'object' THEN
    RAISE EXCEPTION 'option selections must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_selections) AS requested(option_key)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.menu_option_groups g
      WHERE g.menu_item_id = p_menu_item_id AND g.option_key = requested.option_key
    )
  ) THEN
    RAISE EXCEPTION 'unknown option group' USING ERRCODE = '22023';
  END IF;

  FOR v_group IN
    SELECT g.id, g.option_key, g.min_selections, g.max_selections
    FROM public.menu_option_groups g
    WHERE g.menu_item_id = p_menu_item_id
    ORDER BY g.sort_order, g.id
  LOOP
    v_selected := p_selections -> v_group.option_key;
    IF v_selected IS NULL THEN
      v_values := '[]'::JSONB;
    ELSIF jsonb_typeof(v_selected) = 'string' THEN
      v_values := jsonb_build_array(v_selected);
    ELSIF jsonb_typeof(v_selected) = 'array' THEN
      v_values := v_selected;
    ELSE
      RAISE EXCEPTION 'option selections must be strings or arrays of strings' USING ERRCODE = '22023';
    END IF;

    v_count := jsonb_array_length(v_values);
    IF v_count < v_group.min_selections OR v_count > v_group.max_selections THEN
      RAISE EXCEPTION 'invalid number of selections for option group %', v_group.option_key USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT choice.option_key)::INTEGER
    INTO v_distinct_count
    FROM jsonb_array_elements_text(v_values) AS choice(option_key);
    IF v_distinct_count <> v_count THEN
      RAISE EXCEPTION 'duplicate option selection' USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::INTEGER, coalesce(sum(o.price_delta_paise), 0)::BIGINT
    INTO v_valid_count, v_group_delta
    FROM jsonb_array_elements_text(v_values) AS choice(option_key)
    JOIN public.menu_options o
      ON o.group_id = v_group.id
     AND o.option_key = choice.option_key
     AND o.is_available;
    IF v_valid_count <> v_count THEN
      RAISE EXCEPTION 'option is unavailable or does not belong to its group' USING ERRCODE = '22023';
    END IF;

    v_total_delta := v_total_delta + v_group_delta;
  END LOOP;

  RETURN v_total_delta;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_cart_options(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- Store immutable option snapshots as an array, matching order_items.options_snapshot.
CREATE OR REPLACE FUNCTION private.cart_options_snapshot(
  p_menu_item_id UUID,
  p_selections JSONB
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_key', g.option_key,
        'group_label', g.label,
        'option_key', o.option_key,
        'label', o.label,
        'price_delta_paise', o.price_delta_paise
      ) ORDER BY g.sort_order, o.sort_order, o.id
    ),
    '[]'::JSONB
  )
  FROM public.menu_option_groups g
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE jsonb_typeof(p_selections -> g.option_key)
      WHEN 'string' THEN jsonb_build_array(p_selections -> g.option_key)
      WHEN 'array' THEN p_selections -> g.option_key
      ELSE '[]'::JSONB
    END
  ) AS selected(option_key)
  JOIN public.menu_options o
    ON o.group_id = g.id AND o.option_key = selected.option_key
  WHERE g.menu_item_id = p_menu_item_id;
$$;
REVOKE ALL ON FUNCTION private.cart_options_snapshot(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- Drop prior pending implementations, then define the final RPC contracts.
DROP FUNCTION IF EXISTS public.add_to_cart(UUID, UUID, INTEGER, JSONB);
DROP FUNCTION IF EXISTS public.get_cart_lines(UUID);
DROP FUNCTION IF EXISTS public.update_cart_line(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.remove_cart_line(UUID);
DROP FUNCTION IF EXISTS public.clear_cart(UUID);
DROP FUNCTION IF EXISTS public.submit_order(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.get_order_status(UUID);
DROP FUNCTION IF EXISTS public.update_order_status(UUID, public.order_status);

CREATE OR REPLACE FUNCTION public.add_to_cart(
  p_session_id UUID,
  p_menu_item_id UUID,
  p_quantity INTEGER DEFAULT 1,
  p_option_selections JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (cart_line_id UUID, quantity INTEGER, unit_price_paise BIGINT, price_version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_member_id UUID;
  v_session_status public.session_status;
  v_table_active BOOLEAN;
  v_batch_id UUID;
  v_base_price BIGINT;
  v_price_version INTEGER;
  v_unit_price BIGINT;
  v_line_id UUID;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT tm.id INTO v_member_id
  FROM public.table_members tm
  WHERE tm.session_id = p_session_id AND tm.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'caller is not a member of the specified session' USING ERRCODE = '42501'; END IF;
  SELECT ts.status, t.is_active INTO v_session_status, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = p_session_id
  FOR UPDATE OF ts, t;
  IF NOT FOUND OR v_session_status <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE EXCEPTION 'session is not active or table is unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 99' USING ERRCODE = '22023';
  END IF;

  SELECT mi.base_price_paise, mi.price_version INTO v_base_price, v_price_version
  FROM public.menu_items mi
  WHERE mi.id = p_menu_item_id AND mi.is_published AND mi.is_available
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu item is not available' USING ERRCODE = '22023'; END IF;
  v_unit_price := v_base_price + private.validate_cart_options(p_menu_item_id, p_option_selections);
  IF v_unit_price < 0 THEN RAISE EXCEPTION 'calculated price cannot be negative' USING ERRCODE = '22023'; END IF;

  SELECT cb.id INTO v_batch_id FROM public.cart_batches cb
  WHERE cb.session_id = p_session_id AND cb.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.cart_batches(session_id, status) VALUES (p_session_id, 'active')
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.cart_lines(
    cart_batch_id, session_id, member_id, menu_item_id, quantity,
    option_selections, unit_price_paise, price_version
  ) VALUES (
    v_batch_id, p_session_id, v_member_id, p_menu_item_id, p_quantity,
    p_option_selections, v_unit_price, v_price_version
  ) RETURNING id INTO v_line_id;
  RETURN QUERY SELECT cl.id, cl.quantity, cl.unit_price_paise, cl.price_version
  FROM public.cart_lines cl WHERE cl.id = v_line_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cart_lines(p_session_id UUID)
RETURNS TABLE (
  cart_line_id UUID,
  menu_item_id UUID,
  menu_item_name TEXT,
  menu_item_category TEXT,
  quantity INTEGER,
  unit_price_paise BIGINT,
  price_version INTEGER,
  option_selections JSONB,
  line_total_paise BIGINT,
  member_id UUID,
  member_label TEXT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_member_id UUID;
  v_session_status public.session_status;
  v_table_active BOOLEAN;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT tm.id INTO v_member_id
  FROM public.table_members tm
  WHERE tm.session_id = p_session_id AND tm.user_id = v_user_id;
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of the specified session' USING ERRCODE = '42501';
  END IF;
  SELECT ts.status, t.is_active INTO v_session_status, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = p_session_id;
  IF NOT FOUND OR v_session_status <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE EXCEPTION 'session is not active or table is unavailable' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT cl.id, cl.menu_item_id, mi.name, mi.category, cl.quantity,
         cl.unit_price_paise, cl.price_version, cl.option_selections,
         (cl.quantity * cl.unit_price_paise)::BIGINT,
         tm.id, tm.display_label, (tm.user_id = v_user_id)
  FROM public.cart_batches cb
  JOIN public.cart_lines cl ON cl.cart_batch_id = cb.id
  JOIN public.menu_items mi ON mi.id = cl.menu_item_id
  JOIN public.table_members tm ON tm.id = cl.member_id
  WHERE cb.session_id = p_session_id AND cb.status = 'active'
  ORDER BY cl.created_at, cl.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cart_line(p_cart_line_id UUID, p_quantity INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_session_id UUID;
  v_member_id UUID;
  v_line_member_id UUID;
  v_batch_status public.cart_batch_status;
  v_session_status public.session_status;
  v_table_active BOOLEAN;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT cl.session_id INTO v_session_id FROM public.cart_lines cl WHERE cl.id = p_cart_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cart line not found' USING ERRCODE = '42501'; END IF;

  SELECT ts.status, t.is_active INTO v_session_status, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = v_session_id
  FOR UPDATE OF ts, t;
  IF NOT FOUND OR v_session_status <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE EXCEPTION 'session is not active or table is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT tm.id INTO v_member_id
  FROM public.table_members tm
  WHERE tm.session_id = v_session_id AND tm.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'caller is not a member of the session' USING ERRCODE = '42501'; END IF;
  SELECT cl.member_id, cb.status INTO v_line_member_id, v_batch_status
  FROM public.cart_lines cl
  JOIN public.cart_batches cb ON cb.id = cl.cart_batch_id
  WHERE cl.id = p_cart_line_id
  FOR UPDATE OF cb, cl;
  IF NOT FOUND OR v_batch_status <> 'active'::public.cart_batch_status THEN
    RAISE EXCEPTION 'cart line not found or batch not active' USING ERRCODE = '42501';
  END IF;
  IF v_line_member_id <> v_member_id THEN
    RAISE EXCEPTION 'guests may only change their own cart lines' USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 99' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cart_lines SET quantity = p_quantity, updated_at = now()
  WHERE id = p_cart_line_id AND member_id = v_member_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_cart_line(p_cart_line_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_session_id UUID;
  v_member_id UUID;
  v_line_member_id UUID;
  v_batch_status public.cart_batch_status;
  v_session_status public.session_status;
  v_table_active BOOLEAN;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT cl.session_id INTO v_session_id FROM public.cart_lines cl WHERE cl.id = p_cart_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cart line not found' USING ERRCODE = '42501'; END IF;

  SELECT ts.status, t.is_active INTO v_session_status, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = v_session_id
  FOR UPDATE OF ts, t;
  IF NOT FOUND OR v_session_status <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE EXCEPTION 'session is not active or table is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT tm.id INTO v_member_id
  FROM public.table_members tm
  WHERE tm.session_id = v_session_id AND tm.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'caller is not a member of the session' USING ERRCODE = '42501'; END IF;
  SELECT cl.member_id, cb.status INTO v_line_member_id, v_batch_status
  FROM public.cart_lines cl
  JOIN public.cart_batches cb ON cb.id = cl.cart_batch_id
  WHERE cl.id = p_cart_line_id
  FOR UPDATE OF cb, cl;
  IF NOT FOUND OR v_batch_status <> 'active'::public.cart_batch_status THEN
    RAISE EXCEPTION 'cart line not found or batch not active' USING ERRCODE = '42501';
  END IF;
  IF v_line_member_id <> v_member_id THEN
    RAISE EXCEPTION 'guests may only remove their own cart lines' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.cart_lines WHERE id = p_cart_line_id AND member_id = v_member_id;
  RETURN FOUND;
END;
$$;

-- A guest may clear only their own contribution; other guests' lines are preserved.
CREATE OR REPLACE FUNCTION public.clear_cart(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_member_id UUID;
  v_batch_id UUID;
  v_session_status public.session_status;
  v_table_active BOOLEAN;
  v_deleted INTEGER;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT ts.status, t.is_active INTO v_session_status, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = p_session_id
  FOR UPDATE OF ts, t;
  IF NOT FOUND OR v_session_status <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE EXCEPTION 'session is not active or table is unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT tm.id INTO v_member_id FROM public.table_members tm
  WHERE tm.session_id = p_session_id AND tm.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'caller is not a member of the session' USING ERRCODE = '42501'; END IF;
  SELECT cb.id INTO v_batch_id FROM public.cart_batches cb
  WHERE cb.session_id = p_session_id AND cb.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no active cart batch found' USING ERRCODE = '22023'; END IF;

  DELETE FROM public.cart_lines WHERE cart_batch_id = v_batch_id AND member_id = v_member_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_order(
  p_session_id UUID,
  p_payment_mode TEXT,
  p_idempotency_key UUID,
  p_guest_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  order_id UUID,
  cart_batch_id UUID,
  status public.order_status,
  subtotal_paise BIGINT,
  total_paise BIGINT,
  placed_at TIMESTAMPTZ,
  idempotency_key UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_member_id UUID;
  v_session_status public.session_status;
  v_table_active BOOLEAN;
  v_batch_id UUID;
  v_existing RECORD;
  v_order_id UUID;
  v_subtotal BIGINT := 0;
  v_unit_price BIGINT;
  v_line RECORD;
  v_line_count INTEGER := 0;
  v_mode TEXT := lower(trim(p_payment_mode));
  v_member_count INTEGER;
  v_equal_share BIGINT;
  v_remainder BIGINT;
  v_allocation_total BIGINT;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023';
  END IF;
  SELECT tm.id INTO v_member_id FROM public.table_members tm
  WHERE tm.session_id = p_session_id AND tm.user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'caller is not a member of the specified session' USING ERRCODE = '42501'; END IF;

  -- Serialize joins/cart edits/submissions for a table session.
  SELECT ts.status, t.is_active INTO v_session_status, v_table_active
  FROM public.table_sessions ts
  JOIN public.dining_tables t ON t.id = ts.dining_table_id
  WHERE ts.id = p_session_id
  FOR UPDATE OF ts, t;
  IF NOT FOUND THEN RAISE EXCEPTION 'table session not found' USING ERRCODE = '22023'; END IF;

  -- A retry with the same key returns the original result, even if the session later closes.
  SELECT o.id, o.cart_batch_id, o.status, o.subtotal_paise, o.total_paise, o.placed_at, o.idempotency_key,
         o.placed_by_member_id
  INTO v_existing
  FROM public.orders o
  WHERE o.session_id = p_session_id AND o.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.placed_by_member_id <> v_member_id THEN
      RAISE EXCEPTION 'idempotency key belongs to another guest' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.cart_batch_id, v_existing.status,
                        v_existing.subtotal_paise, v_existing.total_paise, v_existing.placed_at,
                        v_existing.idempotency_key;
    RETURN;
  END IF;
  IF v_session_status <> 'open'::public.session_status OR NOT v_table_active THEN
    RAISE EXCEPTION 'session is not active or table is unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_mode NOT IN ('one', 'equal', 'items') THEN
    RAISE EXCEPTION 'payment mode must be one, equal, or items' USING ERRCODE = '22023';
  END IF;
  IF p_guest_note IS NOT NULL AND length(p_guest_note) > 500 THEN
    RAISE EXCEPTION 'guest note is too long' USING ERRCODE = '22023';
  END IF;

  SELECT cb.id INTO v_batch_id FROM public.cart_batches cb
  WHERE cb.session_id = p_session_id AND cb.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no active cart batch found' USING ERRCODE = '22023'; END IF;

  -- Revalidate availability and current server price before accepting the order.
  FOR v_line IN
    SELECT cl.id, cl.menu_item_id, cl.quantity, cl.unit_price_paise, cl.price_version,
           cl.option_selections, mi.base_price_paise, mi.price_version AS current_price_version,
           mi.is_published, mi.is_available
    FROM public.cart_lines cl
    JOIN public.menu_items mi ON mi.id = cl.menu_item_id
    WHERE cl.cart_batch_id = v_batch_id
    ORDER BY cl.id
    FOR UPDATE OF cl, mi
  LOOP
    v_line_count := v_line_count + 1;
    IF NOT v_line.is_published OR NOT v_line.is_available THEN
      RAISE EXCEPTION 'a cart item is no longer available' USING ERRCODE = '22023';
    END IF;
    v_unit_price := v_line.base_price_paise
      + private.validate_cart_options(v_line.menu_item_id, v_line.option_selections);
    IF v_line.price_version <> v_line.current_price_version OR v_line.unit_price_paise <> v_unit_price THEN
      RAISE EXCEPTION 'menu pricing changed; refresh the cart before ordering' USING ERRCODE = '22023';
    END IF;
    v_subtotal := v_subtotal + (v_line.quantity * v_unit_price);
  END LOOP;
  IF v_line_count = 0 OR v_subtotal <= 0 THEN RAISE EXCEPTION 'cart is empty' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.orders (
    session_id, cart_batch_id, idempotency_key, status, subtotal_paise, total_paise,
    placed_by_member_id, payment_mode, guest_note
  ) VALUES (
    p_session_id, v_batch_id, p_idempotency_key, 'placed'::public.order_status,
    v_subtotal, v_subtotal, v_member_id, v_mode, nullif(btrim(p_guest_note), '')
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, session_id, source_cart_line_id, contributor_member_id,
    contributor_label_snapshot, item_code_snapshot, name_snapshot, quantity,
    unit_price_paise, price_version_snapshot, options_snapshot, line_total_paise
  )
  SELECT v_order_id, cl.session_id, cl.id, cl.member_id, tm.display_label,
         mi.item_code, mi.name, cl.quantity, cl.unit_price_paise, cl.price_version,
         private.cart_options_snapshot(cl.menu_item_id, cl.option_selections),
         (cl.quantity * cl.unit_price_paise)
  FROM public.cart_lines cl
  JOIN public.menu_items mi ON mi.id = cl.menu_item_id
  JOIN public.table_members tm ON tm.id = cl.member_id
  WHERE cl.cart_batch_id = v_batch_id;

  IF v_mode = 'one' THEN
    INSERT INTO public.order_allocations(order_id, session_id, member_id, amount_paise, allocation_method)
    VALUES (v_order_id, p_session_id, v_member_id, v_subtotal, v_mode);
  ELSIF v_mode = 'equal' THEN
    SELECT count(*)::INTEGER INTO v_member_count
    FROM public.table_members tm WHERE tm.session_id = p_session_id;
    IF v_member_count < 1 THEN RAISE EXCEPTION 'no eligible table members' USING ERRCODE = '22023'; END IF;
    v_equal_share := v_subtotal / v_member_count;
    v_remainder := v_subtotal % v_member_count;
    INSERT INTO public.order_allocations(order_id, session_id, member_id, amount_paise, allocation_method)
    SELECT v_order_id, p_session_id, numbered.id,
           v_equal_share + CASE WHEN numbered.member_rank <= v_remainder THEN 1 ELSE 0 END,
           v_mode
    FROM (
      SELECT tm.id, row_number() OVER (ORDER BY tm.guest_number, tm.id) AS member_rank
      FROM public.table_members tm WHERE tm.session_id = p_session_id
    ) numbered;
  ELSE
    INSERT INTO public.order_allocations(order_id, session_id, member_id, amount_paise, allocation_method)
    SELECT v_order_id, p_session_id, cl.member_id,
           sum(cl.quantity * cl.unit_price_paise)::BIGINT, v_mode
    FROM public.cart_lines cl
    WHERE cl.cart_batch_id = v_batch_id
    GROUP BY cl.member_id;
  END IF;
  SELECT coalesce(sum(oa.amount_paise), 0)::BIGINT INTO v_allocation_total
  FROM public.order_allocations oa WHERE oa.order_id = v_order_id;
  IF v_allocation_total <> v_subtotal THEN
    RAISE EXCEPTION 'payment allocations do not equal order total' USING ERRCODE = '23514';
  END IF;

  UPDATE public.cart_batches AS batch SET status = 'submitted', submitted_at = now()
  WHERE batch.id = v_batch_id AND batch.status = 'active';
  INSERT INTO public.cart_batches(session_id, status) VALUES (p_session_id, 'active');

  RETURN QUERY SELECT o.id, v_batch_id, o.status, o.subtotal_paise, o.total_paise, o.placed_at, o.idempotency_key
  FROM public.orders o WHERE o.id = v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_status(p_order_id UUID)
RETURNS TABLE (
  order_id UUID,
  status public.order_status,
  subtotal_paise BIGINT,
  total_paise BIGINT,
  placed_at TIMESTAMPTZ,
  placed_by_member_label TEXT,
  guest_note TEXT,
  order_items JSONB,
  allocations JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_session_id UUID;
  v_is_anonymous BOOLEAN := coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') = 'true';
  v_is_active_staff BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members s
    WHERE s.user_id = v_user_id AND s.is_active AND s.role IN ('staff', 'manager', 'owner')
  ) INTO v_is_active_staff;
  SELECT o.session_id INTO v_session_id FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = '42501'; END IF;
  IF v_is_anonymous THEN
    IF NOT EXISTS (SELECT 1 FROM public.table_members tm WHERE tm.session_id = v_session_id AND tm.user_id = v_user_id) THEN
      RAISE EXCEPTION 'caller is not a member of the order session' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT v_is_active_staff THEN
    RAISE EXCEPTION 'active staff membership required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT o.id, o.status, o.subtotal_paise, o.total_paise, o.placed_at,
         placer.display_label, o.guest_note,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'id', oi.id, 'item_code', oi.item_code_snapshot, 'name', oi.name_snapshot,
             'quantity', oi.quantity, 'unit_price_paise', oi.unit_price_paise,
             'price_version', oi.price_version_snapshot, 'options', oi.options_snapshot,
             'line_total_paise', oi.line_total_paise, 'contributor', oi.contributor_label_snapshot
           ) ORDER BY oi.created_at, oi.id)
           FROM public.order_items oi WHERE oi.order_id = o.id
         ), '[]'::JSONB),
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'member_id', oa.member_id, 'guest_number', member.guest_number,
             'display_label', member.display_label, 'amount_paise', oa.amount_paise,
             'allocation_method', oa.allocation_method
           ) ORDER BY member.guest_number, oa.member_id)
           FROM public.order_allocations oa
           JOIN public.table_members member ON member.id = oa.member_id
           WHERE oa.order_id = o.id
         ), '[]'::JSONB)
  FROM public.orders o
  JOIN public.table_members placer ON placer.id = o.placed_by_member_id
  WHERE o.id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id UUID,
  p_new_status public.order_status
)
RETURNS public.order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_old_status public.order_status;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') = 'true' THEN
    RAISE EXCEPTION 'verified staff authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_members s
    WHERE s.user_id = v_user_id AND s.is_active AND s.role IN ('staff', 'manager', 'owner')
  ) THEN
    RAISE EXCEPTION 'active authorized staff membership required' USING ERRCODE = '42501';
  END IF;

  SELECT o.status INTO v_old_status FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = '22023'; END IF;
  IF v_old_status = p_new_status THEN RETURN v_old_status; END IF;
  UPDATE public.orders SET status = p_new_status, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_events(order_id, from_status, to_status, actor_staff_user_id)
  VALUES (p_order_id, v_old_status, p_new_status, v_user_id);
  RETURN p_new_status;
END;
$$;

-- Reset every function ACL after CREATE/DROP, including the default PUBLIC grant.
REVOKE ALL ON FUNCTION public.add_to_cart(UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_cart_lines(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_cart_line(UUID, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_cart_line(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_cart(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_order(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_order_status(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_order_status(UUID, public.order_status) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cart_lines(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_to_cart(UUID, UUID, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_cart_line(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_cart_line(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_cart(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, public.order_status) TO authenticated;
