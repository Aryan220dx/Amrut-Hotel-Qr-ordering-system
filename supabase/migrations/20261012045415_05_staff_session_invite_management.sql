-- Staff management commands are the only API write path for sessions and invites.
-- Role assignment remains an out-of-band trusted database-operator action.

create or replace function private.assert_staff_management_access()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null
     or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'false'
     or not exists (
       select 1 from public.staff_members s
       where s.user_id = v_user_id
         and s.is_active
         and s.role in (
           'staff'::public.staff_role,
           'manager'::public.staff_role,
           'owner'::public.staff_role
         )
     ) then
    raise exception 'active staff authentication required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_staff_management_access() from public, anon, authenticated;

create or replace function public.open_table_session(p_dining_table_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_table_active boolean;
  v_session_id uuid;
begin
  perform private.assert_staff_management_access();

  select t.is_active into v_table_active
  from public.dining_tables t
  where t.id = p_dining_table_id
  for update;

  if not found or not v_table_active then
    raise exception 'table is unavailable' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.table_sessions s
    where s.dining_table_id = p_dining_table_id and s.status = 'open'
  ) then
    raise exception 'table already has an open session' using errcode = '23505';
  end if;

  insert into public.table_sessions (dining_table_id, status, opened_by)
  values (p_dining_table_id, 'open', v_user_id)
  returning id into v_session_id;

  return v_session_id;
exception
  when unique_violation then
    raise exception 'table already has an open session' using errcode = '23505';
end;
$$;
revoke all on function public.open_table_session(uuid) from public, anon;
grant execute on function public.open_table_session(uuid) to authenticated;

-- Issuance doubles as atomic rotation: the prior invite is revoked and its
-- replacement inserted in one transaction. A failed insert rolls back revocation.
create or replace function public.issue_table_invite(
  p_session_id uuid,
  p_expires_in_seconds integer default 3600
)
returns table (invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_table_active boolean;
  v_session_status public.session_status;
  v_token text;
  v_expires_at timestamptz;
begin
  perform private.assert_staff_management_access();

  if p_expires_in_seconds is null or p_expires_in_seconds < 60 or p_expires_in_seconds > 86400 then
    raise exception 'invite expiry must be between 60 and 86400 seconds' using errcode = '22023';
  end if;

  select s.status, t.is_active into v_session_status, v_table_active
  from public.table_sessions s
  join public.dining_tables t on t.id = s.dining_table_id
  where s.id = p_session_id
  for update of s, t;

  if not found or v_session_status <> 'open'::public.session_status or not v_table_active then
    raise exception 'session is unavailable' using errcode = '22023';
  end if;

  update public.table_invites i
  set revoked_at = pg_catalog.clock_timestamp()
  where i.session_id = p_session_id and i.revoked_at is null;

  v_token := pg_catalog.translate(
    pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '='),
    '+/', '-_'
  );
  v_expires_at := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_expires_in_seconds);

  insert into public.table_invites (session_id, token_hash, expires_at, created_by)
  values (
    p_session_id,
    extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'),
    v_expires_at,
    v_user_id
  );

  return query select v_token, v_expires_at;
end;
$$;
revoke all on function public.issue_table_invite(uuid, integer) from public, anon;
grant execute on function public.issue_table_invite(uuid, integer) to authenticated;

create or replace function public.revoke_table_invite(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_active boolean;
  v_session_status public.session_status;
  v_updated integer;
begin
  perform private.assert_staff_management_access();

  select s.status, t.is_active into v_session_status, v_table_active
  from public.table_sessions s
  join public.dining_tables t on t.id = s.dining_table_id
  where s.id = p_session_id
  for update of s, t;

  if not found or v_session_status <> 'open'::public.session_status or not v_table_active then
    raise exception 'session is unavailable' using errcode = '22023';
  end if;

  update public.table_invites i
  set revoked_at = pg_catalog.clock_timestamp()
  where i.session_id = p_session_id and i.revoked_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'no active invite for session' using errcode = '22023';
  end if;
  return true;
end;
$$;
revoke all on function public.revoke_table_invite(uuid) from public, anon;
grant execute on function public.revoke_table_invite(uuid) to authenticated;
