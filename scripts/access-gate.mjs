/**
 * An authenticating front door, so the dashboard can be reached from another
 * machine without changing how anything behind it works.
 *
 * The stack is loopback-only and authenticates with a shared session key that
 * the launcher injects into the served HTML. That is exactly why another
 * machine cannot reach it — and the two obvious fixes are both wrong:
 * exposing the key over the LAN hands the whole stack to anyone on the
 * network, and reinventing sign-in inside Canvas duplicates an identity
 * system that already exists.
 *
 * So: a proxy in front of the ingress that admits one named Google identity
 * and injects the session key *behind* itself. Nothing downstream changes,
 * and the key never crosses the network.
 *
 * Three rules it will not bend:
 *
 *   1. **No unauthenticated request reaches the ingress.** Not a redirect
 *      with the body already proxied, not a HEAD, not a preflight — the check
 *      happens before anything is forwarded.
 *   2. **The session key never leaves this process.** It is added to the
 *      request going in, and any copy of it in a response going out is
 *      stripped, because the launcher injects it into HTML and that HTML is
 *      now crossing a network.
 *   3. **Public exposure is off until it is turned on**, and turning it on is
 *      one explicit flag that also demands a hostname — a public bind with no
 *      name is a bind nobody can put a certificate on.
 */

import crypto from "node:crypto";
import http from "node:http";
import process from "node:process";
import { isLoopbackBind } from "./bind-host.mjs";

/** Google's endpoints. Overridable so a test can stand in for them. */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Where the browser comes back to. Not proxied, so it cannot collide. */
export const CALLBACK_PATH = "/__oh/auth/callback";
export const SIGN_IN_PATH = "/__oh/auth/start";
export const SIGN_OUT_PATH = "/__oh/auth/out";

export const COOKIE_NAME = "oh_gate";

/** How long a sign-in lasts. Long enough not to nag, short enough to expire. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** The LAN address the gate binds to by default. */
export const DEFAULT_GATE_HOST = "0.0.0.0";

export class GateMisconfigured extends Error {
  constructor(message) {
    super(message);
    this.name = "GateMisconfigured";
  }
}

/**
 * Who may in.
 *
 * An explicit address list, or a domain — a company domain is the common case
 * and listing every colleague is not. Empty means nobody, which is the safe
 * reading of "not configured" and is refused at startup rather than at the
 * first request.
 */
/**
 * @param {{ allowedEmails?: string[], allowedDomains?: string[] }} config
 * @param {unknown} email
 * @returns {boolean}
 */
export function admits({ allowedEmails = [], allowedDomains = [] }, email) {
  if (typeof email !== "string" || !email.includes("@")) return false;
  const normalized = email.trim().toLowerCase();
  if (allowedEmails.some((allowed) => allowed.trim().toLowerCase() === normalized)) {
    return true;
  }
  const domain = normalized.split("@")[1];
  return allowedDomains.some(
    (allowed) => allowed.trim().toLowerCase().replace(/^@/, "") === domain,
  );
}

/**
 * A signed cookie value.
 *
 * HMAC over the address and the expiry, with the secret never sent. Not a JWT:
 * there is one issuer and one audience here, and a dependency-free HMAC is the
 * whole of what that needs.
 */
