-- Guests call this RPC with their Auth bearer token. The function derives user identity
-- from auth.uid(); caller-supplied user or membership IDs are never accepted.
create or replace function public.join_table_session(p_invite_token text)
returns table (session_id uuid, guest_number integer, display_label text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invite record;
  v_guest_number integer;
  v_display_label text;
begin
  if v_user_id is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' then
    raise exception 'anonymous authentication required' using errcode = '42501';
  end if;

  -- Tokens are 32 random bytes encoded as unpadded base64url (43 characters).
  -- Reject malformed values before hashing; the raw token is never persisted or returned.
  if p_invite_token is null
     or length(p_invite_token) <> 43
     or p_invite_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid or expired table invite' using errcode = '22023';
  end if;

  select i.session_id, i.expires_at, i.revoked_at, s.status as session_status, t.is_active as table_active
    into v_invite
  from public.table_invites i
  join public.table_sessions s on s.id = i.session_id
  join public.dining_tables t on t.id = s.dining_table_id
  where i.token_hash = extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256')
  for update of s, i;

  if not found then
    raise exception 'invalid or expired table invite' using errcode = '22023';
  end if;

  if v_invite.revoked_at is not null
     or v_invite.expires_at <= pg_catalog.clock_timestamp()
     or v_invite.session_status <> 'open'::public.session_status
     or not v_invite.table_active then
    raise exception 'invalid or expired table invite' using errcode = '22023';
  end if;

  -- Locking the session serializes membership retries and guest-number allocation.
  -- The lock above is held through transaction completion.
  select m.guest_number, m.display_label
    into v_guest_number, v_display_label
  from public.table_members m
  where m.session_id = v_invite.session_id and m.user_id = v_user_id;
  if found then
    return query select v_invite.session_id, v_guest_number, v_display_label;
    return;
  end if;

  select coalesce(max(m.guest_number), 0) + 1
    into v_guest_number
  from public.table_members m
  where m.session_id = v_invite.session_id;
  v_display_label := pg_catalog.format('Guest %s', v_guest_number);

  insert into public.table_members (session_id, user_id, guest_number, display_label)
  values (v_invite.session_id, v_user_id, v_guest_number, v_display_label);

  return query select v_invite.session_id, v_guest_number, v_display_label;
end;
$$;

revoke all on function public.join_table_session(text) from public, anon;
grant execute on function public.join_table_session(text) to authenticated;
