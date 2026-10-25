-- Reassert the add_to_cart ACL after the function is created by the prior migration.
REVOKE ALL ON FUNCTION public.add_to_cart(UUID, UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_to_cart(UUID, UUID, INTEGER, JSONB)
  TO authenticated;
