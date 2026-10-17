-- Restrict the existing cart RPC without changing its implementation.
revoke all on function public.add_to_cart(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.add_to_cart(uuid, uuid, integer, jsonb)
  to authenticated;
