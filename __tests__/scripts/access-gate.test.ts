/**
 * The front door, held to the three rules it must not bend.
 *
 * The metric this milestone is measured by is here: in a probe over every
 * method and path, no unauthenticated request reaches the ingress, and the
 * session key never appears in anything served. Both are asserted against a
 * real server on a real socket rather than against the functions in
 * isolation — the failure mode worth catching is a request that slips past
 * the check, which only a whole request path can show.
 */

import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CALLBACK_PATH,
  COOKIE_NAME,
  GateMisconfigured,
  SIGN_IN_PATH,
  admits,
  authorizeUrl,
  emailFromIdToken,
  readCookie,
  readGateConfig,
  readSession,
  signSession,
  startAccessGate,
  stripSessionKey,
} from "../../scripts/access-gate.mjs";

const SECRET = "test-secret";
const SESSION_KEY = "sk-this-must-never-be-served";
const OWNER = "owner@example.com";

function idToken(claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${body}.signature`;
}

describe("who the gate admits", () => {
  it("admits a named address and a whole domain", () => {
    const config = {
      allowedEmails: [OWNER],
      allowedDomains: ["company.test"],
    };

    expect(admits(config, OWNER)).toBe(true);
    expect(admits(config, "OWNER@EXAMPLE.COM")).toBe(true);
    expect(admits(config, "someone@company.test")).toBe(true);
    expect(admits(config, "someone@else.test")).toBe(false);
  });

  it("admits nobody when nothing is configured", () => {
    // The safe reading of "not configured": a gate that admits everybody
    // looks identical to one that is working.
    expect(admits({}, OWNER)).toBe(false);
  });

  it("refuses to start without a client and a list", () => {
    expect(() => readGateConfig({})).toThrow(GateMisconfigured);
    expect(() =>
      readGateConfig({
        OH_GOOGLE_CLIENT_ID: "id",
        OH_GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/ALLOWED_EMAILS/);
  });

  it("refuses a public bind with no name", () => {
    // A public address with no name is one nobody can put a certificate on,
    // and the OAuth redirect URI is built from that name.
    expect(() =>
      readGateConfig({
        OH_GOOGLE_CLIENT_ID: "id",
        OH_GOOGLE_CLIENT_SECRET: "secret",
        OH_GATE_ALLOWED_EMAILS: OWNER,
        OH_GATE_PUBLIC: "1",
      }),
    ).toThrow(/OH_GATE_HOSTNAME/);
  });

  it("defaults public exposure to off", () => {
    const config = readGateConfig({
      OH_GOOGLE_CLIENT_ID: "id",
      OH_GOOGLE_CLIENT_SECRET: "secret",
      OH_GATE_ALLOWED_DOMAINS: "company.test",
    });

    expect(config.isPublic).toBe(false);
  });
});

describe("the signed session", () => {
  it("proves an address and nothing else", () => {
    const value = signSession(OWNER, Date.now() + 1000, SECRET);

    expect(readSession(value, SECRET)).toBe(OWNER);
  });

  it("refuses a tampered, expired, or foreign cookie the same way", () => {
    // Telling them apart tells an attacker which one they got.
    const value = signSession(OWNER, Date.now() + 1000, SECRET);

    expect(readSession(value, "another-secret")).toBeNull();
    expect(readSession(`${value}x`, SECRET)).toBeNull();
    expect(
      readSession(signSession(OWNER, Date.now() - 1, SECRET), SECRET),
    ).toBeNull();
    expect(readSession("nonsense", SECRET)).toBeNull();
    expect(readSession(null as unknown as string, SECRET)).toBeNull();
  });

  it("reads one cookie out of a header without a parser", () => {
    expect(readCookie(`a=1; ${COOKIE_NAME}=value; b=2`, COOKIE_NAME)).toBe(
      "value",
    );
    expect(readCookie("a=1", COOKIE_NAME)).toBeNull();
    expect(readCookie(undefined as unknown as string, COOKIE_NAME)).toBeNull();
  });
});

describe("reading Google's answer", () => {
  it("takes the verified address out of an id token", () => {
    const token = idToken({
      email: OWNER,
      email_verified: true,
      aud: "client-id",
    });

    expect(emailFromIdToken(token, { clientId: "client-id" })).toBe(OWNER);
  });

  it("refuses a token minted for another client", () => {
    const token = idToken({ email: OWNER, aud: "someone-elses-client" });

    expect(emailFromIdToken(token, { clientId: "client-id" })).toBeNull();
  });

  it("refuses an address Google has not confirmed", () => {
    const token = idToken({
      email: OWNER,
      email_verified: false,
      aud: "client-id",
    });

    expect(emailFromIdToken(token, { clientId: "client-id" })).toBeNull();
  });

  it("names the device, because Google refuses a private IP without it", () => {
    // Found by asking Google. A LAN redirect URI without these two is:
    //
    //   invalid_request: device_id and device_name are required for
    //   private IP: http://192.168.4.60:8443/oh/callback
    //
    // which is the address another machine on the LAN actually uses — so the
    // sign-in could never have completed, with any client, however correctly
    // registered.
    const url = new URL(
      authorizeUrl({
        clientId: "client-id",
        redirectUri: "http://192.168.4.60:8443/cb",
        state: "state",
      }),
    );

    expect(url.searchParams.get("device_name")).toBeTruthy();
    expect(url.searchParams.get("device_id")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives one machine the same device id every time", () => {
    // Google wants it to identify the device, so a value that changed per
    // request would describe a new machine on every sign-in.
    const of = (redirectUri: string) =>
      new URL(
        authorizeUrl({ clientId: "c", redirectUri, state: "s" }),
      ).searchParams.get("device_id");

    expect(of("http://192.168.4.60:8443/cb")).toBe(
      of("http://192.168.4.60:9999/cb"),
    );
    expect(of("http://192.168.4.60:8443/cb")).not.toBe(
      of("http://192.168.4.61:8443/cb"),
    );
  });

  it("hashes the host into the device id rather than sending its name", () => {
    // The redirect URI has to carry the host — Google matches on it. The
    // device id does not, and it only needs to be the same one each time, so
    // it is a digest rather than a second copy of somebody's network layout.
    const deviceId = new URL(
      authorizeUrl({
        clientId: "client-id",
        redirectUri: "http://workshop-nas.lan:8443/cb",
        state: "state",
      }),
    ).searchParams.get("device_id");

    expect(deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceId).not.toContain("workshop");
  });

  it("asks for an account rather than silently reusing one", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "client-id",
        redirectUri: "http://host/cb",
        state: "state",
      }),
    );

    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")).toContain("email");
  });
});

describe("the session key never leaves", () => {
  it("is removed from a body that carries it", () => {
    const html = `<script>window.KEY="${SESSION_KEY}"</script>`;

    expect(stripSessionKey(html, SESSION_KEY)).not.toContain(SESSION_KEY);
  });

  it("leaves a body alone when there is no key to remove", () => {
    expect(stripSessionKey("<html></html>", null)).toBe("<html></html>");
  });
});

describe("a real gate in front of a real upstream", () => {
  let upstream: http.Server;
  let reached: { method: string; url: string; key: string | undefined }[];
  let gate: Awaited<ReturnType<typeof startAccessGate>>;
  let base: string;

  beforeEach(async () => {
    reached = [];
    upstream = http.createServer((request, response) => {
      reached.push({
        method: request.method ?? "?",
        url: request.url ?? "?",
        key: request.headers["x-session-api-key"] as string | undefined,
      });
      response.setHeader("Content-Type", "text/html");
      // The launcher injects the key into served HTML. Here is that HTML.
      response.end(`<html><script>window.KEY="${SESSION_KEY}"</script></html>`);
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const upstreamPort = (upstream.address() as { port: number }).port;

    gate = await startAccessGate(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        allowedEmails: [OWNER],
        allowedDomains: [],
        isPublic: false,
        hostname: null,
        host: "127.0.0.1",
        port: 0,
        upstream: `http://127.0.0.1:${upstreamPort}`,
        sessionApiKey: SESSION_KEY,
        secret: SECRET,
        tokenUrl: "http://token.invalid/token",
      },
      {
        log: () => {},
        fetchImpl: async (input: unknown, init?: RequestInit) => {
          const href = String(
            typeof input === "string" ? input : (input as URL).href,
          );
          if (href === "http://token.invalid/token") {
            return new Response(
              JSON.stringify({
                id_token: idToken({
                  email: OWNER,
                  email_verified: true,
                  aud: "client-id",
                }),
              }),
              { headers: { "Content-Type": "application/json" } },
            );
          }
          return fetch(input as string, init);
        },
      },
    );
    const port = (gate.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await gate.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("lets no unauthenticated request reach the ingress", async () => {
    // The metric. Every method, and paths that look like an API, a page and
    // a preflight — the failure worth catching is one that slips past.
    const probes = [
      ["GET", "/"],
      ["GET", "/api/conversations"],
      ["HEAD", "/"],
      ["POST", "/api/conversations"],
      ["PUT", "/api/settings"],
      ["PATCH", "/api/settings"],
      ["DELETE", "/api/conversations/x"],
      ["OPTIONS", "/api/conversations"],
      ["GET", "/../server_info"],
    ] as const;

    for (const [method, path] of probes) {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
      });
      expect([302, 401], `${method} ${path}`).toContain(response.status);
    }

    expect(reached).toEqual([]);
  });

  it("sends a browser to sign in and answers an API call with 401", async () => {
    const page = await fetch(base, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe(SIGN_IN_PATH);

    // Redirecting an API call to an HTML login page produces a parse error
    // three layers from the cause.
    const api = await fetch(`${base}/api/conversations`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toContain("Google");
  });

  it("refuses a callback it did not start", async () => {
    const response = await fetch(
      `${base}${CALLBACK_PATH}?code=x&state=forged`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(400);
    expect(reached).toEqual([]);
  });

  it("admits the owner after sign-in and injects the key behind itself", async () => {
    const state = signSession("state", Date.now() + 60_000, SECRET);
    const callback = await fetch(
      `${base}${CALLBACK_PATH}?code=good&state=${encodeURIComponent(state)}`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(302);
    const cookie = callback.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    // No TLS to be secure over on a LAN address; setting Secure would make
    // the browser drop the cookie and loop the sign-in.
    expect(cookie).not.toContain("Secure");

    const page = await fetch(base, {
      headers: { cookie: cookie.split(";")[0], accept: "text/html" },
    });
    const body = await page.text();

    expect(page.status).toBe(200);
    // Reached the ingress, with the key added behind the gate...
    expect(reached).toHaveLength(1);
    expect(reached[0].key).toBe(SESSION_KEY);
    // ...and not a trace of it in what crossed the network.
    expect(body).not.toContain(SESSION_KEY);
    expect(body).toContain("__redacted_by_access_gate__");
  });

  it("refuses somebody else's verified account, by name", async () => {
    const cookie = signSession(
      "stranger@else.test",
      Date.now() + 60_000,
      SECRET,
    );

    const response = await fetch(base, {
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}` },
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("stranger@else.test");
    expect(reached).toEqual([]);
  });
});
