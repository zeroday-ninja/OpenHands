// @vitest-environment node
/**
 * The one step that cannot be done from this machine, made as small as it can be.
 *
 * An OAuth client belongs to a Google account. Everything around it is ours:
 * which redirect URIs to register, and whether the client actually works —
 * asked of Google rather than assumed. These cases are the answers that have
 * to be told apart, because each one is a different thing to go and fix, and
 * a check that says only "it didn't work" is a check nobody is helped by.
 */
import { describe, expect, it } from "vitest";

import { authorizeUrl } from "../../scripts/access-gate.mjs";
import {
  ADVICE,
  authErrorReason,
  checkGoogleClient,
  verdictFor,
} from "../../scripts/gate-client-check.mjs";
import {
  checkEveryRedirect,
  checkLines,
  redirectUris,
  setupLines,
} from "../../scripts/gate-setup.mjs";

/** Google's error payload: base64 of a protobuf carrying readable strings. */
function authError(message: string): string {
  const body = Buffer.from(`\n\x0finvalid_request\x12${message}`, "latin1");
  return `https://accounts.google.com/signin/oauth/error?authError=${encodeURIComponent(
    body.toString("base64"),
  )}`;
}

function answering(location: string) {
  return async () =>
    new Response(null, { status: 302, headers: { location } }) as Response;
}

describe("reading what Google said", () => {
  it("decodes the reason out of an error redirect", () => {
    expect(
      authErrorReason(authError("The OAuth client was not found.")),
    ).toContain("OAuth client was not found");
  });

  it("treats a redirect with no error as Google being willing", () => {
    // As far as this can go without a person at the keyboard: Google is
    // prepared to show a sign-in page.
    expect(
      verdictFor({
        status: 302,
        location: "https://accounts.google.com/v3/signin",
      }),
    ).toMatchObject({ code: "accepted", ok: true });
  });

  it("tells the three failures apart, because each is a different fix", () => {
    const codes = [
      "The OAuth client was not found.",
      "redirect_uri_mismatch",
      "device_id and device_name are required for private IP",
    ].map(
      (message) =>
        verdictFor({ status: 302, location: authError(message) }).code,
    );

    expect(codes).toEqual([
      "unknown_client",
      "redirect_not_registered",
      "private_ip_needs_device",
    ]);
  });

  it("keeps a reason it does not recognise instead of dropping it", () => {
    // An answer nobody enumerated is still an answer, and flattening it to
    // "something went wrong" is the failure this whole check exists to avoid.
    const verdict = verdictFor({
      status: 302,
      location: authError("org_internal: this app is restricted"),
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("org_internal");
  });

  it("says so when Google cannot be reached at all", async () => {
    const verdict = await checkGoogleClient({
      clientId: "c",
      redirectUri: "http://192.168.1.1:8443/cb",
      authorizeUrl,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });

    expect(verdict.code).toBe("unreachable");
    expect(ADVICE.unreachable).toContain("outbound HTTPS");
  });
});

describe("which redirect URIs to register", () => {
  it("offers every address the gate can be reached on", () => {
    // All of them: Google matches the redirect URI exactly, so a client
    // registered for the LAN address alone fails the moment somebody tries it
    // from the machine it runs on.
    expect(
      redirectUris({ host: "0.0.0.0", port: 8443, lan: "192.168.1.9" }),
    ).toEqual([
      "http://192.168.1.9:8443/__oh/auth/callback",
      "http://127.0.0.1:8443/__oh/auth/callback",
      "http://localhost:8443/__oh/auth/callback",
    ]);
  });

  it("puts a public hostname first, and on https", () => {
    // The public bind is the one with a certificate, and the one Google will
    // insist on https for.
    const [first] = redirectUris({
      host: "0.0.0.0",
      port: 8443,
      hostname: "canvas.example.com",
      lan: "192.168.1.9",
    });

    expect(first).toBe("https://canvas.example.com/__oh/auth/callback");
  });

  it("does not offer the wildcard bind as an address", () => {
    // Nothing can be reached at 0.0.0.0, and registering it would be a URI
    // that silently never matches.
    expect(
      redirectUris({ host: "0.0.0.0", port: 8443, lan: null }).join(" "),
    ).not.toContain("0.0.0.0");
  });

  it("names the console and the exact variables to set", () => {
    const lines = setupLines({ host: "0.0.0.0", port: 8443 }).join("\n");

    expect(lines).toContain("console.cloud.google.com");
    expect(lines).toContain("OH_GOOGLE_CLIENT_ID");
    expect(lines).toContain("nothing to check");
  });
});

describe("checking the client that was created", () => {
  it("checks every registered URI, not just the first", async () => {
    // The one missing from the client is precisely the one nobody thought to
    // try, so a check that stops at the first success proves the least.
    const asked: string[] = [];
    const report = await checkEveryRedirect({
      clientId: "client-id",
      host: "0.0.0.0",
      port: 8443,
      lan: "192.168.1.9",
      fetchImpl: (async (input: RequestInfo | URL) => {
        asked.push(
          new URL(String(input)).searchParams.get("redirect_uri") ?? "",
        );
        return new Response(null, {
          status: 302,
          headers: { location: "https://accounts.google.com/v3/signin" },
        });
      }) as typeof fetch,
    });

    expect(report.ok).toBe(true);
    expect(asked).toHaveLength(3);
  });

  it("fails the whole check when one URI is unregistered", async () => {
    const report = await checkEveryRedirect({
      clientId: "client-id",
      host: "0.0.0.0",
      port: 8443,
      lan: "192.168.1.9",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const uri =
          new URL(String(input)).searchParams.get("redirect_uri") ?? "";
        return uri.includes("localhost")
          ? new Response(null, {
              status: 302,
              headers: { location: authError("redirect_uri_mismatch") },
            })
          : new Response(null, {
              status: 302,
              headers: { location: "https://accounts.google.com/v3/signin" },
            });
      }) as typeof fetch,
    });
    const lines = checkLines(report).join("\n");

    expect(report.ok).toBe(false);
    expect(lines).toContain("FAIL");
    expect(lines).toContain("localhost");
    // And it says what to do, naming the thing to change.
    expect(lines).toContain("Authorised redirect URIs");
  });
});
