import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const runCli = (args, options = {}) => execFileSync('npx', ['supabase', ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...options,
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

const fixtureId = randomUUID();
const tableIds = Array.from({ length: 4 }, randomUUID);
const sessionIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const tokens = Array.from({ length: 4 }, () => randomBytes(32).toString('base64url'));
const tempDir = mkdtempSync(pathJoin(tmpdir(), 'hotel-amrut-join-'));
const sqlFile = pathJoin(tempDir, 'fixture.sql');
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlUuidArray = (values) => values.map(sqlLiteral).join(', ');
const identityIds = [];

async function request(path, { token, body } = {}) {
  const headers = { apikey: apiKey };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createAnonymousUser() {
  const response = await request('/auth/v1/signup', { body: { data: {} } });
  const payload = await response.json();
  assert.equal(response.status, 200, 'anonymous Auth sign-in should succeed locally');
  assert.equal(payload.user?.is_anonymous, true, 'Auth should identify this as an anonymous user');
  assert.ok(payload.access_token, 'Auth should return a verified access token');
  identityIds.push(payload.user.id);
  return payload.access_token;
}

async function join(accessToken, inviteToken) {
  const response = await request('/rest/v1/rpc/join_table_session', {
    token: accessToken,
    body: { p_invite_token: inviteToken },
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function seedFixtures() {
  const validSession = sessionIds[0];
  const expiredSession = sessionIds[1];
  const revokedSession = sessionIds[2];
  const closedSession = sessionIds[3];
  const inviteRows = [
    [validSession, tokens[0], "now() + interval '1 hour'", 'null'],
    [expiredSession, tokens[1], "now() - interval '1 minute'", 'null'],
    [revokedSession, tokens[2], "now() + interval '1 hour'", 'now()'],
    [closedSession, tokens[3], "now() + interval '1 hour'", 'null'],
  ].map(([sessionId, token, expiry, revoked]) => `(${sqlLiteral(sessionId)}, extensions.digest(convert_to(${sqlLiteral(token)}, 'UTF8'), 'sha256'), ${expiry}, ${revoked})`).join(',\n');

  const tableRows = tableIds.map((id, index) => `(${sqlLiteral(id)}, ${sqlLiteral(`Join ${fixtureId.slice(0, 8)} ${index + 1}`)})`).join(',\n');
  const sessionRows = sessionIds.map((id, index) => `(${sqlLiteral(id)}, ${sqlLiteral(tableIds[index])}, '${index === 3 ? 'closed' : 'open'}', ${index === 3 ? 'now()' : 'null'})`).join(',\n');
  const sql = `
    do $fixture$
    begin
    insert into public.dining_tables (id, label) values ${tableRows};
    insert into public.table_sessions (id, dining_table_id, status, closed_at) values ${sessionRows};
    insert into public.table_invites (session_id, token_hash, expires_at, revoked_at) values ${inviteRows};
    end
    $fixture$;
  `;
  writeFileSync(sqlFile, sql, { mode: 0o600 });
  runCli(['db', 'query', '--local', '--file', sqlFile]);
}

async function cleanup() {
  const authCleanup = identityIds.length
    ? `delete from auth.users where id in (${sqlUuidArray(identityIds)});`
    : '';
  const sql = `
    do $cleanup$
    begin
    delete from public.table_sessions where id in (${sqlUuidArray(sessionIds)});
    delete from public.dining_tables where id in (${sqlUuidArray(tableIds)});
    ${authCleanup}
    end
    $cleanup$;
  `;
  writeFileSync(sqlFile, sql, { mode: 0o600 });
  runCli(['db', 'query', '--local', '--file', sqlFile]);
}

let didSeed = false;
try {
  await seedFixtures();
  didSeed = true;

  const anonTokens = await Promise.all(Array.from({ length: 4 }, createAnonymousUser));
  const parallelResults = await Promise.all(anonTokens.flatMap((accessToken) => [
    join(accessToken, tokens[0]),
    join(accessToken, tokens[0]),
  ]));
  for (const result of parallelResults) {
    assert.equal(result.status, 200, 'valid invite requests should succeed');
    assert.equal(result.payload.length, 1, 'join response should contain one minimal membership result');
  }

  const assignedGuestNumbers = new Set();
  for (let index = 0; index < anonTokens.length; index += 1) {
    const first = parallelResults[index * 2].payload[0];
    const retry = parallelResults[index * 2 + 1].payload[0];
    assert.deepEqual(retry, first, 'parallel retries by one user should be idempotent');
    assert.equal(first.session_id, sessionIds[0]);
    assert.equal(first.display_label, `Guest ${first.guest_number}`);
    assignedGuestNumbers.add(first.guest_number);
  }
  assert.deepEqual([...assignedGuestNumbers].sort((a, b) => a - b), [1, 2, 3, 4], 'concurrent users should receive unique guest numbers');

  const invalidResponse = await join(anonTokens[0], 'malformed');
  assert.equal(invalidResponse.status, 400, 'malformed invite should be rejected');
  assert.equal(invalidResponse.payload.message, 'invalid or expired table invite', 'invite failures should not disclose which check failed');

  const unauthenticated = await request('/rest/v1/rpc/join_table_session', { body: { p_invite_token: tokens[0] } });
  assert.ok(unauthenticated.status === 401 || unauthenticated.status === 403, 'unauthenticated RPC should be denied');

  for (const [index, label] of [[1, 'expired'], [2, 'revoked'], [3, 'closed-session']]) {
    const result = await join(anonTokens[0], tokens[index]);
    assert.equal(result.status, 400, `${label} invite should be rejected`);
    assert.equal(result.payload.message, 'invalid or expired table invite', `${label} failure should be generic`);
  }

  console.log('Guest invite integration checks passed: anonymous Auth, membership, retry, concurrent numbering, malformed/expired/revoked/closed invites, and unauthenticated denial.');
} finally {
  if (didSeed) await cleanup();
  rmSync(tempDir, { recursive: true, force: true });
}
