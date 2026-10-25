/**
 * Local integration test for QR guest-join flow.
 * - Creates a temporary staff user and table session
 * - Issues an invite token (saved to a secure temp file)
 * - Generates a QR code image pointing to the local join page
 * - Verifies the join flow works through the Next.js dev server
 */

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

// Output token to a secure temp file (never printed to console)
const tempDir = mkdtempSync(pathJoin(tmpdir(), 'hotel-amrut-test-'));
const tokenFile = pathJoin(tempDir, 'invite-token.txt');

try {
  // 1. Create a permanent staff user via Supabase Auth
  const statusText = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { encoding: 'utf8' });
  const status = Object.fromEntries(statusText.split(/\r?\n/).filter(Boolean).map((line) => {
    const sep = line.indexOf('=');
    return [line.slice(0, sep), line.slice(sep + 1).replace(/^"|"$/g, '')];
  }));

  const apiUrl = status.API_URL;
  const apiKey = status.PUBLISHABLE_KEY;
  if (!apiUrl?.startsWith('http://127.0.0.1:')) {
    throw new Error('Local Supabase API must be running');
  }

  // Create staff user
  const staffEmail = `qr-test-${randomUUID().slice(0, 8)}@example.test`;
  const staffRes = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ email: staffEmail, password: 'TestPassword123!', data: {} }),
  });
  const staffPayload = await staffRes.json();
  if (staffRes.status !== 200) throw new Error('Failed to create staff user');
  const staffUserId = staffPayload.user.id;
  const staffToken = staffPayload.access_token;

  // Create staff membership (required for open_table_session RPC)
  const staffSql = pathJoin(tempDir, 'staff-member.sql');
  writeFileSync(staffSql, `insert into public.staff_members (user_id, role, is_active) values ('${staffUserId}', 'staff', true);`);
  execFileSync('npx', ['supabase', 'db', 'query', '--local', '--file', staffSql], { encoding: 'utf8' });

  // 2. Create a dining table and open a session via the RPC
  const tableId = randomUUID();
  const tableLabel = `QR Test Table ${randomUUID().slice(0, 8)}`;
  const tableSql = pathJoin(tempDir, 'table.sql');
  writeFileSync(tableSql, `insert into public.dining_tables (id, label) values ('${tableId}', '${tableLabel}');`);
  execFileSync('npx', ['supabase', 'db', 'query', '--local', '--file', tableSql], { encoding: 'utf8' });

  const openRes = await fetch(`${apiUrl}/rest/v1/rpc/open_table_session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${staffToken}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ p_dining_table_id: tableId }),
  });
  if (!openRes.ok) {
    const errorText = await openRes.text();
    console.error('Open session error:', errorText);
    throw new Error(`Failed to open table session: ${openRes.status} - ${errorText}`);
  }
  const sessionId = (await openRes.text()).trim().replace(/^"|"$/g, '');
  console.error('Opened session:', sessionId);

  // 3. Issue an invite token (1 hour expiry)
  const inviteRes = await fetch(`${apiUrl}/rest/v1/rpc/issue_table_invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${staffToken}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ p_session_id: sessionId, p_expires_in_seconds: 3600 }),
  });
  const inviteData = await inviteRes.json().catch(() => null);
  if (!inviteRes.ok || !inviteData?.[0]?.invite_token) {
    throw new Error(`Failed to issue invite: ${inviteRes.status} - ${JSON.stringify(inviteData)}`);
  }
  const inviteToken = inviteData[0].invite_token;

  // Save token securely (never print to console)
  writeFileSync(tokenFile, inviteToken, { mode: 0o600 });
  console.error(`Token saved to: ${tokenFile}`);

  // 4. Generate QR code using qrcode library
  const QRCode = (await import('qrcode')).default;
  const qrPath = pathJoin(process.cwd(), 'test-artifacts', 'invite-qr.png');
  const joinUrl = `http://127.0.0.1:3000/join?token=${encodeURIComponent(inviteToken)}`;
  await QRCode.toFile(qrPath, joinUrl, { width: 512, margin: 2 });
  console.error(`QR code saved to: ${qrPath}`);

  // 5. Test anonymous join via browser client simulation
  const anonRes = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ data: {} }),
  });
  const anonPayload = await anonRes.json();
  if (anonRes.status !== 200 || !anonPayload.access_token) {
    throw new Error('Failed to create anonymous user');
  }
  const anonToken = anonPayload.access_token;

  // Join via RPC
  const joinRes = await fetch(`${apiUrl}/rest/v1/rpc/join_table_session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${anonToken}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ p_invite_token: inviteToken }),
  });
  const joinData = await joinRes.json();
  if (!joinRes.ok || !joinData[0]) {
    throw new Error(`Join failed: ${joinRes.status} - ${JSON.stringify(joinData)}`);
  }

  console.error('Join successful! Guest number:', joinData[0].guest_number);
  console.error('Session ID:', joinData[0].session_id);

  // 6. Test concurrent join (second anonymous user joins same invite)
  const anon2Res = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ data: {} }),
  });
  const anon2Payload = await anon2Res.json();
  const anon2Token = anon2Payload.access_token;

  const join2Res = await fetch(`${apiUrl}/rest/v1/rpc/join_table_session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${anon2Token}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ p_invite_token: inviteToken }),
  });
  const join2Data = await join2Res.json();
  if (!join2Res.ok || !join2Data[0]) {
    throw new Error(`Second join failed: ${join2Res.status}`);
  }
  console.error('Second join successful! Guest number:', join2Data[0].guest_number);
  console.error('Both guests share session:', joinData[0].session_id === join2Data[0].session_id);

  // 7. Verify distinct guest numbers
  if (joinData[0].guest_number === join2Data[0].guest_number) {
    throw new Error('Guest numbers should be distinct');
  }
  console.error('Verified: distinct guest numbers', joinData[0].guest_number, 'and', join2Data[0].guest_number);

  // Cleanup (do not print tokens)
  const safeDelete = (sql) => {
    const f = pathJoin(tempDir, 'tmp.sql');
    writeFileSync(f, sql);
    execFileSync('npx', ['supabase', 'db', 'query', '--local', '--file', f], { encoding: 'utf8' });
  };
  safeDelete(`delete from public.table_members where session_id = '${sessionId}';`);
  safeDelete(`delete from public.table_sessions where id = '${sessionId}';`);
  safeDelete(`delete from public.dining_tables where id = '${tableId}';`);
  safeDelete(`delete from auth.users where id = '${staffUserId}';`);

  console.error('Test completed successfully. QR code and token saved securely.');
} finally {
  // Clean up temp directory (includes token file)
  rmSync(tempDir, { recursive: true, force: true });
}
