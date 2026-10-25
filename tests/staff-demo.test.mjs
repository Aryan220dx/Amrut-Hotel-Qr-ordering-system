import test from "node:test";
import assert from "node:assert/strict";
import { buildInviteLink, getInviteRow, getOpenedSessionId, parseDemoTableIds } from "../src/lib/staff-demo.mjs";

test("open_table_session response is a UUID scalar", () => {
  const sessionId = "272cab32-84ff-4b9a-9d32-4ae2c255d063";
  assert.equal(getOpenedSessionId(sessionId), sessionId);
  assert.throws(() => getOpenedSessionId(null), /No session ID returned/);
  assert.throws(() => getOpenedSessionId("not-a-uuid"), /No session ID returned/);
});

test("issue_table_invite response is a row with token and expiry", () => {
  const row = { invite_token: "a".repeat(43), expires_at: "2030-01-01T00:00:00Z" };
  assert.deepEqual(getInviteRow([row]), row);
  assert.throws(() => getInviteRow([]), /No invite returned/);
  assert.throws(() => getInviteRow([{ expires_at: row.expires_at }]), /No invite returned/);
  assert.throws(() => getInviteRow([{ invite_token: "short", expires_at: row.expires_at }]), /No invite returned/);
  assert.throws(() => getInviteRow([{ invite_token: row.invite_token, expires_at: "invalid" }]), /No invite returned/);
});

test("invite token appears only in the URL fragment", () => {
  const link = new URL(buildInviteLink("http://localhost:3000", "a".repeat(43)));

  assert.equal(link.pathname, "/join");
  assert.equal(link.search, "");
  assert.equal(link.hash, `#token=${"a".repeat(43)}`);
  assert.throws(() => buildInviteLink("http://localhost:3000", ""), /token is required/);
});

test("demo table configuration accepts only explicit UUIDs and supports selection", () => {
  assert.deepEqual(
    parseDemoTableIds("  272cab32-84ff-4b9a-9d32-4ae2c255d063, invalid, e0e8a811-08be-45f9-8345-545c19c1093f, 272cab32-84ff-4b9a-9d32-4ae2c255d063 "),
    ["272cab32-84ff-4b9a-9d32-4ae2c255d063", "e0e8a811-08be-45f9-8345-545c19c1093f"],
  );
  assert.deepEqual(parseDemoTableIds(""), []);
});
