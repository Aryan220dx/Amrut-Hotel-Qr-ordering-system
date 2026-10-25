const NEXT_STATUS = Object.freeze({ placed: "preparing", preparing: "ready", ready: "served" });

export function nextOrderStatus(status) {
  return NEXT_STATUS[status] ?? null;
}

export function groupOrderItems(rows) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const current = grouped.get(row.order_id) ?? [];
    current.push(row);
    grouped.set(row.order_id, current);
  }
  return grouped;
}

export function formatOrderTotal(totalPaise) {
  const paise = Number(totalPaise);
  const rupees = Number.isFinite(paise) ? paise / 100 : 0;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(rupees);
}
