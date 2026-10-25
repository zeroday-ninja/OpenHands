import { expect, test } from "@playwright/test";

/**
 * What two hundred drawn shapes cost on a pointer move.
 *
 * Milestone 1's metric: *"pointer-move handling stays inside one frame at 200
 * shapes"*. The canvas used to resolve a node's rectangle by linear search,
 * twice per edge, on every render — including every move of a drag — and that
 * is now an index built once per render. A number is the only thing that
 * settles whether it was enough, and it has to come from a real browser: jsdom
 * has no layout and no compositor, so a timing assertion there measures jsdom.
 *
 * Gated behind `RUN_PROJECT_MAP_DRAG_PERF=1`, like the markdown render
 * measurement, because a wall-clock assertion on a shared CI runner is a
 * flake generator. Run it deliberately, on an idle machine:
 *
 *     RUN_PROJECT_MAP_DRAG_PERF=1 npx playwright test \
 *       tests/e2e/project-map-drag-performance.spec.ts --project=chromium
 *
 * It needs a dev server that is **not** `dev:mock`: the map arrives through
 * the file-download route, and mock mode answers that from a service worker,
 * which a page route cannot intercept. `npm run dev`, `npm run dev:minimal`
 * or a built frontend served by `scripts/static-server.mjs` all work.
 */

const RUN = process.env.RUN_PROJECT_MAP_DRAG_PERF === "1";

/** One animation frame at 60Hz, which is the budget the metric names. */
const FRAME_MS = 1000 / 60;

const SHAPES = 200;
const MOVES = 40;

/** A grid of drawn shapes, every one of them on the paper. */
const mapOf = (shapeCount: number) => ({
  version: 1,
  commit: "perf0000",
  groups: [],
  nodes: [],
  edges: [],
  notes: [],
  canvas: {
    view: { mode: "both", layout: "free", layer: "code" },
    connectors: [],
    shapes: Array.from({ length: shapeCount }, (_, index) => ({
      id: `shape-perf${index}`,
      kind: "box",
      text: `box ${index}`,
      x: (index % 20) * 140,
      y: Math.floor(index / 20) * 110,
      width: 120,
      height: 80,
      accent: String(index % 6),
      parent: null,
      anchor: null,
      pinned: false,
      collapsed: false,
      tags: [],
    })),
  },
});

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

test.describe("the drawn layer at two hundred shapes", () => {
  test.skip(!RUN, "wall-clock measurement; set RUN_PROJECT_MAP_DRAG_PERF=1");

  // Tall enough that the canvas has a box of its own below the page's other
  // panels. A canvas squeezed to no height would still measure, and would
  // measure nothing: the drag is picked by where the pointer lands on it.
  test.use({ viewport: { width: 1440, height: 1600 } });

  test("a pointer move during a drag stays inside one frame", async ({
    page,
  }) => {
    // Onboarding and the consent prompt both cover the page on a first
    // visit, and the backend step cannot be skipped. Seeded the same way the
    // other browser specs in this directory do it.
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
    // The map arrives the way the page really loads it. `dev:mock` has no
    // handler for the download route, so the request reaches the network and
    // this answers it — which also means the measurement exercises the real
    // read, parse and hydrate path rather than a seam around it.
    await page.route("**/file/download**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mapOf(SHAPES)),
      });
    });

    await page.goto("/map");

    // A newly shipped feature introduces itself over the page. "Later" is
    // what a reader does when they came to do something else.
    const later = page.getByTestId("feature-announcement-later");
    if (await later.isVisible().catch(() => false)) await later.click();

    // The route is lazily imported, so the store module — and the seam on it
    // — arrives after the document load event.
    await page.waitForSelector('[data-testid="project-map-page"]', {
      timeout: 30_000,
    });

    // The canvas is lazily imported, so it mounts a tick or two after the
    // document reaches the store.
    await page.waitForSelector('[data-testid="project-map-canvas"]', {
      timeout: 30_000,
    });
    await page.waitForSelector(
      `[data-testid="project-map-shape-shape-perf${SHAPES - 1}"]`,
    );

    const measured = await page.evaluate(
      async ({ moveCount }) => {
        const raf = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );

        const canvas = document.querySelector(
          '[data-testid="project-map-canvas"]',
        ) as SVGSVGElement;
        // The shape's own group, not its text or its resize handles, which
        // carry testids with the same prefix.
        const drawn = document.querySelectorAll(
          '[data-testid^="project-map-shape-shape-perf"]',
        ).length;

        const box = canvas.getBoundingClientRect();
        const start = { x: box.left + 70, y: box.top + 50 };
        const send = (type: string, x: number, y: number) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              clientX: x,
              clientY: y,
              buttons: type === "pointerup" ? 0 : 1,
              button: 0,
            }),
          );

        // Press on a shape and move it: the drag path rebuilds the rectangle
        // index and re-renders every shape on each move, which is the work the
        // metric is about.
        send("pointerdown", start.x, start.y);
        await raf();

        const frames: number[] = [];
        for (let move = 1; move <= moveCount; move += 1) {
          const before = performance.now();
          send("pointermove", start.x + move * 3, start.y + move * 2);
          // One frame boundary, so the measurement includes the commit the move
          // caused rather than only the handler that scheduled it.
          await raf();
          frames.push(performance.now() - before);
        }
        send("pointerup", start.x + moveCount * 3, start.y + moveCount * 2);

        return { frames, drawn };
      },
      { moveCount: MOVES },
    );

    const sorted = [...measured.frames].sort((a, b) => a - b);
    const at = (fraction: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    const dropped = measured.frames.filter((ms) => ms > FRAME_MS * 1.5).length;

    // Reported either way: a measurement nobody can read is not evidence.
    console.log(
      `drawn=${measured.drawn} p50=${median(measured.frames).toFixed(1)} ` +
        `p90=${at(0.9).toFixed(1)} p95=${at(0.95).toFixed(1)} ` +
        `max=${Math.max(...measured.frames).toFixed(1)} dropped=${dropped}/${MOVES}`,
    );

    expect(measured.drawn).toBe(SHAPES);
    // The tail, not the median: the median is quantised to the frame the
    // work lands in, so it reads as one frame whether the work took two
    // milliseconds or sixteen. What a dropped frame looks like is the 95th
    // percentile crossing into the next frame.
    expect(at(0.95)).toBeLessThan(FRAME_MS * 2);
    expect(dropped).toBeLessThanOrEqual(1);
  });
});
