const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inviteTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function getOpenedSessionId(data) {
  if (typeof data !== "string" || !uuidPattern.test(data)) {
    throw new Error("No session ID returned by open_table_session.");
  }
  return data;
}

export function getInviteRow(data) {
  const row = Array.isArray(data) ? data[0] : null;
  if (
    !row ||
    typeof row.invite_token !== "string" ||
    !inviteTokenPattern.test(row.invite_token) ||
    typeof row.expires_at !== "string" ||
    Number.isNaN(Date.parse(row.expires_at))
  ) {
    throw new Error("No invite returned by issue_table_invite.");
  }
  return row;
}

export function buildInviteLink(origin, token, lanOrigin) {
  if (!token) throw new Error("An invite token is required.");
  const inviteOrigin = new URL(origin);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(inviteOrigin.hostname.replace(/^\[|\]$/g, "").toLowerCase());
  const targetOrigin = isLoopback && lanOrigin ? new URL(lanOrigin).origin : inviteOrigin.origin;
  const url = new URL("/join", targetOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function parseDemoTableIds(value) {
  if (!value) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter((id) => uuidPattern.test(id)))];
}
