/** @typedef {"placed" | "preparing" | "ready" | "served" | "cancelled"} OrderStatus */
/** @typedef {"one" | "equal" | "items"} PaymentMode */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_MODES = new Set(["one", "equal", "items"]);

/** @template {(...args: any[]) => Promise<any>} T @param {T} run */
export function createSingleFlight(run) {
  /** @type {Promise<Awaited<ReturnType<T>>> | null} */
  let inFlight = null;
  let queued = false;
  /** @type {Parameters<T>} */
  let latestArgs;

  return (...args) => {
    latestArgs = args;
    queued = true;
    if (inFlight) return inFlight;

    const request = (async () => {
      /** @type {Awaited<ReturnType<T>>} */
      let result;
      while (queued) {
        queued = false;
        result = await run(...latestArgs);
      }
      return result;
    })();
    inFlight = request.finally(() => { inFlight = null; });
    return inFlight;
  };
}

/** @param {string} value */
function isUuid(value) {
  return UUID_PATTERN.test(value);
}

/** @param {string} sessionId @param {PaymentMode} paymentMode @param {string} guestNote @param {string} idempotencyKey */
export function createPendingSubmission(sessionId, paymentMode, guestNote, idempotencyKey) {
  if (!isUuid(sessionId)) throw new Error("A valid table session is required.");
  if (!PAYMENT_MODES.has(paymentMode)) throw new Error("Invalid payment mode.");
  if (!isUuid(idempotencyKey)) throw new Error("A valid idempotency key is required.");
  if (typeof guestNote !== "string" || guestNote.length > 500) throw new Error("Guest note must be 500 characters or fewer.");

  return { sessionId, paymentMode, guestNote: guestNote.trim(), idempotencyKey };
}

/** @param {string | null} serialized @param {string} expectedSessionId */
export function parsePendingSubmission(serialized, expectedSessionId) {
  if (typeof serialized !== "string" || !isUuid(expectedSessionId)) return null;
  try {
    const value = JSON.parse(serialized);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.sessionId !== expectedSessionId || !isUuid(value.sessionId)) return null;
    if (!PAYMENT_MODES.has(value.paymentMode)) return null;
    if (typeof value.guestNote !== "string" || value.guestNote.length > 500) return null;
    if (!isUuid(value.idempotencyKey)) return null;
    return {
      sessionId: value.sessionId,
      paymentMode: /** @type {PaymentMode} */ (value.paymentMode),
      guestNote: value.guestNote,
      idempotencyKey: value.idempotencyKey,
    };
  } catch {
    return null;
  }
}

/** @param {string} search */
export function getOrderIdFromSearch(search) {
  const orderId = new URLSearchParams(search).get("order");
  return orderId && isUuid(orderId) ? orderId : null;
}

/** @param {string} orderId */
export function orderTrackingPath(orderId) {
  return isUuid(orderId) ? `/?order=${encodeURIComponent(orderId)}` : null;
}

/** @template {{}} T @param {unknown} data @returns {T} */
export function getRpcRow(data) {
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error("No order row returned");
  }
  return data[0];
}

/** @param {string} status */
export function getOrderProgress(status) {
  return ({ placed: 0, preparing: 1, ready: 2, served: 3 })[status] ?? -1;
}
