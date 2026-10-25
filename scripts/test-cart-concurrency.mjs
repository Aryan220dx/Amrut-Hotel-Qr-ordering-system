import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const flagIndex = process.argv.indexOf("--workdir");
if (flagIndex < 0 || !process.argv[flagIndex + 1]) {
  throw new Error("Pass --workdir <disposable Supabase project directory>; no default project is used.");
}

const workdir = resolve(process.argv[flagIndex + 1]);
const configPath = join(workdir, "supabase", "config.toml");
const projectConfig = readFileSync(configPath, "utf8");
const projectId = projectConfig.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? "";
if (!/(test|isolated)/i.test(projectId)) {
  throw new Error("Refusing to mutate a local Supabase project unless its project_id includes 'test' or 'isolated'.");
}

const ids = Array.from({ length: 7 }, () => randomUUID());
const [userOne, userTwo, diningTable, sessionId, memberOne, memberTwo, menuItem] = ids;
async function query(sql) {
  const databaseContainer = `supabase_db_${projectId}`;
  return new Promise((resolveQuery, rejectQuery) => {
    const process = spawn("docker", ["exec", "-i", databaseContainer, "psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let failed = false;
    process.on("error", () => {
      failed = true;
      rejectQuery(new Error("Could not run psql in the isolated Supabase database container."));
    });
    process.on("close", (code) => {
      if (failed) return;
      if (code === 0) resolveQuery();
      else rejectQuery(new Error("A SQL fixture query failed in the isolated Supabase database."));
    });
    process.stdin.end(sql);
  });
}

const setup = `
BEGIN;
INSERT INTO auth.users (id, aud, role, is_anonymous, created_at, updated_at) VALUES
  ('${userOne}', 'authenticated', 'authenticated', true, now(), now()),
  ('${userTwo}', 'authenticated', 'authenticated', true, now(), now());
INSERT INTO public.dining_tables (id, label) VALUES ('${diningTable}', 'Concurrent cart test ${diningTable.slice(0, 8)}');
INSERT INTO public.table_sessions (id, dining_table_id) VALUES ('${sessionId}', '${diningTable}');
INSERT INTO public.table_members (id, session_id, user_id, guest_number, display_label) VALUES
  ('${memberOne}', '${sessionId}', '${userOne}', 1, 'Guest 1'),
  ('${memberTwo}', '${sessionId}', '${userTwo}', 2, 'Guest 2');
INSERT INTO public.menu_items (id, item_code, category, name, description, base_price_paise, is_published, is_available)
VALUES ('${menuItem}', 'TEST-${menuItem}', 'Test', 'Concurrency item', '', 10000, true, true);
COMMIT;
`;

function addForUser(userId) {
  return `
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated","is_anonymous":true}', true);
SELECT * FROM public.add_to_cart('${sessionId}', '${menuItem}', 1, '{}'::jsonb);
COMMIT;
`;
}

const cleanup = `
DELETE FROM public.cart_lines WHERE session_id = '${sessionId}';
DELETE FROM public.cart_batches WHERE session_id = '${sessionId}';
DELETE FROM public.table_members WHERE session_id = '${sessionId}';
DELETE FROM public.table_sessions WHERE id = '${sessionId}';
DELETE FROM public.dining_tables WHERE id = '${diningTable}';
DELETE FROM public.menu_items WHERE id = '${menuItem}';
DELETE FROM auth.users WHERE id IN ('${userOne}', '${userTwo}');
`;

let created = false;
try {
  await query(setup);
  created = true;
  const calls = Array.from({ length: 12 }, (_, index) => addForUser(index % 2 === 0 ? userOne : userTwo));
  const results = await Promise.allSettled(calls.map((sql) => query(sql)));
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("At least one concurrent cart RPC failed in the isolated database.");
  }
  await query(`
DO $$
DECLARE
  line_count integer;
  contributor_count integer;
  active_batch_count integer;
BEGIN
  SELECT count(*) INTO line_count
  FROM public.cart_lines line
  JOIN public.cart_batches batch ON batch.id = line.cart_batch_id
  WHERE batch.session_id = '${sessionId}' AND batch.status = 'active';
  SELECT count(DISTINCT line.member_id) INTO contributor_count
  FROM public.cart_lines line
  JOIN public.cart_batches batch ON batch.id = line.cart_batch_id
  WHERE batch.session_id = '${sessionId}' AND batch.status = 'active';
  SELECT count(*) INTO active_batch_count FROM public.cart_batches
  WHERE session_id = '${sessionId}' AND status = 'active';
  IF line_count <> 12 OR contributor_count <> 2 OR active_batch_count <> 1 THEN
    RAISE EXCEPTION 'concurrent cart result mismatch';
  END IF;
END;
$$;
`);
  console.log("PASS: 12 concurrent guest additions preserved all cart lines and the single shared active batch.");
} finally {
  if (created) await query(cleanup);
}
