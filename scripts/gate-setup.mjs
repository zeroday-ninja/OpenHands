/**
 * Walk somebody through the one step that cannot be done from this machine.
 *
 * An OAuth client belongs to a Google account, so creating it is theirs to
 * do. Everything around it is ours: which redirect URIs to register, exactly,
 * and whether the result actually works — asked of Google rather than
 * assumed, before anyone opens a browser and meets a wall of red.
 */

import { authorizeUrl, CALLBACK_PATH } from "./access-gate.mjs";
import { ADVICE, checkGoogleClient } from "./gate-client-check.mjs";
import { lanAddress } from "./gate-self-test.mjs";

export const CONSOLE_URL =
  "https://console.cloud.google.com/auth/clients/create";

/**
 * Every address the gate could be reached on, as redirect URIs to register.
 *
 * All of them, not just the one in use: Google matches the redirect URI
 * exactly, and a client registered for the LAN address alone fails the moment
 * somebody tries it from the machine it runs on. Registering a URI costs
 * nothing and leaving one out costs a confusing error.
 */
/**
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {string | null} [options.hostname]
 * @param {string | null} [options.lan]  This host's LAN address; read from
 *   the real interfaces when not given.
 * @returns {string[]}
 */
export function redirectUris({ host, port, hostname = null, lan = undefined }) {
  const addresses = [
    hostname,
    host,
    lan === undefined ? lanAddress() : lan,
    "127.0.0.1",
    "localhost",
  ];
  const seen = new Set();
  const uris = [];
  for (const address of addresses) {
    if (!address || address === "0.0.0.0" || seen.has(address)) continue;
    seen.add(address);
    const scheme = hostname && address === hostname ? "https" : "http";
    const authority = scheme === "https" ? address : `${address}:${port}`;
    uris.push(`${scheme}://${authority}${CALLBACK_PATH}`);
  }
  return uris;
}

/** The guidance, as lines, so a test can read it and a terminal can print it. */
/**
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {string | null} [options.hostname]
 * @param {string | null} [options.clientId]
 * @returns {string[]}
 */
export function setupLines({ host, port, hostname = null, clientId = null }) {
  const uris = redirectUris({ host, port, hostname });
  const lines = [
    "Create an OAuth client for the gate",
    "",
    `  1. Open ${CONSOLE_URL}`,
    '  2. Application type: "Web application".',
    "  3. Add every one of these as an Authorised redirect URI:",
    "",
    ...uris.map((uri) => `       ${uri}`),
    "",
    "  4. Copy the client id and secret into this shell:",
    "",
    "       export OH_GOOGLE_CLIENT_ID=...",
    "       export OH_GOOGLE_CLIENT_SECRET=...",
    "       export OH_GATE_ALLOWED_EMAILS=you@example.com",
    "",
    "  5. Run `oh-gate setup` again and it will ask Google whether that",
    "     client works here, before you open a browser.",
  ];
  if (!clientId) {
    lines.push(
      "",
      "No OH_GOOGLE_CLIENT_ID is set yet, so there is nothing to check.",
    );
  }
  return lines;
}

/**
 * Ask Google about the configured client, once there is one.
 *
 * Every registered URI is checked, not just the first: the redirect URI is
 * matched exactly, and the one that is missing from the client is precisely
 * the one nobody thought to try.
 */
/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.host
 * @param {number} options.port
 * @param {string | null} [options.hostname]
 * @param {string | null} [options.lan]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ ok: boolean, results: { redirectUri: string, code: string, ok: boolean, detail: string }[] }>}
 */
export async function checkEveryRedirect({
  clientId,
  host,
  port,
  hostname = null,
  lan = undefined,
  fetchImpl = fetch,
}) {
  const results = [];
  for (const redirectUri of redirectUris({ host, port, hostname, lan })) {
    const verdict = await checkGoogleClient({
      clientId,
      redirectUri,
      authorizeUrl,
      fetchImpl,
    });
    results.push({ redirectUri, ...verdict });
  }
  return { ok: results.every((result) => result.ok), results };
}

/** The check, as lines. */
export function checkLines({ ok, results }) {
  const lines = ["", "What Google says about this client:", ""];
  for (const result of results) {
    lines.push(`  ${result.ok ? "ok  " : "FAIL"}  ${result.redirectUri}`);
    if (!result.ok) lines.push(`          ${result.detail}`);
  }
  const codes = [...new Set(results.filter((r) => !r.ok).map((r) => r.code))];
  if (ok) {
    lines.push("", ADVICE.accepted);
  } else {
    lines.push("");
    for (const code of codes) lines.push(ADVICE[code] ?? ADVICE.refused);
  }
  return lines;
}
