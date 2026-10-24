/**
 * A map the terminal wrote is a map the canvas reads.
 *
 * `scripts/tui/map.mjs` edits the document's JSON directly — it cannot import
 * the app's TypeScript serializer, because it runs as a plain Node script with
 * no build step. That makes divergence the risk worth testing: the two could
 * drift on an id grammar, a tagged endpoint or a required field and nobody
 * would notice until a hand-edited map opened empty.
 *
 * So these assert the *contract* rather than the implementation: everything
 * written here goes back through `parseProjectMapDocument`, the same function
 * the app uses, and has to survive with no warnings.
 */

import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CONNECTOR_DASHES,
  CONNECTOR_HEADS,
  canvasOf,
  emptyCanvas,
  makeConnector,
  makeShape,
  nextFreeSpot,
  nextId,
  readMap,
  writeMap,
} from "../../scripts/tui/map.mjs";
import { parseProjectMap } from "#/utils/project-map/parse-project-map";
import { PROJECT_MAP_VERSION } from "#/types/project-map";

const BARE = {
  version: PROJECT_MAP_VERSION,
  generated_at: null,
  commit: null,
  groups: [],
  nodes: [],
  edges: [],
  notes: [],
};

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "oh-map-"));
  file = path.join(dir, ".openhands", "project-map.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(BARE, null, 2));
});

describe("what the terminal writes, the canvas reads", () => {
  it("writes shapes and a connector the app parses without a warning", async () => {
    const { document } = await readMap(file);
    const canvas = canvasOf(document);
    const first = makeShape(canvas.shapes, {
      kind: "box",
      text: "ingress",
      ...nextFreeSpot(canvas.shapes),
    });
    canvas.shapes = [...canvas.shapes, first];
    const second = makeShape(canvas.shapes, {
      kind: "diamond",
      text: "docker?",
      ...nextFreeSpot(canvas.shapes),
    });
    canvas.shapes = [...canvas.shapes, second];
    canvas.connectors = [
      makeConnector(canvas.connectors, first.id, second.id, "proxies /api"),
    ];
    await writeMap(file, document, canvas);

    // The app's own parser, over the raw text the terminal wrote.
    const parsed = parseProjectMap(await readFile(file, "utf8"));

    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    // A warning here is the drift this test exists to catch: an id the app
    // rejects, an endpoint it cannot read, a field it needs and did not get.
    expect(parsed.warnings).toEqual([]);
    const canvasBack = parsed.document.canvas;
    expect(canvasBack?.shapes).toHaveLength(2);
    expect(canvasBack?.shapes[0].text).toBe("ingress");
    expect(canvasBack?.connectors[0].label).toBe("proxies /api");
    expect(canvasBack?.connectors[0].from).toEqual({
      attach: "shape",
      shape: first.id,
      side: null,
    });
  });

  it("leaves the generated layer exactly as it found it", async () => {
    // The authored layer is a separate top-level key precisely because
    // regeneration owns the rest. A terminal edit that touched the rest would
    // be editing something it does not own.
    const before = JSON.parse(await readFile(file, "utf8"));
    const { document } = await readMap(file);
    const canvas = canvasOf(document);
    canvas.shapes = [
      makeShape([], { kind: "sticky", text: "note", x: 0, y: 0 }),
    ];
    await writeMap(file, document, canvas);

    const after = JSON.parse(await readFile(file, "utf8"));

    const { canvas: _ignored, ...rest } = after;
    expect(rest).toEqual(before);
  });

  it("numbers ids from the highest existing one, not from a clock", () => {
    // Two edits in the same second must not collide, and an id reused after a
    // deletion would merge two shapes' history in the ledger of a document.
    expect(nextId("shape", ["shape-1", "shape-z"])).toBe("shape-10");
    expect(nextId("shape", [])).toBe("shape-1");
    expect(nextId("shape", ["node-5", undefined as unknown as string])).toBe(
      "shape-1",
    );
  });

  it("refuses a kind the document has no grammar for", () => {
    expect(() => makeShape([], { kind: "hexagon", x: 0, y: 0 })).toThrow(
      /not a shape kind/,
    );
  });

  it("holds a shape to the editor's own minimum size", () => {
    const shape = makeShape([], {
      kind: "box",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    expect(shape.width).toBeGreaterThanOrEqual(40);
    expect(shape.height).toBeGreaterThanOrEqual(40);
  });

  it("treats a missing map as a fact rather than an error", async () => {
    const result = await readMap(path.join(dir, "nowhere.json"));

    expect(result.missing).toBe(true);
    expect(result.document).toBeNull();
  });

  it("refuses to overwrite a document it could not parse", async () => {
    // Overwriting would discard whatever is in there, which is the one
    // outcome a hand edit must not have.
    await writeFile(file, "{ not json");

    await expect(readMap(file)).rejects.toThrow(/Refusing to overwrite/);
  });

  it("stacks new shapes down the page rather than at the origin", () => {
    const first = makeShape([], { kind: "box", x: 0, y: 0 });
    const spot = nextFreeSpot([first]);

    expect(spot.y).toBeGreaterThan(first.y + first.height - 1);
  });

  it("starts an absent canvas as the app's own empty layer", async () => {
    const { document } = await readMap(file);

    expect(canvasOf(document)).toEqual(emptyCanvas());
  });
});

describe("the vocabularies this file restates", () => {
  it("matches the document's own, so a connector is never rejected on read", async () => {
    // These are copied rather than imported: `map.mjs` is plain Node with no
    // build step, so it cannot import the TypeScript constants. A copy that
    // drifts is a connector the canvas refuses — which is how "arrow" got
    // written here once and caught by the test above.
    const types = await import("#/types/project-map");

    expect(CONNECTOR_DASHES).toEqual([...types.PROJECT_MAP_CONNECTOR_DASHES]);
    expect(CONNECTOR_HEADS).toEqual([...types.PROJECT_MAP_CONNECTOR_HEADS]);
  });

  it("matches the shape kinds and the minimum size", async () => {
    const types = await import("#/types/project-map");
    const authoring = await import("#/utils/project-map/project-map-authoring");
    const { SHAPE_DEFAULTS, MIN_SIZE } =
      await import("../../scripts/tui/map.mjs");

    expect(Object.keys(SHAPE_DEFAULTS).sort()).toEqual(
      [...types.PROJECT_MAP_SHAPE_KINDS].sort(),
    );
    expect(SHAPE_DEFAULTS).toEqual(authoring.PROJECT_MAP_SHAPE_DEFAULT_SIZE);
    expect(MIN_SIZE).toBe(authoring.PROJECT_MAP_SHAPE_MIN_SIZE);
  });
});
