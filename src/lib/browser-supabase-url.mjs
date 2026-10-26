const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * @param {string} configuredUrl
 * @param {string} browserOrigin
 */
export function resolveBrowserSupabaseUrl(configuredUrl, browserOrigin) {
  const url = new URL(configuredUrl);
  if (!browserOrigin) return url.toString();

  const browser = new URL(browserOrigin);
  const configuredHost = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const browserHost = browser.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (LOOPBACK_HOSTS.has(configuredHost) && !LOOPBACK_HOSTS.has(browserHost)) {
    url.hostname = browser.hostname;
  }

  return url.toString();
}
