import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomUUID } from 'node:crypto';

const runCli = (args) => execFileSync('npx', ['supabase', ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const statusText = runCli(['status', '--output', 'env']);
const status = Object.fromEntries(statusText.split(/\r?\n/).filter(Boolean).map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, '')];
}));
const apiUrl = status.API_URL;
const apiKey = status.PUBLISHABLE_KEY;
assert.ok(apiUrl?.startsWith('http://127.0.0.1:'), 'local Supabase API must be running');
assert.ok(apiKey, 'local publishable key must be available');

const fixture = randomUUID();
const tableIds = [randomUUID(), randomUUID()];
const closedSessionId = randomUUID();
const identities = [];
const tempDir = mkdtempSync(pathJoin(tmpdir(), 'hotel-amrut-staff-'));
const sqlFile = pathJoin(tempDir, 'fixture.sql');
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const idList = (ids) => ids.map(sqlLiteral).join(', ');

async function request(path, { token, body } = {}) {
  const headers = { apikey: apiKey };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function createPermanentUser(kind) {
  const email = `ary24-${fixture}-${kind}@example.test`;
  const response = await request('/auth/v1/signup', {
    body: { email, password: `A!${fixture}x9`, data: {} },
  });
  assert.equal(response.status, 200, `local permanent Auth user (${kind}) should be created`);
  assert.equal(response.payload.user?.is_anonymous, false, 'staff identity must be a permanent Auth user');
  assert.ok(response.payload.access_token, 'Auth should return an access token');
  identities.push(response.payload.user.id);
  return { id: response.payload.user.id, token: response.payload.access_token };
}

async function createAnonymousUser() {
  const response = await request('/auth/v1/signup', { body: { data: {} } });
  assert.equal(response.status, 200, 'local anonymous Auth should work');
  assert.equal(response.payload.user?.is_anonymous, true, 'test identity should be anonymous');
  identities.push(response.payload.user.id);
  return response.payload.access_token;
}

async function rpc(name, token, body) {
  return request(`/rest/v1/rpc/${name}`, { token, body });
}

function runSql(sql) {
  writeFileSync(sqlFile, sql, { mode: 0o600 });
  runCli(['db', 'query', '--local', '--file', sqlFile]);
}

async function seed(staffId, inactiveStaffId) {
  const sql = `
    do $fixture$
    begin
      insert into public.dining_tables (id, label, is_active) values
        (${sqlLiteral(tableIds[0])}, ${sqlLiteral(`ARY24 ${fixture.slice(0, 8)} active`)}, true),
        (${sqlLiteral(tableIds[1])}, ${sqlLiteral(`ARY24 ${fixture.slice(0, 8)} inactive`)}, false);
      insert into public.table_sessions (id, dining_table_id, status, closed_at)
      values (${sqlLiteral(closedSessionId)}, ${sqlLiteral(tableIds[0])}, 'closed', now());
      insert into public.staff_members (user_id, role, is_active) values
        (${sqlLiteral(staffId)}, 'staff', true),
        (${sqlLiteral(inactiveStaffId)}, 'owner', false);
    end
    $fixture$;
  `;
  runSql(sql);
}

async function cleanup() {
  const fixtureCleanup = didSeed ? `
    delete from public.table_sessions where dining_table_id in (${idList(tableIds)});
    delete from public.dining_tables where id in (${idList(tableIds)});
  ` : '';
  runSql(`do $cleanup$ begin
    ${fixtureCleanup}
    ${identities.length ? `delete from auth.users where id in (${idList(identities)});` : ''}
  end $cleanup$;`);
}

let didSeed = false;
try {
  const [staff, inactiveStaff, nonStaff] = await Promise.all([
    createPermanentUser('staff'), createPermanentUser('inactive'), createPermanentUser('nonstaff'),
  ]);
  const anonymousToken = await createAnonymousUser();
  seed(staff.id, inactiveStaff.id);
  didSeed = true;

  for (const [name, token, args] of [
    ['open_table_session', null, { p_dining_table_id: tableIds[0] }],
    ['open_table_session', anonymousToken, { p_dining_table_id: tableIds[0] }],
    ['open_table_session', nonStaff.token, { p_dining_table_id: tableIds[0] }],
    ['open_table_session', inactiveStaff.token, { p_dining_table_id: tableIds[0] }],
  ]) {
    const denied = await rpc(name, token, args);
    assert.ok(denied.status === 401 || denied.status === 403, `${name} should reject unauthenticated, anonymous, nonstaff, and inactive staff callers`);
  }

  const inactiveTable = await rpc('open_table_session', staff.token, { p_dining_table_id: tableIds[1] });
  assert.notEqual(inactiveTable.status, 200, 'inactive tables cannot be opened');

  const opens = await Promise.all(Array.from({ length: 5 }, () =>
    rpc('open_table_session', staff.token, { p_dining_table_id: tableIds[0] })));
  const succeeded = opens.filter((result) => result.status === 200);
  assert.equal(succeeded.length, 1, 'concurrent open requests create exactly one session');
  const sessionId = succeeded[0].payload;
  assert.match(sessionId, /^[0-9a-f-]{36}$/i, 'open RPC returns only the session id');
  for (const result of opens) assert.ok(result.status === 200 || result.status === 409, 'losing duplicate open requests fail as conflicts');

  const badTtl = await rpc('issue_table_invite', staff.token, { p_session_id: sessionId, p_expires_in_seconds: 30 });
  assert.notEqual(badTtl.status, 200, 'invite expiry below minimum is rejected');
  const longTtl = await rpc('issue_table_invite', staff.token, { p_session_id: sessionId, p_expires_in_seconds: 86401 });
  assert.notEqual(longTtl.status, 200, 'invite expiry above maximum is rejected');
  const closedIssue = await rpc('issue_table_invite', staff.token, { p_session_id: closedSessionId, p_expires_in_seconds: 600 });
  assert.notEqual(closedIssue.status, 200, 'closed sessions cannot receive invites');
  const closedRevoke = await rpc('revoke_table_invite', staff.token, { p_session_id: closedSessionId });
  assert.notEqual(closedRevoke.status, 200, 'closed sessions cannot be managed through invite revocation');
  const initial = await rpc('issue_table_invite', staff.token, { p_session_id: sessionId, p_expires_in_seconds: 3600 });
  assert.equal(initial.status, 200, 'active staff can issue an invite');
  const firstToken = initial.payload[0].invite_token;
  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/, 'invite token is 32 random bytes in base64url form');

  const replacements = await Promise.all(Array.from({ length: 3 }, () =>
    rpc('issue_table_invite', staff.token, { p_session_id: sessionId, p_expires_in_seconds: 3600 })));
  for (const replacement of replacements) {
    assert.equal(replacement.status, 200, 'concurrent invite rotation succeeds transactionally');
    assert.match(replacement.payload[0].invite_token, /^[A-Za-z0-9_-]{43}$/);
  }
  const allTokens = [firstToken, ...replacements.map((result) => result.payload[0].invite_token)];
  const hashes = allTokens.map((token) => `extensions.digest(convert_to(${sqlLiteral(token)}, 'UTF8'), 'sha256')`).join(', ');
  runSql(`
    do $assert$
    begin
      if (select count(*) from public.table_invites where session_id = ${sqlLiteral(sessionId)} and revoked_at is null) <> 1 then
        raise exception 'expected one unrevoked invite after concurrent rotation';
      end if;
      if not exists (select 1 from public.table_invites where session_id = ${sqlLiteral(sessionId)} and token_hash in (${hashes})) then
        raise exception 'invite token hash did not match any returned token';
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'table_invites' and column_name = 'token') then
        raise exception 'raw invite token column must not exist';
      end if;
    end
    $assert$;
  `);

  const revoke = await rpc('revoke_table_invite', staff.token, { p_session_id: sessionId });
  assert.equal(revoke.status, 200, 'active staff can revoke the current invite');
  const revokeCheck = await rpc('revoke_table_invite', staff.token, { p_session_id: sessionId });
  assert.notEqual(revokeCheck.status, 200, 'revoking with no active invite is rejected');

  const sessionAfter = await rpc('issue_table_invite', staff.token, { p_session_id: sessionId, p_expires_in_seconds: 600 });
  assert.equal(sessionAfter.status, 200, 'replacement can be issued after explicit revocation');
  const oldTokenJoin = await rpc('join_table_session', anonymousToken, { p_invite_token: firstToken });
  assert.notEqual(oldTokenJoin.status, 200, 'rotated invite token cannot join');

  const inviteToInactiveTable = await rpc('issue_table_invite', staff.token, { p_session_id: randomUUID(), p_expires_in_seconds: 600 });
  assert.notEqual(inviteToInactiveTable.status, 200, 'unknown sessions cannot receive invites');
  console.log('Staff session management integration checks passed: verified identity, staff authorization, inactive table, concurrent single-session open, token issuance/hash storage, concurrent atomic rotation, revocation, and rejected old token.');
} finally {
  try { await cleanup(); } finally { rmSync(tempDir, { recursive: true, force: true }); }
}
