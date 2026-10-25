import test from "node:test";
import assert from "node:assert/strict";
import { createSingleFlight } from "../src/lib/order-helpers.mjs";

test("coalesces overlapping refreshes and reruns once with the latest session", async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstRequest = new Promise((resolve) => { releaseFirst = resolve; });
  const refresh = createSingleFlight(async (sessionId) => {
    calls.push(sessionId);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls.length === 1) await firstRequest;
    active -= 1;
  });

  const first = refresh("session-a");
  await Promise.resolve();
  const second = refresh("session-b");
  const third = refresh("session-b");
  releaseFirst();
  await Promise.all([first, second, third]);

  assert.deepEqual(calls, ["session-a", "session-b"]);
  assert.equal(maxActive, 1);
});
