/**
 * Prove the access gate on the address another machine would actually use.
 *
 * The gate's unit tests hold it to its rules against a stub upstream. This
 * drives the real one: the running stack, its real session key, a real socket
 * on this host's LAN address, and a real browser-shaped sign-in. The milestone
 * it answers is "sign-in works and the dashboard is reachable from your other
 * machine on the LAN", and the measure beside it is that no unauthenticated
 * request reaches the ingress and the key never appears in anything served.
 *
 * One thing is substituted and nothing else: who mints the identity token.
 * A real Google client belongs to a person's Google account and cannot be
 * created from here, so the issuer is a loopback stub that answers the way
 * Google's token endpoint answers. Everything the gate does with that answer
 * -- the state check, the audience check, the verified-address check, the
 * allow-list, the signed cookie, the key injection, the key stripping -- is
 * the production path, unmodified.
 *
 * The issuer is passed in code, never read from the environment. A gate that
 * could be pointed at another issuer by setting a variable would be a gate
 * anybody could forge an identity for, so this stays a diagnostic rather than
 * a configuration.
 */

import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";

import {
  CALLBACK_PATH,
  SIGN_IN_PATH,
  startAccessGate,
} from "./access-gate.mjs";

/** Addresses the self-test signs in as. Both are unroutable by design. */
export const SELF_TEST_OWNER = "owner@self-test.invalid";
export const SELF_TEST_STRANGER = "someone-else@self-test.invalid";

/**
 * This host's first non-loopback IPv4 address, or null if it has none.
 *
 * Docker's bridge is skipped: it is reachable from containers on this host
 * and from nothing else, so proving the gate on it would prove the wrong
 * thing. A machine with no LAN address at all is reported rather than
 * silently tested on loopback, which would make the one claim being checked
 * -- that another machine can reach it -- untested.
 */
export function lanAddress(interfaces = os.networkInterfaces()) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (name.startsWith("docker") || name.startsWith("br-")) continue;
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal)
        return address.address;
    }
  }
  return null;
}

/**
 * An issuer that answers the two requests the gate makes of Google.
 *
 * The authorization endpoint hands back the address to sign in as, inside the
 * code, so one issuer can serve both the owner and the stranger without
 * holding any state between them.
 */
async function startStubIssuer({ clientId }) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/authorize") {
      const email = url.searchParams.get("login_hint") || SELF_TEST_OWNER;
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", Buffer.from(email).toString("base64url"));
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.statusCode = 302;
      response.setHeader("Location", back.href);
      response.end();
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const code = new URLSearchParams(body).get("code") ?? "";
        const email = Buffer.from(code, "base64url").toString("utf8");
        const claims = { email, email_verified: true, aud: clientId };
        const payload = Buffer.from(JSON.stringify(claims)).toString(
          "base64url",
        );
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ id_token: `header.${payload}.signature` }),
        );
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    authUrl: `http://127.0.0.1:${port}/authorize`,
    tokenUrl: `http://127.0.0.1:${port}/token`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Walk the sign-in the way a browser does, and return the cookie it ends with. */
async function signIn(base, email, fetchImpl) {
  const start = await fetchImpl(`${base}${SIGN_IN_PATH}`, {
    redirect: "manual",
  });
  const authorize = new URL(start.headers.get("location"));
  // The address to sign in as rides along; a real provider would ask.
  authorize.searchParams.set("login_hint", email);
  const issued = await fetchImpl(authorize.href, { redirect: "manual" });
  const callback = issued.headers.get("location");
  const landed = await fetchImpl(callback, { redirect: "manual" });
  const cookie = (landed.headers.get("set-cookie") ?? "").split(";")[0];
  return { status: landed.status, cookie: cookie || null };
}

/**
 * Run the whole check, and say what passed and what did not.
 *
 * Every check is run even after one fails: the point of a report is to show
 * the shape of the failure, and stopping at the first one hides whether the
 * rest hold.
 */
/**
 * @param {object} options
 * @param {string} options.upstream       The running stack to sit in front of.
 * @param {string | null} options.sessionApiKey  The key the gate holds back.
 * @param {string} options.host           The address to bind and to probe.
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ ok: boolean, base: string, checks: { name: string, ok: boolean, detail: string }[] }>}
 */
