// @vitest-environment node
/**
 * The check that answers milestone 8, checked itself.
 *
 * `oh-gate --self-test` is how the claim "sign-in works and the dashboard is
 * reachable from your other machine" stops being an assertion. A diagnostic
 * that reports a pass it did not earn is worse than no diagnostic, so the
 * cases here are the ones where it must say *no*.
 *
 * Runs in the Node project: it stands up real servers on real sockets, and
 * under jsdom MSW answers its own `fetch` from the mock handlers.
 */
import http from "node:http";
import type os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SELF_TEST_OWNER,
  lanAddress,
  runGateSelfTest,
} from "../../scripts/gate-self-test.mjs";

const SESSION_KEY = "sk-this-must-never-leave";

describe("finding an address another machine could use", () => {
  it("skips loopback and the docker bridge", () => {
    // Docker's bridge is reachable from containers on this host and from
    // nothing else, so proving the gate on it would prove the wrong thing.
    expect(
      lanAddress({
        lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
        docker0: [{ family: "IPv4", address: "172.17.0.1", internal: false }],
        enp0: [{ family: "IPv4", address: "192.168.1.9", internal: false }],
      } as unknown as ReturnType<typeof os.networkInterfaces>),
    ).toBe("192.168.1.9");
  });

  it("answers null rather than falling back to loopback", () => {
    // A machine with no LAN address has nothing to test. Testing it on
    // loopback would report a pass for the one claim being checked.
    expect(
      lanAddress({
        lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
      } as unknown as ReturnType<typeof os.networkInterfaces>),
    ).toBeNull();
  });
});

describe("the gate self-test against a stack", () => {
  let upstream: http.Server;
  let upstreamUrl: string;
  let keysSeen: (string | undefined)[];

  beforeEach(async () => {
    keysSeen = [];
    upstream = http.createServer((request, response) => {
      keysSeen.push(request.headers["x-session-api-key"] as string | undefined);
      response.setHeader("Content-Type", "text/html");
      // The launcher injects the key into served HTML. Here is that HTML.
      response.end(`<html><script>window.KEY="${SESSION_KEY}"</script></html>`);
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("passes every check against a gate that is behaving", async () => {
    const report = await runGateSelfTest({
      upstream: upstreamUrl,
      sessionApiKey: SESSION_KEY,
      host: "127.0.0.1",
    });

    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    // The upstream was reached, and only with the key the gate holds.
    expect(keysSeen.length).toBeGreaterThan(0);
    expect(new Set(keysSeen)).toEqual(new Set([SESSION_KEY]));
  });

  it("fails the key check when the gate serves the key it is holding", async () => {
    // The failure the metric exists for: a body carrying the session key out
    // onto the network. Forced by telling the test a different key is secret,
    // so the stripping has nothing to match and the page goes out intact.
    const report = await runGateSelfTest({
      upstream: upstreamUrl,
      sessionApiKey: SESSION_KEY,
      host: "127.0.0.1",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await fetch(input as string, init);
        // Put the key back into the page the gate served to a signed-in
        // browser, as a gate that failed to strip it would. Keyed on the
        // cookie so the unauthenticated probes are left alone and this case
        // fails the one check it is about.
        const signedIn = Boolean(
          (init?.headers as Record<string, string> | undefined)?.cookie,
        );
        if (signedIn && response.status === 200) {
          return new Response(`<html>${SESSION_KEY}</html>`, {
            status: 200,
            headers: response.headers,
          });
        }
        return response;
      }) as typeof fetch,
    });

    const keyCheck = report.checks.find((check) =>
      check.name.includes("session key"),
    );
    expect(keyCheck?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("reports every check even after one fails", async () => {
    // A report that stops at the first failure hides whether the rest hold,
    // which is the whole reason to run it rather than read the code.
    const report = await runGateSelfTest({
      upstream: "http://127.0.0.1:1",
      sessionApiKey: SESSION_KEY,
      host: "127.0.0.1",
    });

    expect(report.ok).toBe(false);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
    expect(report.checks.some((check) => check.ok)).toBe(true);
  });

  it("names the address it tested, so a pass cannot be read as loopback", async () => {
    const report = await runGateSelfTest({
      upstream: upstreamUrl,
      sessionApiKey: SESSION_KEY,
      host: "127.0.0.1",
    });

    expect(report.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(SELF_TEST_OWNER).toContain("@");
  });
});
