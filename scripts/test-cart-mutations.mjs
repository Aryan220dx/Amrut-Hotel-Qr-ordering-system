/**
 * Integration test for add_to_cart RPC.
 * Tests valid additions, invalid items, unauthorized callers, cross-session access,
 * quantity validation, and concurrent mutations.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomUUID } from 'node:crypto';

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
const tableIds = Array.from({ length: 3 }, randomUUID);
const sessionIds = [randomUUID(), randomUUID(), randomUUID()];
const itemIds = Array.from({ length: 3 }, randomUUID);
const memberIds = [];
const tempDir = mkdtempSync(pathJoin(tmpdir(), 'hotel-amrut-cart-'));
const sqlFile = pathJoin(tempDir, 'fixture.sql');
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

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

async function createAnonymousUser() {
  const response = await request('/auth/v1/signup', { body: { data: {} } });
  assert.equal(response.status, 200, 'anonymous Auth sign-in should succeed locally');
  assert.equal(response.payload.user?.is_anonymous, true, 'Auth should identify this as an anonymous user');
  assert.ok(response.payload.access_token, 'Auth should return a verified access token');
  memberIds.push(response.payload.user.id);
  return { id: response.payload.user.id, token: response.payload.access_token };
}

async function rpc(name, token, body) {
  return request(`/rest/v1/rpc/${name}`, { token, body });
}

function runSql(sql) {
  writeFileSync(sqlFile, sql, { mode: 0o600 });
  runCli(['db', 'query', '--local', '--file', sqlFile]);
}

async function seed() {
  // Create dining tables
  const tableRows = tableIds.map((id, i) =>
    `(${sqlLiteral(id)}, ${sqlLiteral(`Cart Test Table ${i + 1}-${randomUUID().slice(0, 8)}`)})`
  ).join(',\n');

  // Create sessions (all open)
  const sessionRows = sessionIds.map((id, i) =>
    `(${sqlLiteral(id)}, ${sqlLiteral(tableIds[i])}, 'open', null)`
  ).join(',\n');

  // Create members
  const members = await Promise.all([createAnonymousUser(), createAnonymousUser(), createAnonymousUser()]);
  const memberRows = members.map((m, i) =>
    `(${sqlLiteral(randomUUID())}, ${sqlLiteral(sessionIds[0])}, ${sqlLiteral(m.id)}, ${i + 1}, ${sqlLiteral(`Guest ${i + 1}`)}, now())`
  ).join(',\n');

  // Create menu items (published and available)
  const itemRows = itemIds.map((id, i) =>
    `(${sqlLiteral(id)}, ${sqlLiteral(`ITEM-${i + 1}-${randomUUID().slice(0, 8)}`)}, ${sqlLiteral('Test')}, ${sqlLiteral(`Test Item ${i + 1}`)}, '', ${10000 * (i + 1)}, 1, true, true, now())`
  ).join(',\n');

  // Execute each insert separately to avoid "cannot insert multiple commands" error
  const tableSql = `insert into public.dining_tables (id, label) values ${tableRows};`;
  const sessionSql = `insert into public.table_sessions (id, dining_table_id, status, closed_at) values ${sessionRows};`;
  const memberSql = `insert into public.table_members (id, session_id, user_id, guest_number, display_label, joined_at) values ${memberRows};`;
  const itemSql = `insert into public.menu_items (id, item_code, category, name, description, base_price_paise, price_version, is_published, is_available, updated_at) values ${itemRows};`;

  const tempSqlFiles = [
    { sql: tableSql, name: 'tables.sql' },
    { sql: sessionSql, name: 'sessions.sql' },
    { sql: memberSql, name: 'members.sql' },
    { sql: itemSql, name: 'items.sql' },
  ];

  for (const file of tempSqlFiles) {
    const filePath = pathJoin(tempDir, file.name);
    writeFileSync(filePath, file.sql);
    execFileSync('npx', ['supabase', 'db', 'query', '--local', '--file', filePath], { encoding: 'utf8' });
  }
}

async function cleanup() {
  // Clean up by known IDs - use session_id for table_members since we know sessionIds[0]
  const queries = [
    `delete from public.cart_lines where session_id in (${sessionIds.map(sqlLiteral).join(', ')});`,
    `delete from public.cart_batches where session_id in (${sessionIds.map(sqlLiteral).join(', ')});`,
    `delete from public.table_members where session_id in (${sessionIds.map(sqlLiteral).join(', ')});`,
    `delete from public.table_sessions where id in (${sessionIds.map(sqlLiteral).join(', ')});`,
    `delete from public.dining_tables where id in (${tableIds.map(sqlLiteral).join(', ')});`,
    `delete from public.menu_items where id in (${itemIds.map(sqlLiteral).join(', ')});`,
  ];
  for (const q of queries) {
    writeFileSync(sqlFile, q, { mode: 0o600 });
    execFileSync('npx', ['supabase', 'db', 'query', '--local', '--file', sqlFile], { encoding: 'utf8' });
  }
}

let didSeed = false;
try {
  await seed();
  didSeed = true;

  const [guest1, guest2, guest3] = await Promise.all([
    createAnonymousUser(),
    createAnonymousUser(),
    createAnonymousUser(),
  ]);

  // Insert test guests into table_members for the test session
  // Use guest numbers 4,5,6 to avoid conflict with seeded members (1,2,3)
  const testGuestSql = `
    insert into public.table_members (id, session_id, user_id, guest_number, display_label, joined_at) values
    (${sqlLiteral(randomUUID())}, ${sqlLiteral(sessionIds[0])}, ${sqlLiteral(guest1.id)}, 4, ${sqlLiteral('Test Guest 1')}, now()),
    (${sqlLiteral(randomUUID())}, ${sqlLiteral(sessionIds[0])}, ${sqlLiteral(guest2.id)}, 5, ${sqlLiteral('Test Guest 2')}, now()),
    (${sqlLiteral(randomUUID())}, ${sqlLiteral(sessionIds[0])}, ${sqlLiteral(guest3.id)}, 6, ${sqlLiteral('Test Guest 3')}, now());
  `;
  writeFileSync(sqlFile, testGuestSql, { mode: 0o600 });
  execFileSync('npx', ['supabase', 'db', 'query', '--local', '--file', sqlFile], { encoding: 'utf8' });

  // Test 1: Valid add to cart
  console.error('Test 1: Valid add to cart');
  const add1 = await rpc('add_to_cart', guest1.token, {
    p_session_id: sessionIds[0],
    p_menu_item_id: itemIds[0],
    p_quantity: 2,
    p_option_selections: {},
  });
  console.error(`Add to cart response: status=${add1.status}, payload=${JSON.stringify(add1.payload)}`);
  assert.ok(add1.status === 200, `Valid add should succeed, got status ${add1.status}`);
  assert.ok(add1.payload[0]?.cart_line_id, 'Should return cart_line_id');
  assert.equal(add1.payload[0]?.quantity, 2, 'Quantity should match');
  assert.equal(add1.payload[0]?.unit_price_paise, 10000, 'Price should come from menu item');
  console.error('  PASS');

  // Test 2: Another guest adds same item
  console.error('Test 2: Another guest adds same item to shared cart');
  const add2 = await rpc('add_to_cart', guest2.token, {
    p_session_id: sessionIds[0],
    p_menu_item_id: itemIds[0],
    p_quantity: 1,
    p_option_selections: {},
  });
  assert.ok(add2.status === 200, 'Second guest add should succeed');
  console.error('  PASS - both guests can add to shared cart');

  // Test 3: Invalid item ID
  console.error('Test 3: Invalid item ID rejected');
  const invalidItem = await rpc('add_to_cart', guest1.token, {
    p_session_id: sessionIds[0],
    p_menu_item_id: randomUUID(),
    p_quantity: 1,
    p_option_selections: {},
  });
  assert.ok(invalidItem.status !== 200, 'Invalid item should be rejected');
  console.error('  PASS');

  // Test 4: Cross-session access
  console.error('Test 4: Cross-session access rejected');
  const crossSession = await rpc('add_to_cart', guest1.token, {
    p_session_id: sessionIds[1],
    p_menu_item_id: itemIds[0],
    p_quantity: 1,
    p_option_selections: {},
  });
  assert.ok(crossSession.status !== 200, 'Cross-session should be rejected');
  console.error('  PASS');

  // Test 5: Quantity validation
  console.error('Test 5: Quantity validation');
  const overQty = await rpc('add_to_cart', guest1.token, {
    p_session_id: sessionIds[0],
    p_menu_item_id: itemIds[0],
    p_quantity: 100,
    p_option_selections: {},
  });
  assert.ok(overQty.status !== 200, 'Quantity > 99 should be rejected');
  const underQty = await rpc('add_to_cart', guest1.token, {
    p_session_id: sessionIds[0],
    p_menu_item_id: itemIds[0],
    p_quantity: 0,
    p_option_selections: {},
  });
  assert.ok(underQty.status !== 200, 'Quantity = 0 should be rejected');
  console.error('  PASS');

  // Test 6: Unauthenticated access
  console.error('Test 6: Unauthenticated access rejected');
  const unauth = await rpc('add_to_cart', null, {
    p_session_id: sessionIds[0],
    p_menu_item_id: itemIds[0],
    p_quantity: 1,
    p_option_selections: {},
  });
  assert.ok(unauth.status === 401 || unauth.status === 403, 'Unauthenticated should be rejected');
  console.error('  PASS');

  // Test 7: Concurrent additions
  console.error('Test 7: Concurrent additions');
  const concurrent = await Promise.all([
    rpc('add_to_cart', guest1.token, { p_session_id: sessionIds[0], p_menu_item_id: itemIds[1], p_quantity: 1, p_option_selections: {} }),
    rpc('add_to_cart', guest2.token, { p_session_id: sessionIds[0], p_menu_item_id: itemIds[1], p_quantity: 1, p_option_selections: {} }),
    rpc('add_to_cart', guest3.token, { p_session_id: sessionIds[0], p_menu_item_id: itemIds[1], p_quantity: 1, p_option_selections: {} }),
  ]);
  for (const result of concurrent) {
    assert.ok(result.status === 200, 'Concurrent adds should succeed');
  }
  console.error('  PASS - all concurrent additions succeeded');

  console.error('\nCart mutation integration checks passed.');
} finally {
  if (didSeed) await cleanup();
  rmSync(tempDir, { recursive: true, force: true });
}
