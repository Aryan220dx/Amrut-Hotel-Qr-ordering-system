-- Draft migration: Update join_table_session to accept an optional display name.
-- User identity remains tied strictly to auth.uid(); p_display_name is purely for UI display.
-- Do NOT apply this migration without user authorization.

CREATE OR REPLACE FUNCTION public.join_table_session(
  p_invite_token text,
  p_display_name text
)
RETURNS TABLE (session_id uuid, guest_number integer, display_label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_invite record;
  v_guest_number integer;
  v_display_label text;
  v_custom_name text;
BEGIN
  IF v_user_id IS NULL OR coalesce((SELECT auth.jwt() ->> 'is_anonymous'), 'false') <> 'true' THEN
    RAISE EXCEPTION 'anonymous authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_invite_token IS NULL
     OR length(p_invite_token) <> 43
     OR p_invite_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid or expired table invite' USING ERRCODE = '22023';
  END IF;

  SELECT i.session_id, i.expires_at, i.revoked_at, s.status AS session_status, t.is_active AS table_active
    INTO v_invite
  FROM public.table_invites i
  JOIN public.table_sessions s ON s.id = i.session_id
  JOIN public.dining_tables t ON t.id = s.dining_table_id
  WHERE i.token_hash = extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256')
  FOR UPDATE OF s, i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired table invite' USING ERRCODE = '22023';
  END IF;

  IF v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= pg_catalog.clock_timestamp()
     OR v_invite.session_status <> 'open'::public.session_status
     OR NOT v_invite.table_active THEN
    RAISE EXCEPTION 'invalid or expired table invite' USING ERRCODE = '22023';
  END IF;

  -- Normalize all whitespace before applying the schema's 32-character limit.
  v_custom_name := pg_catalog.left(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(coalesce(p_display_name, ''), '[[:space:]]+', ' ', 'g')
    ),
    32
  );

  -- Check existing membership
  SELECT m.guest_number, m.display_label
    INTO v_guest_number, v_display_label
  FROM public.table_members m
  WHERE m.session_id = v_invite.session_id AND m.user_id = v_user_id;

  IF FOUND THEN
    -- If custom name provided and different, update existing membership display_label
    IF v_custom_name <> '' AND v_custom_name <> v_display_label THEN
      UPDATE public.table_members
      SET display_label = v_custom_name
      WHERE session_id = v_invite.session_id AND user_id = v_user_id;
      v_display_label := v_custom_name;
    END IF;
    RETURN QUERY SELECT v_invite.session_id, v_guest_number, v_display_label;
    RETURN;
  END IF;

  SELECT coalesce(max(m.guest_number), 0) + 1
    INTO v_guest_number
  FROM public.table_members m
  WHERE m.session_id = v_invite.session_id;

  IF v_custom_name <> '' THEN
    v_display_label := v_custom_name;
  ELSE
    v_display_label := pg_catalog.format('Guest %s', v_guest_number);
  END IF;

  INSERT INTO public.table_members (session_id, user_id, guest_number, display_label)
  values (v_invite.session_id, v_user_id, v_guest_number, v_display_label);

  RETURN QUERY SELECT v_invite.session_id, v_guest_number, v_display_label;
END;
$$;

REVOKE ALL ON FUNCTION public.join_table_session(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_table_session(text, text) TO authenticated;
