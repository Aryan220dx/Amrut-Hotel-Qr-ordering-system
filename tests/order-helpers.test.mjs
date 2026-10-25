import test from "node:test";
import assert from "node:assert/strict";
import { getRpcRow, getOrderProgress } from "../src/lib/order-helpers.mjs";

test("getRpcRow reads the first row returned by a table-valued RPC", () => {
  const row = { order_id: "order-1", status: "placed" };

  assert.equal(getRpcRow([row]), row);
});

test("getRpcRow rejects a missing row instead of confirming a false success", () => {
  assert.throws(() => getRpcRow(null), /No order row returned/);
  assert.throws(() => getRpcRow([]), /No order row returned/);
});

test("getOrderProgress maps real order statuses to the tracking timeline", () => {
  assert.equal(getOrderProgress("placed"), 0);
  assert.equal(getOrderProgress("preparing"), 1);
  assert.equal(getOrderProgress("ready"), 2);
  assert.equal(getOrderProgress("served"), 3);
  assert.equal(getOrderProgress("cancelled"), -1);
  assert.equal(getOrderProgress("unknown"), -1);
});
