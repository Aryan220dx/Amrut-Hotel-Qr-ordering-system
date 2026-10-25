BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(30);

INSERT INTO auth.users (id, aud, role, is_anonymous, created_at, updated_at) VALUES
  ('61000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', true, now(), now()),
  ('61000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', true, now(), now()),
  ('61000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', false, now(), now()),
  ('61000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', true, now(), now());

INSERT INTO public.dining_tables (id, label) VALUES
  ('62000000-0000-0000-0000-000000000001', 'Cart Workflow A'),
  ('62000000-0000-0000-0000-000000000002', 'Cart Workflow B');
INSERT INTO public.table_sessions (id, dining_table_id) VALUES
  ('63000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001'),
  ('63000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000002');
INSERT INTO public.table_members (id, session_id, user_id, guest_number, display_label) VALUES
  ('64000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 1, 'Guest 1'),
  ('64000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 2, 'Guest 2');
INSERT INTO public.staff_members (user_id, role, is_active)
VALUES ('61000000-0000-0000-0000-000000000003', 'staff', true);

INSERT INTO public.menu_items (id, item_code, category, name, description, base_price_paise, price_version, is_published, is_available)
VALUES ('65000000-0000-0000-0000-000000000001', 'TEST-CART-ORDER', 'Test', 'Test curry', '', 10000, 1, true, true);
INSERT INTO public.menu_option_groups (id, menu_item_id, option_key, label, min_selections, max_selections)
VALUES ('66000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 'spice', 'Spice', 1, 1);
INSERT INTO public.menu_options (group_id, option_key, label, price_delta_paise, is_available) VALUES
  ('66000000-0000-0000-0000-000000000001', 'mild', 'Mild', 0, true),
  ('66000000-0000-0000-0000-000000000001', 'spicy', 'Spicy', 250, true);

SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT unit_price_paise FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 2, '{"spice":"spicy"}'::jsonb)),
  10250::bigint,
  'cart RPC calculates authoritative base price plus selected option price'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.get_cart_lines('63000000-0000-0000-0000-000000000001')), 1, 'another session member can see the shared cart');
