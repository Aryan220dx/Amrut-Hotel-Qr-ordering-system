CREATE OR REPLACE FUNCTION public.test_func()
RETURNS integer
LANGUAGE sql
AS $$
  SELECT 1;
$$;
