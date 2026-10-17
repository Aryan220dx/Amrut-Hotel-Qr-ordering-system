-- Staff may inspect their own assignment only; staff lists are not part of the
-- customer/staff Data API surface.
drop policy if exists staff_members_staff_read on public.staff_members;

-- Management requires an explicit permanent-user claim. Missing claims fail closed.
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
     or (select auth.jwt() ->> 'is_anonymous') is distinct from 'false'
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
