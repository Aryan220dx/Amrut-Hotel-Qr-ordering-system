
-- Database backstops for snapshots and submitted cart batches.

create or replace function private.guard_cart_line_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_status public.cart_batch_status;
  v_session_status public.session_status;
begin
  v_batch_id := case
    when tg_op = 'DELETE' then old.cart_batch_id
    else new.cart_batch_id
  end;

  select b.status, s.status
    into v_status, v_session_status
  from public.cart_batches b
  join public.table_sessions s on s.id = b.session_id
  where b.id = v_batch_id
  for update of b;

  if v_status is distinct from 'active'::public.cart_batch_status then
    raise exception 'cart batch is immutable unless active'
      using errcode = '55000';
  end if;

  if v_session_status is distinct from 'open'::public.session_status then
    raise exception 'table session is closed'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' and (
    new.cart_batch_id <> old.cart_batch_id
    or new.session_id <> old.session_id
    or new.member_id <> old.member_id
  ) then
    raise exception 'cart line attribution and batch cannot be changed'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger cart_lines_active_batch_guard
before insert or update or delete on public.cart_lines
for each row execute function private.guard_cart_line_mutation();


create or replace function private.guard_submitted_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Once a batch is no longer active, it cannot be changed.
  if old.status <> 'active' and new is distinct from old then
    raise exception 'non-active cart batches are immutable'
      using errcode = '55000';
  end if;

  -- A batch cannot transition to submitted without a timestamp.
  if old.status = 'active'
     and new.status = 'submitted'
     and new.submitted_at is null then
    raise exception 'submitted_at is required'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger cart_batches_immutable_guard
before update on public.cart_batches
for each row execute function private.guard_submitted_batch();


create or replace function private.guard_session_close_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'closed table sessions cannot be reopened'
      using errcode = '55000';
  end if;

  if old.status = 'open'
     and new.status = 'closed'
     and new.closed_at is null then
    raise exception 'closed_at is required when closing a session'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger table_sessions_close_only
before update of status on public.table_sessions
for each row execute function private.guard_session_close_only();


create or replace function private.guard_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if not (
    (old.status = 'placed' and new.status in ('preparing', 'cancelled'))
    or (old.status = 'preparing' and new.status in ('ready', 'cancelled'))
    or (old.status = 'ready' and new.status = 'served')
  ) then
    raise exception 'invalid order status transition: % -> %',
      old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger orders_status_transition
before update of status on public.orders
for each row execute function private.guard_order_status_transition();


create or replace function private.reject_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger order_items_append_only
before update or delete on public.order_items
for each row execute function private.reject_row_mutation();

create trigger order_status_events_append_only
before update or delete on public.order_status_events
for each row execute function private.reject_row_mutation();