export async function runGateSelfTest({
  upstream,
  sessionApiKey,
  host,
  fetchImpl = fetch,
}) {
  const clientId = "self-test-client";
  const issuer = await startStubIssuer({ clientId });
  const gate = await startAccessGate(
    {
      clientId,
      clientSecret: "self-test-secret",
      allowedEmails: [SELF_TEST_OWNER],
      allowedDomains: [],
      isPublic: false,
      hostname: null,
      host,
      port: 0,
      upstream,
      sessionApiKey,
      secret: crypto.randomBytes(32).toString("hex"),
      authUrl: issuer.authUrl,
      tokenUrl: issuer.tokenUrl,
    },
    { log: () => {}, fetchImpl },
  );

  const { port } = gate.server.address();
  const base = `http://${host}:${port}`;
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  try {
    // 1. Nothing unauthenticated gets through, on any method or path.
    const probes = [
      ["GET", "/"],
      ["GET", "/api/conversations"],
      ["GET", "/api/automation/v1"],
      ["HEAD", "/"],
      ["POST", "/api/conversations"],
      ["PUT", "/api/settings"],
      ["DELETE", "/api/conversations/1"],
      ["OPTIONS", "/api/conversations"],
    ];
    const got = [];
    for (const [method, path] of probes) {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        redirect: "manual",
      });
      got.push(`${method} ${path} -> ${response.status}`);
      if (sessionApiKey && (await response.text()).includes(sessionApiKey)) {
        got.push(`${method} ${path} SERVED THE KEY`);
      }
    }
    const letThrough = got.filter(
      (line) => !/-> (401|302)$/.test(line) || line.includes("SERVED"),
    );
    record(
      "no unauthenticated request is answered by the stack",
      letThrough.length === 0,
      letThrough.length === 0
        ? `${probes.length} probes, every one refused`
        : letThrough.join("; "),
    );

    // 2. A callback nobody started is refused.
    const forged = await fetchImpl(`${base}${CALLBACK_PATH}?code=x&state=y`, {
      redirect: "manual",
    });
    record(
      "a callback the gate did not start is refused",
      forged.status === 403 || forged.status === 400,
      `status ${forged.status}`,
    );

    // 3. The owner signs in.
    const owner = await signIn(base, SELF_TEST_OWNER, fetchImpl);
    record(
      "the allowed address signs in",
      Boolean(owner.cookie),
      owner.cookie
        ? "session cookie issued"
        : `no cookie (status ${owner.status})`,
    );

    // 4. Signed in, the dashboard loads from the LAN address.
    let page = null;
    if (owner.cookie) {
      const response = await fetchImpl(base, {
        headers: { cookie: owner.cookie, accept: "text/html" },
        redirect: "manual",
      });
      const body = await response.text();
      page = { status: response.status, body };
      record(
        "the dashboard loads over the LAN once signed in",
        response.status === 200 && body.length > 0,
        `status ${response.status}, ${body.length} bytes from ${base}`,
      );
      // 5. …and the key the gate is holding is not in what it served.
      record(
        "the session key is absent from what was served",
        !sessionApiKey || !body.includes(sessionApiKey),
        sessionApiKey
          ? "the served page does not carry the key"
          : "no key to strip",
      );
      // 6. …and the stack behind it did receive the key, or the page would
      //    not have been served at all by an authenticating ingress.
      const api = await fetchImpl(`${base}/api/automation/v1`, {
        headers: { cookie: owner.cookie },
        redirect: "manual",
      });
      record(
        "an API call reaches the stack with the key injected behind the gate",
        api.status === 200,
        `status ${api.status}`,
      );
    }

    // 7. A verified address that is not on the list is refused by name.
    const stranger = await signIn(base, SELF_TEST_STRANGER, fetchImpl);
    record(
      "a verified address that is not allowed is refused",
      !stranger.cookie && stranger.status === 403,
      `status ${stranger.status}${stranger.cookie ? ", ISSUED A COOKIE" : ""}`,
    );
  } finally {
    await gate.close();
    await issuer.close();
  }

  return { ok: checks.every((check) => check.ok), base, checks };
}
