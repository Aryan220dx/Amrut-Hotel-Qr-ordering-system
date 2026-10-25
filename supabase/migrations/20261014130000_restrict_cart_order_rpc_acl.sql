-- Reassert narrow RPC execution privileges after function recreation.
-- Supabase's function default privileges can include anon/authenticated/service_role;
-- PostgreSQL also grants EXECUTE to PUBLIC for newly created functions.
-- Keep this scoped to the guest/staff cart and order RPC surface.
REVOKE ALL ON FUNCTION public.add_to_cart(UUID, UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_cart_lines(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_cart_line(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_cart_line(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_cart(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_order(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_order_status(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_order_status(UUID, public.order_status)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.add_to_cart(UUID, UUID, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cart_lines(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_cart_line(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_cart_line(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_cart(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, public.order_status) TO authenticated;
