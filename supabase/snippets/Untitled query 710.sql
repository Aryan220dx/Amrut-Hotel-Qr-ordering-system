select
  sm.user_id,
  sm.role,
  sm.is_active,
  u.is_anonymous
from public.staff_members sm
join auth.users u on u.id = sm.user_id
where sm.user_id = 'dddbaf16-ad2a-4b70-a50f-9bd0ecdf89a4'::uuid;