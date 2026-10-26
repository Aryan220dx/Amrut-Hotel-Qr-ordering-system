import test from "node:test";
import assert from "node:assert/strict";
import { getJoinViewMode } from "../src/lib/join-view-state.mjs";

test("an invite token shows the name form until joining fails", () => {
  assert.equal(getJoinViewMode(null, "valid-invite-token"), "name");
  assert.equal(getJoinViewMode("The invite expired.", "valid-invite-token"), "error");
  assert.equal(getJoinViewMode(null, null), "invite");
});