SELECT is((SELECT is_mine FROM public.get_cart_lines('63000000-0000-0000-0000-000000000001') LIMIT 1), false, 'shared cart identifies another guest contribution as read-only');
SELECT throws_ok($$SELECT * FROM public.get_cart_lines('63000000-0000-0000-0000-000000000002')$$, '42501', 'caller is not a member of the specified session', 'a non-member cannot read a different session cart');
SELECT is(
  (SELECT unit_price_paise FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '{"spice":"mild"}'::jsonb)),
  10000::bigint,
  'second guest can contribute to the shared batch'
);
SELECT is(public.clear_cart('63000000-0000-0000-0000-000000000001'), 1, 'clear_cart removes only the caller contribution');
SELECT is((SELECT count(*)::integer FROM public.get_cart_lines('63000000-0000-0000-0000-000000000001')), 1, 'clearing one guest contribution preserves other guests lines');
SELECT throws_ok(
  $$SELECT public.update_cart_line((SELECT id FROM public.cart_lines LIMIT 1), 3)$$,
  '42501', 'guests may only change their own cart lines', 'a guest cannot update another guest cart line'
);
SELECT throws_ok(
  $$SELECT public.remove_cart_line((SELECT id FROM public.cart_lines LIMIT 1))$$,
  '42501', 'guests may only remove their own cart lines', 'a guest cannot remove another guest cart line'
);
SELECT throws_ok(
  $$SELECT * FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 0, '{"spice":"mild"}'::jsonb)$$,
  '22023', 'quantity must be between 1 and 99', 'invalid quantities are rejected'
);
SELECT throws_ok(
  $$SELECT * FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '{"spice":"secret"}'::jsonb)$$,
  '22023', 'option is unavailable or does not belong to its group', 'unknown options are rejected'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT status::text FROM public.submit_order('63000000-0000-0000-0000-000000000001', 'equal', '67000000-0000-0000-0000-000000000001', NULL)),
  'placed',
  'valid submission creates an order'
);
SELECT is(
  (SELECT order_id FROM public.submit_order('63000000-0000-0000-0000-000000000001', 'equal', '67000000-0000-0000-0000-000000000001', NULL)),
  (SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'),
  'retry with the same idempotency key returns the original order'
);
SELECT is((SELECT count(*)::integer FROM public.orders WHERE session_id = '63000000-0000-0000-0000-000000000001'), 1, 'idempotent retry does not duplicate an order');
SELECT is((SELECT count(*)::integer FROM public.cart_batches WHERE session_id = '63000000-0000-0000-0000-000000000001' AND status = 'active'), 1, 'submission creates a fresh active cart batch');
SELECT ok((SELECT jsonb_typeof(options_snapshot) = 'array' AND options_snapshot @> '[{"option_key":"spicy"}]'::jsonb FROM public.order_items LIMIT 1), 'order stores the selected customization in its immutable array snapshot');
SELECT is((SELECT sum(amount_paise)::bigint FROM public.order_allocations WHERE order_id = (SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001')), (SELECT total_paise FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'), 'persisted split allocations exactly equal the order total');
SELECT is((SELECT order_id FROM public.get_order_status((SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'))), (SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'), 'a table member can load order status');

RESET ROLE;
CREATE TEMP TABLE test_order_reference (order_id uuid);
INSERT INTO test_order_reference
SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001';
GRANT SELECT ON test_order_reference TO authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.get_order_status((SELECT order_id FROM test_order_reference))$$,
  '42501', 'caller is not a member of the order session', 'a non-member cannot read an order by UUID'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT * FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '{"spice":"mild"}'::jsonb);
RESET ROLE;
UPDATE public.menu_items SET base_price_paise = 10500, price_version = 2 WHERE id = '65000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.submit_order('63000000-0000-0000-0000-000000000001', 'items', '67000000-0000-0000-0000-000000000002', NULL)$$,
  '22023', 'menu pricing changed; refresh the cart before ordering', 'submission rejects stale cart prices'
);
RESET ROLE;
UPDATE public.menu_items SET is_available = false WHERE id = '65000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '{"spice":"mild"}'::jsonb)$$,
  '22023', 'menu item is not available', 'unavailable menu items cannot be added'
);
RESET ROLE;
UPDATE public.menu_items SET is_available = true WHERE id = '65000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.remove_cart_line((
  SELECT cl.id
  FROM public.cart_lines cl
  JOIN public.cart_batches cb ON cb.id = cl.cart_batch_id
  WHERE cb.session_id = '63000000-0000-0000-0000-000000000001' AND cb.status = 'active'
  ORDER BY cl.created_at
  LIMIT 1
));
SELECT * FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '{"spice":"mild"}'::jsonb);
SELECT is(
  (SELECT status::text FROM public.submit_order('63000000-0000-0000-0000-000000000001', 'items', '67000000-0000-0000-0000-000000000002', NULL)),
  'placed',
  'a refreshed cart can be submitted as a second order in the same session'
);
SELECT is((SELECT count(*)::integer FROM public.orders WHERE session_id = '63000000-0000-0000-0000-000000000001'), 2, 'multiple orders can share one table session');
SELECT throws_ok(
  $$SELECT public.update_order_status((SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'), 'preparing')$$,
  '42501', 'verified staff authentication required', 'guests cannot change order status'
);

RESET ROLE;
UPDATE public.staff_members SET is_active = false WHERE user_id = '61000000-0000-0000-0000-000000000003';
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.update_order_status((SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'), 'preparing')$$,
  '42501', 'active authorized staff membership required', 'inactive staff cannot change order status'
);
RESET ROLE;
UPDATE public.staff_members SET is_active = true WHERE user_id = '61000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT is(
  public.update_order_status((SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'), 'preparing'),
  'preparing'::public.order_status,
  'active staff can advance order status'
);
SELECT is((SELECT count(*)::integer FROM public.order_status_events WHERE to_status = 'preparing'), 1, 'staff status transition is recorded as an append-only event');
SELECT throws_ok(
  $$SELECT public.update_order_status((SELECT id FROM public.orders WHERE idempotency_key = '67000000-0000-0000-0000-000000000001'), 'served')$$,
  '23514', 'invalid order status transition: preparing -> served', 'staff cannot skip an order status step'
);

RESET ROLE;
UPDATE public.table_sessions SET status = 'closed', closed_at = now() WHERE id = '63000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.add_to_cart('63000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001', 1, '{"spice":"mild"}'::jsonb)$$,
  '22023', 'session is not active or table is unavailable', 'closed sessions reject cart mutations'
);
SELECT throws_ok(
  $$SELECT * FROM public.submit_order('63000000-0000-0000-0000-000000000001', 'one', '67000000-0000-0000-0000-000000000003', NULL)$$,
  '22023', 'session is not active or table is unavailable', 'closed sessions reject new order submissions'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
