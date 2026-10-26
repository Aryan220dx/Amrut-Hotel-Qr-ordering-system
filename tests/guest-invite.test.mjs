import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanInviteUrl,
  extractInviteToken,
  getJoinRpcCompatibilityAction,
  getJoinErrorMessage,
  isValidInviteToken,
} from "../src/lib/guest-invite.mjs";

const token = "a".repeat(43);
const baseUrl = "https://demo.example";

test("invite links support the staff fragment format and legacy query links", () => {
  assert.equal(extractInviteToken(`/join#token=${token}`, baseUrl), token);
  assert.equal(extractInviteToken(`/join?token=${token}&source=qr`, baseUrl), token);
  assert.equal(extractInviteToken(`/join#${token}`, baseUrl), token);
  assert.equal(extractInviteToken(token, baseUrl), token);
});

test("invite extraction rejects malformed tokens and unrelated URLs", () => {
  assert.equal(isValidInviteToken(token), true);
  assert.equal(isValidInviteToken(`${token}x`), false);
  assert.equal(extractInviteToken("/join#token=short", baseUrl), null);
  assert.equal(extractInviteToken("https://demo.example/join", baseUrl), null);
});

test("cleaning an invite URL removes token query and fragment before navigation", () => {
  assert.equal(
    cleanInviteUrl(`https://demo.example/join?source=qr&token=${token}#token=${token}`),
    "/join?source=qr",
  );
});

test("join errors give guests a recovery action without exposing database internals", () => {
  assert.match(getJoinErrorMessage("22023"), /Ask staff for a fresh invite/);
  assert.doesNotMatch(getJoinErrorMessage("22023"), /console|22023|database rejected/i);
  assert.match(getJoinErrorMessage("42501"), /fresh guest session/);
  assert.match(getJoinErrorMessage("other"), /Please retry/);
});

test("legacy join fallback is limited to the missing PostgREST signature and unnamed guests", () => {
  assert.equal(getJoinRpcCompatibilityAction("PGRST202", ""), "legacy");
  assert.equal(getJoinRpcCompatibilityAction("PGRST202", "Asha"), "name-unsupported");
  assert.equal(getJoinRpcCompatibilityAction("42704", ""), null);
  assert.match(getJoinErrorMessage("PGRST202"), /join without a name/i);
});
