import { expect, test } from "@playwright/test";

/**
 * How often the work layer asks, while work is in flight and while it is not.
 *
 * Milestone 3's metric: *"at most one request per backend per five seconds
 * while work is in flight and zero when idle, measured in the network log"*.
 * Measured in the network log, which means a real browser: the interval is
 * decided by React Query from the `in_flight` count in each response, and the
 * only honest check of "zero when idle" is to watch for a while and count.
 *
 * Gated behind `RUN_WORK_GRAPH_POLL_BUDGET=1`, like the other wall-clock
 * measurements here, and for the same reason. It needs a dev server that is
 * not `dev:mock`: the fixtures arrive through page routes, and mock mode
 * answers from a service worker that a page route cannot intercept.
 *
 *     RUN_WORK_GRAPH_POLL_BUDGET=1 npx playwright test \
 *       tests/e2e/work-graph-polling-budget.spec.ts --project=chromium
 */

const RUN = process.env.RUN_WORK_GRAPH_POLL_BUDGET === "1";

/** The interval the hook schedules while a deployment reports work. */
const POLL_MS = 5000;

/** Long enough for several ticks, short enough to stay a test. */
const WATCH_MS = 16_000;

/** A map whose canvas opens on the work layer, so the hook is enabled. */
const WORK_LAYER_MAP = {
  version: 1,
  commit: "poll0000",
  groups: [],
  nodes: [],
  edges: [],
  notes: [],
  canvas: {
    view: { mode: "both", layout: "free", layer: "work" },
    shapes: [],
    connectors: [],
  },
};

const graphWith = (inFlight: number) => ({
  nodes: [
    {
      key: "automation:poll",
      kind: "program",
      label: "Polling budget",
      status: inFlight > 0 ? "in_flight" : "done",
      attrs: {},
    },
  ],
  edges: [],
  omissions: [],
  in_flight: inFlight,
});

test.describe("what the work layer costs while nobody is working", () => {
  test.skip(!RUN, "wall-clock measurement; set RUN_WORK_GRAPH_POLL_BUDGET=1");

  test("asks while work is in flight, and stops when it is not", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("analytics-consent", "false");
      window.localStorage.setItem("openhands-telemetry-consent", "denied");
      window.localStorage.setItem("openhands-telemetry-first-use", "true");
      window.localStorage.setItem("openhands-onboarded", "1");
      window.localStorage.setItem(
        "openhands-backends",
        JSON.stringify([
          {
            id: "default-local",
            name: "Local",
            host: window.location.origin,
            apiKey: "",
            kind: "local",
          },
        ]),
      );
      window.localStorage.setItem(
        "openhands-active-backend",
        JSON.stringify({ backendId: "default-local", orgId: null }),
      );
    });

    await page.route("**/file/download**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(WORK_LAYER_MAP),
      });
    });

    // One source of in-flight truth, flipped between the two watches.
    let inFlight = 1;
    const asked: number[] = [];
    await page.route("**/v1/work-graph*", async (route) => {
      asked.push(Date.now());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(graphWith(inFlight)),
      });
    });

    await page.goto("/map");
    await page.waitForSelector('[data-testid="project-map-canvas"]', {
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-testid]").length > 0,
    );

    // --- while work is in flight -----------------------------------------
    asked.length = 0;
    const busyFrom = Date.now();
    await page.waitForTimeout(WATCH_MS);
    const busy = asked.length;
    const busyElapsed = Date.now() - busyFrom;

    // --- and once it is not ----------------------------------------------
    inFlight = 0;
    // One tick to deliver the idle answer, then watch.
    await page.waitForTimeout(POLL_MS + 1500);
    asked.length = 0;
    await page.waitForTimeout(WATCH_MS);
    const idle = asked.length;

    const allowed = Math.ceil(busyElapsed / POLL_MS) + 1;
    console.log(
      `busy=${busy} in ${busyElapsed}ms (allowed ${allowed}) idle=${idle}`,
    );

    // At least polling at all, or the measurement is of a broken page.
    expect(busy).toBeGreaterThan(1);
    // One request per backend per five seconds, with one tick of slack for
    // the boundary the watch started on.
    expect(busy).toBeLessThanOrEqual(allowed);
    // And nothing at all once the deployment says it is done.
    expect(idle).toBe(0);
  });
});
