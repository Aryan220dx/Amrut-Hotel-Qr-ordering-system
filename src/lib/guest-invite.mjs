const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidInviteToken(value) {
  return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value);
}

export function extractInviteToken(value, baseUrl) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  try {
    const url = new URL(trimmed, baseUrl);
    const queryToken = url.searchParams.get("token");
    const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const fragmentToken = new URLSearchParams(fragment).get("token") ?? fragment;
    const token = queryToken || fragmentToken;
    if (isValidInviteToken(token)) return token;
  } catch {
    // A pasted token is handled by the validation below.
  }

  return isValidInviteToken(trimmed) ? trimmed : null;
}

export function cleanInviteUrl(urlValue) {
  const url = new URL(urlValue);
  url.searchParams.delete("token");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

export function getJoinErrorMessage(code) {
  if (code === "42501") {
    return "Guest sign-in was rejected. Please start a fresh guest session and try again.";
  }
  if (code === "22023") {
    return "This invite is invalid or expired, or its table is no longer available. Ask staff for a fresh invite and try again.";
  }
  return "Could not join the table because the database request failed. Please retry.";
}
