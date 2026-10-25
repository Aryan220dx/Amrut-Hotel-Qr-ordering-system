begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  to_regprocedure('public.add_to_cart(uuid,uuid,integer,jsonb)') is not null
  and to_regprocedure('public.get_cart_lines(uuid)') is not null
  and to_regprocedure('public.update_cart_line(uuid,integer)') is not null
  and to_regprocedure('public.remove_cart_line(uuid)') is not null
  and to_regprocedure('public.clear_cart(uuid)') is not null
  and to_regprocedure('public.submit_order(uuid,text,uuid,text)') is not null
  and to_regprocedure('public.get_order_status(uuid)') is not null
  and to_regprocedure('public.update_order_status(uuid,public.order_status)') is not null,
  'all cart and order RPC signatures exist'
);

select ok(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
   from unnest(array[
     'public.add_to_cart(uuid,uuid,integer,jsonb)'::regprocedure,
     'public.get_cart_lines(uuid)'::regprocedure,
     'public.update_cart_line(uuid,integer)'::regprocedure,
     'public.remove_cart_line(uuid)'::regprocedure,
     'public.clear_cart(uuid)'::regprocedure,
     'public.submit_order(uuid,text,uuid,text)'::regprocedure,
     'public.get_order_status(uuid)'::regprocedure,
     'public.update_order_status(uuid,public.order_status)'::regprocedure
   ]) AS p(oid)),
  'authenticated can reach guarded RPCs'
);

select ok(
  (select bool_and(
      not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
   )
   from unnest(array[
     'public.add_to_cart(uuid,uuid,integer,jsonb)'::regprocedure,
     'public.get_cart_lines(uuid)'::regprocedure,
     'public.update_cart_line(uuid,integer)'::regprocedure,
     'public.remove_cart_line(uuid)'::regprocedure,
     'public.clear_cart(uuid)'::regprocedure,
     'public.submit_order(uuid,text,uuid,text)'::regprocedure,
     'public.get_order_status(uuid)'::regprocedure,
     'public.update_order_status(uuid,public.order_status)'::regprocedure
   ]) AS p(oid)),
  'anon and service_role have no effective RPC execution'
);

select ok(
  not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = any(array[
      'public.add_to_cart(uuid,uuid,integer,jsonb)'::regprocedure,
      'public.get_cart_lines(uuid)'::regprocedure,
      'public.update_cart_line(uuid,integer)'::regprocedure,
      'public.remove_cart_line(uuid)'::regprocedure,
      'public.clear_cart(uuid)'::regprocedure,
      'public.submit_order(uuid,text,uuid,text)'::regprocedure,
      'public.get_order_status(uuid)'::regprocedure,
      'public.update_order_status(uuid,public.order_status)'::regprocedure
    ])
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ),
  'no cart or order RPC has a PUBLIC EXECUTE ACL entry'
);

select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
   from pg_proc p
   where p.oid = any(array[
     'public.add_to_cart(uuid,uuid,integer,jsonb)'::regprocedure,
     'public.get_cart_lines(uuid)'::regprocedure,
     'public.update_cart_line(uuid,integer)'::regprocedure,
     'public.remove_cart_line(uuid)'::regprocedure,
     'public.clear_cart(uuid)'::regprocedure,
     'public.submit_order(uuid,text,uuid,text)'::regprocedure,
     'public.get_order_status(uuid)'::regprocedure,
     'public.update_order_status(uuid,public.order_status)'::regprocedure
   ])),
  'privileged RPCs use SECURITY DEFINER with an empty search_path'
);

select ok(
  exists (select 1 from pg_class where oid = 'public.order_allocations'::regclass and relrowsecurity)
  and not has_table_privilege('authenticated', 'public.order_allocations', 'INSERT'),
  'order allocations have RLS and no direct guest writes'
);

select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.order_items'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%jsonb_typeof(options_snapshot) = ''array''%'),
  'immutable order option snapshots retain their array schema'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_mode')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'guest_note'),
  'orders persist payment allocation mode and guest note'
);

select * from finish();
rollback;
