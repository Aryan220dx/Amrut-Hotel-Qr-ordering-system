import test from "node:test";
import assert from "node:assert/strict";
import {
  createPendingSubmission,
  getOrderIdFromSearch,
  orderTrackingPath,
  parsePendingSubmission,
} from "../src/lib/order-helpers.mjs";

const sessionId = "63000000-0000-0000-0000-000000000001";
const idempotencyKey = "67000000-0000-0000-0000-000000000001";

test("pending order submission preserves the same logical request across reloads", () => {
  const pending = createPendingSubmission(sessionId, "equal", "  no onions  ", idempotencyKey);

  assert.deepEqual(parsePendingSubmission(JSON.stringify(pending), sessionId), {
    sessionId,
    paymentMode: "equal",
    guestNote: "no onions",
    idempotencyKey,
  });
});

test("pending submissions cannot be replayed for another table session", () => {
  const pending = createPendingSubmission(sessionId, "one", "", idempotencyKey);

  assert.equal(parsePendingSubmission(JSON.stringify(pending), "63000000-0000-0000-0000-000000000002"), null);
  assert.equal(parsePendingSubmission("not-json", sessionId), null);
});

test("invalid pending submission fields are rejected", () => {
  assert.throws(() => createPendingSubmission("bad-session", "one", "", idempotencyKey), /session/i);
  assert.throws(() => createPendingSubmission(sessionId, "cash", "", idempotencyKey), /payment mode/i);
  assert.throws(() => createPendingSubmission(sessionId, "one", "", "bad-key"), /idempotency/i);
  assert.equal(parsePendingSubmission(JSON.stringify({
    sessionId,
    paymentMode: "one",
    guestNote: "x".repeat(501),
    idempotencyKey,
  }), sessionId), null);
});

test("order links accept only UUID identifiers and survive page refresh", () => {
  const orderId = "71000000-0000-0000-0000-000000000001";

  assert.equal(orderTrackingPath(orderId), `/?order=${orderId}`);
  assert.equal(getOrderIdFromSearch(`?order=${orderId}`), orderId);
  assert.equal(getOrderIdFromSearch("?order=javascript%3Aalert(1)"), null);
  assert.equal(orderTrackingPath("not-an-id"), null);
});