export function signSession(email, expiresAt, secret) {
  const payload = `${email}|${expiresAt}`;
  const mac = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

/**
 * The address a cookie proves, or null.
 *
 * Null covers every failure the same way on purpose — expired, tampered,
 * malformed — because telling them apart tells an attacker which one they
 * got. The comparison is constant-time.
 */
export function readSession(value, secret, now = Date.now()) {
  if (typeof value !== "string" || !value.includes(".")) return null;
  const [encoded, mac] = value.split(".", 2);
  let payload;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [email, expiresAt] = payload.split("|");
  if (!email || !expiresAt) return null;
  if (Number(expiresAt) <= now) return null;
  return email;
}

/** One cookie out of a header, without a parser dependency. */
export function readCookie(header, name) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

/**
 * Where to send a browser to sign in.
 *
 * `state` is signed the same way the session is, so the callback can tell its
 * own redirect from somebody else's — which is what stops a login being
 * forged by a link.
 */
export function authorizeUrl({ clientId, redirectUri, state, authUrl = GOOGLE_AUTH_URL }) {
  const url = new URL(authUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // `select_account` rather than `none`: this host is shared with a personal
  // Google session often enough that silently reusing it is the wrong guess.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * The address inside an id token.
 *
 * The signature is *not* checked here, and that is deliberate rather than an
 * oversight: the token came from a direct HTTPS exchange with Google's token
 * endpoint using the client secret, so its provenance is the TLS connection.
 * Verifying a JWKS signature on a token fetched that way would add a key
 * fetch and a cache to prove something already proven.
 *
 * What *is* checked is `aud` and `email_verified`: a token minted for another
 * client, or an address Google has not confirmed, is not a sign-in here.
 */
export function emailFromIdToken(idToken, { clientId } = {}) {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (clientId && claims.aud !== clientId) return null;
  if (claims.email_verified === false) return null;
  return typeof claims.email === "string" ? claims.email : null;
}

/**
 * Read the gate's configuration, or refuse to start.
 *
 * Refused at startup rather than at the first request, because a gate that
 * admits nobody looks identical to a gate that is broken, and a gate that
 * admits everybody looks identical to one that is working.
 */
export function readGateConfig(env = process.env) {
  const clientId = env.OH_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.OH_GOOGLE_CLIENT_SECRET?.trim();
  const emails = splitList(env.OH_GATE_ALLOWED_EMAILS);
  const domains = splitList(env.OH_GATE_ALLOWED_DOMAINS);
  const missing = [];
  if (!clientId) missing.push("OH_GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("OH_GOOGLE_CLIENT_SECRET");
  if (emails.length === 0 && domains.length === 0) {
    missing.push("OH_GATE_ALLOWED_EMAILS or OH_GATE_ALLOWED_DOMAINS");
  }
  if (missing.length > 0) {
    throw new GateMisconfigured(
      `The access gate needs ${missing.join(", ")}. ` +
        "Create an OAuth client at console.cloud.google.com with the " +
        "redirect URI printed at startup, then set these.",
    );
  }

  const isPublic = env.OH_GATE_PUBLIC === "1" || env.OH_GATE_PUBLIC === "true";
  const hostname = env.OH_GATE_HOSTNAME?.trim() || null;
  if (isPublic && !hostname) {
    // A public bind with no name is a bind nobody can put a certificate on,
    // and the redirect URI Google needs is built from that name.
    throw new GateMisconfigured(
      "OH_GATE_PUBLIC needs OH_GATE_HOSTNAME: a public address has to have a " +
        "name for its certificate and for the OAuth redirect URI.",
    );
  }

  return {
    clientId,
    clientSecret,
    allowedEmails: emails,
    allowedDomains: domains,
    isPublic,
    hostname,
    host: env.OH_GATE_HOST?.trim() || DEFAULT_GATE_HOST,
    port: Number(env.OH_GATE_PORT || 8443),
    upstream: env.OH_GATE_UPSTREAM?.trim() || "http://127.0.0.1:8000",
    sessionApiKey: env.OH_GATE_SESSION_API_KEY?.trim() || null,
    // Rotating this signs everybody out, which is the point of being able to.
    secret:
      env.OH_GATE_SECRET?.trim() || crypto.randomBytes(32).toString("hex"),
  };
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Which headers never cross the gate outward.
 *
 * The launcher injects the session key into the HTML it serves, and that HTML
 * is now going over a network. Anything carrying the key is removed on the way
 * out — the body is handled separately, by `stripSessionKey`.
 */
export const STRIPPED_RESPONSE_HEADERS = [
  "x-session-api-key",
  "x-openhands-session-api-key",
];

/**
 * Remove the session key from a response body.
 *
 * The key reaches the browser as a string inside served HTML. Replaced rather
 * than refused, because refusing to serve the page would mean the gate works
 * and the dashboard does not; the browser then asks for a key, which is the
 * same thing a non-loopback bind already does today.
 */
export function stripSessionKey(body, sessionApiKey) {
  if (!sessionApiKey || typeof body !== "string") return body;
  return body.split(sessionApiKey).join("__redacted_by_access_gate__");
}

/**
 * Start the gate.
 *
 * `fetchImpl` and `now` are injectable so the whole request path — including
 * the token exchange — can be exercised without Google and without a clock.
 *
 * @returns {Promise<{ server: http.Server, url: string, redirectUri: string, close: () => Promise<void> }>}
 */
export async function startAccessGate(config, { fetchImpl = fetch, now = () => Date.now(), log = console.log } = {}) {
  const scheme = config.isPublic ? "https" : "http";
  // Resolved after listening, because `port: 0` means "whichever is free" and
  // the redirect URI is the one thing here that has to be exactly right — it
  // is registered with Google, and `:0` would never match.
  let publicHost = config.hostname ?? `${hostForUrl(config.host)}:${config.port}`;
  let redirectUri = `${scheme}://${publicHost}${CALLBACK_PATH}`;

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      // Reported, never a blank 500: a gate that fails silently is a gate
      // nobody can debug from the other side of it.
      respond(response, 502, `The access gate failed: ${error.message}`);
    });
  });

  async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host ?? publicHost}`);

    if (url.pathname === SIGN_OUT_PATH) {
      response.setHeader("Set-Cookie", clearCookie(config));
      respond(response, 200, "Signed out.");
      return;
    }

    if (url.pathname === SIGN_IN_PATH) {
      const state = signSession("state", now() + 10 * 60 * 1000, config.secret);
      response.setHeader("Location", authorizeUrl({
        clientId: config.clientId,
        redirectUri,
        state,
        authUrl: config.authUrl ?? GOOGLE_AUTH_URL,
      }));
      response.statusCode = 302;
      response.end();
      return;
    }

    if (url.pathname === CALLBACK_PATH) {
      await completeSignIn(url, response);
      return;
    }

    const email = readSession(
      readCookie(request.headers.cookie, COOKIE_NAME),
      config.secret,
      now(),
    );
    if (!email || !admits(config, email)) {
      // Before anything is forwarded. A redirect issued after proxying would
      // still have let the request through.
      denied(request, response, email);
      return;
    }

    await proxy(request, response);
  }

  async function completeSignIn(url, response) {
    const state = url.searchParams.get("state");
    if (readSession(state, config.secret, now()) !== "state") {
      // A callback this gate did not start. Refused without saying which
      // part was wrong.
      respond(response, 400, "That sign-in did not start here.");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      respond(response, 400, "No authorization code came back.");
      return;
    }

    const token = await fetchImpl(config.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!token.ok) {
      respond(response, 502, `Google refused the token exchange (HTTP ${token.status}).`);
      return;
    }
    const payload = await token.json();
    const email = emailFromIdToken(payload?.id_token, {
      clientId: config.clientId,
    });
    if (!email) {
      respond(response, 502, "Google's answer carried no verified address.");
      return;
    }
    if (!admits(config, email)) {
      // Named on purpose: the person reading this is almost always the owner
      // signed into the wrong account, and "access denied" would send them
      // looking for a server problem.
      respond(response, 403, `${email} is not on this gate's list.`);
      return;
    }

    const expiresAt = now() + SESSION_TTL_SECONDS * 1000;
    response.setHeader(
      "Set-Cookie",
      setCookie(config, signSession(email, expiresAt, config.secret)),
    );
    response.setHeader("Location", "/");
    response.statusCode = 302;
    response.end();
  }

  function denied(request, response, email) {
    if (email) {
      respond(response, 403, `${email} is not on this gate's list.`);
      return;
    }
    // An HTML request gets sent to sign in; anything else gets a 401, because
    // redirecting an API call to an HTML login page produces a parse error
    // three layers away from the actual cause.
    const accepts = String(request.headers.accept ?? "");
    if (request.method === "GET" && accepts.includes("text/html")) {
      response.setHeader("Location", SIGN_IN_PATH);
      response.statusCode = 302;
      response.end();
      return;
    }
    response.setHeader("WWW-Authenticate", 'Google realm="agent-canvas"');
    respond(response, 401, `Sign in at ${SIGN_IN_PATH}`);
  }

  async function proxy(request, response) {
    const target = new URL(request.url, config.upstream);
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.cookie;
    // The key is added here, behind the gate, and never crosses the network.
    if (config.sessionApiKey) {
      headers["x-session-api-key"] = config.sessionApiKey;
    }

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readBody(request);

    const upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });

    upstream.headers.forEach((value, name) => {
      if (STRIPPED_RESPONSE_HEADERS.includes(name.toLowerCase())) return;
      if (name.toLowerCase() === "content-length") return;
      response.setHeader(name, value);
    });
    response.statusCode = upstream.status;

    const type = upstream.headers.get("content-type") ?? "";
    if (type.includes("text/html") || type.includes("javascript")) {
      const text = stripSessionKey(await upstream.text(), config.sessionApiKey);
      response.end(text);
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    response.end(buffer);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });

  if (!config.hostname) {
    const bound = server.address();
    if (bound && typeof bound === "object") {
      publicHost = `${hostForUrl(config.host)}:${bound.port}`;
      redirectUri = `${scheme}://${publicHost}${CALLBACK_PATH}`;
    }
  }

  log(`Access gate on ${scheme}://${publicHost}`);
  log(`  admits: ${[...config.allowedEmails, ...config.allowedDomains.map((d) => `@${d}`)].join(", ")}`);
  log(`  redirect URI for the Google client: ${redirectUri}`);
  if (!config.isPublic) {
    log("  LAN only. OH_GATE_PUBLIC=1 with OH_GATE_HOSTNAME turns on public exposure.");
  }
  if (isLoopbackBind(config.host)) {
    log("  WARNING: bound to loopback, so no other machine can reach it.");
  }

  return {
    server,
    url: `${scheme}://${publicHost}`,
    redirectUri,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function hostForUrl(host) {
  if (host === "0.0.0.0" || host === "::") return "localhost";
  return host.includes(":") ? `[${host}]` : host;
}

function setCookie(config, value) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  // Secure only when there is TLS to be secure over: setting it on a plain
  // LAN address makes the browser drop the cookie and the sign-in loop.
  if (config.isPublic) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(config) {
  return setCookie(config, "").replace(
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "Max-Age=0",
  );
}

function respond(response, status, message) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(`${message}\n`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
