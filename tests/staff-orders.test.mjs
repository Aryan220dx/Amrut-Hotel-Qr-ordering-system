import test from "node:test";
import assert from "node:assert/strict";
import { nextOrderStatus, groupOrderItems, formatOrderTotal } from "../src/lib/staff-orders.mjs";

test("only valid forward order status actions are offered", () => {
  assert.equal(nextOrderStatus("placed"), "preparing");
  assert.equal(nextOrderStatus("preparing"), "ready");
  assert.equal(nextOrderStatus("ready"), "served");
  assert.equal(nextOrderStatus("served"), null);
  assert.equal(nextOrderStatus("cancelled"), null);
  assert.equal(nextOrderStatus("unknown"), null);
});

test("order items are grouped by order id without losing snapshot details", () => {
  const rows = [
    { id: "a", order_id: "order-1", quantity: 2, name_snapshot: "Poha" },
    { id: "b", order_id: "order-2", quantity: 1, name_snapshot: "Tea" },
  ];
  const grouped = groupOrderItems(rows);
  assert.deepEqual(grouped.get("order-1"), [rows[0]]);
  assert.deepEqual(grouped.get("order-2"), [rows[1]]);
});

test("totals are formatted from integer paise as INR", () => {
  assert.equal(formatOrderTotal(12550), "₹125.50");
  assert.equal(formatOrderTotal("0"), "₹0.00");
  assert.equal(formatOrderTotal("invalid"), "₹0.00");
});
