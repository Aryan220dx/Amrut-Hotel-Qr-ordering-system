-- Qualify the outer table ID: bare `id` resolves to table_sessions.id inside
-- the subquery, which previously compared a table's ID to a session's ID.
DROP POLICY IF EXISTS dining_tables_member_read ON public.dining_tables;

CREATE POLICY dining_tables_member_read
  ON public.dining_tables
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.table_sessions AS s
      WHERE s.dining_table_id = dining_tables.id
        AND private.is_session_member(s.id)
    )
  );
