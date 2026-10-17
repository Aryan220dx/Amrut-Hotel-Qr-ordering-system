begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  to_regprocedure('public.add_to_cart(uuid,uuid,integer,jsonb)') is not null,
  'add_to_cart has the expected signature'
);
select ok(
  has_function_privilege('authenticated', 'public.add_to_cart(uuid,uuid,integer,jsonb)', 'EXECUTE'),
  'authenticated can execute add_to_cart'
);
select ok(
  not has_function_privilege('anon', 'public.add_to_cart(uuid,uuid,integer,jsonb)', 'EXECUTE'),
  'anon cannot execute add_to_cart, including through PUBLIC'
);
select ok(
  not has_function_privilege('service_role', 'public.add_to_cart(uuid,uuid,integer,jsonb)', 'EXECUTE'),
  'service_role cannot execute add_to_cart'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.add_to_cart(uuid,uuid,integer,jsonb)')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE entry in the function ACL'
);

select * from finish();
rollback;
