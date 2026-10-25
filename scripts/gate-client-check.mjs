/**
 * Ask Google whether an OAuth client would actually work here, before anyone
 * opens a browser.
 *
 * Creating the client is the one step that cannot be done from this machine —
 * it belongs to a Google account. What *can* be done is to check the result
 * the moment it exists, against the real endpoint, so the failures that
 * normally surface as a wall of red in a browser surface here instead with
 * the reason.
 *
 * Google answers the authorization endpoint with a redirect to its own error
 * page carrying a base64 `authError`, which decodes to a short reason. That
 * is what this reads. No credentials are sent: the client secret is not part
 * of this request, and no sign-in is started.
 */

const AUTH_ERROR_PATTERNS = [
  [/device_id and device_name are required/i, "private_ip_needs_device"],
  [/OAuth client was not found/i, "unknown_client"],
  [
    /redirect_uri_mismatch|does not match the ones authorized/i,
    "redirect_not_registered",
  ],
  [
    /access_blocked|has not completed the Google verification/i,
    "unverified_app",
  ],
];

/** The reason inside Google's `authError`, decoded, or null if there is none. */
export function authErrorReason(location) {
  if (typeof location !== "string") return null;
  const match = /[?&]authError=([^&]+)/.exec(location);
  if (!match) return null;
  try {
    const raw = Buffer.from(decodeURIComponent(match[1]), "base64").toString(
      "latin1",
    );
    // A protobuf carrying printable strings. The readable runs are the
    // message; reading them beats depending on the wire format of an
    // undocumented error payload.
    const text = (raw.match(/[\x20-\x7e]{6,}/g) ?? []).join(" ");
    return text || null;
  } catch {
    return null;
  }
}

/** What Google's answer means, as something a person can act on. */
export function verdictFor({ status, location }) {
  const reason = authErrorReason(location);
  if (!reason) {
    // No error payload: Google is willing to show a sign-in page, which is
    // as far as this can go without a person at the keyboard.
    return {
      code: "accepted",
      ok: true,
      detail: "Google accepted the client and the redirect URI.",
    };
  }
  for (const [pattern, code] of AUTH_ERROR_PATTERNS) {
    if (pattern.test(reason)) return { code, ok: false, detail: reason };
  }
  return { code: "refused", ok: false, detail: reason };
}

/** What to do about each verdict, in the words of the thing to go and fix. */
export const ADVICE = {
  accepted:
    "Nothing to fix. Start the gate and sign in from the other machine.",
  unknown_client:
    "Google does not recognise this client id. Check OH_GOOGLE_CLIENT_ID " +
    "against the one in the console, including the .apps.googleusercontent.com " +
    "suffix.",
  redirect_not_registered:
    "The client exists, but this redirect URI is not on its list. Add the " +
    "URI printed above to the client's Authorised redirect URIs, exactly, " +
    "including the port.",
  private_ip_needs_device:
    "Google refuses a private-IP redirect without device_id and device_name. " +
    "This build sends both, so seeing this means an older gate is running.",
  unverified_app:
    "The client works but the app is unverified, so Google blocks accounts " +
    "that are not test users. Add the address to the OAuth consent screen's " +
    "test users, or keep the app internal to a Workspace.",
  refused: "Google refused the request; the reason it gave is above.",
  unreachable:
    "Could not reach Google to ask. This check needs outbound HTTPS; the " +
    "gate itself needs it too.",
};

/**
 * Ask Google about one client and one redirect URI.
 *
 * @returns {Promise<{ code: string, ok: boolean, detail: string }>}
 */
/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.redirectUri
 * @param {(args: { clientId: string, redirectUri: string, state: string }) => string} options.authorizeUrl
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function checkGoogleClient({
  clientId,
  redirectUri,
  authorizeUrl,
  fetchImpl = fetch,
}) {
  const url = authorizeUrl({
    clientId,
    redirectUri,
    state: "preflight",
  });
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual" });
  } catch (error) {
    return {
      code: "unreachable",
      ok: false,
      detail: `${error?.name ?? "Error"}: ${error?.message ?? error}`,
    };
  }
  return verdictFor({
    status: response.status,
    location: response.headers.get("location") ?? "",
  });
}
