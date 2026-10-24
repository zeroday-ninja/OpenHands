/**
 * Authoring the map's drawn layer without a browser.
 *
 * Not "drawing in a terminal" — the freeform editor is a pointer surface and
 * pretending otherwise would be worse than saying so. What this does is the
 * other half: the drawn layer is a committed document, so adding a box,
 * labelling it, and connecting two of them are ordinary edits to JSON, and a
 * terminal can make them — scriptably, which the pointer surface cannot.
 *
 * The invariants are the document's, not this file's, so they are restated
 * here rather than re-derived:
 *
 *   - the authored layer lives under a top-level `canvas` key, because the
 *     generated layer is owned by regeneration and authored content cannot
 *     live under that rule;
 *   - ids are `shape-<base36>` and `conn-<base36>`, numbered from the highest
 *     existing id rather than from a clock, so two edits in the same second
 *     cannot collide;
 *   - an endpoint is tagged, so the JSON says what it attaches to instead of
 *     leaving a reader to infer it from which fields are present.
 *
 * `__tests__/scripts/map-cli.test.ts` holds this to the app's own parser: a
 * document written here must be one the canvas reads back unchanged.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where a workspace keeps its map. */
export const MAP_RELATIVE_PATH = path.join(".openhands", "project-map.json");

/** The kinds a shape can be, and what size it gets when unspecified. */
export const SHAPE_DEFAULTS = {
  box: { width: 180, height: 64 },
  diamond: { width: 160, height: 96 },
  sticky: { width: 140, height: 140 },
  frame: { width: 420, height: 280 },
  branch: { width: 200, height: 48 },
};

/** Smallest a shape may be, matching the editor's own floor. */
export const MIN_SIZE = 40;

/** The document's own vocabularies. Anything else is rejected on read. */
export const CONNECTOR_DASHES = ["solid", "dashed", "dotted"];
export const CONNECTOR_HEADS = ["none", "open", "filled", "diamond"];

/**
 * The next id in a prefix's sequence.
 *
 * Counted from the highest existing id rather than from a clock, which is
 * what makes two edits in the same second produce different ids.
 */
export function nextId(prefix, existing) {
  let highest = 0;
  for (const id of existing) {
    if (typeof id !== "string" || !id.startsWith(`${prefix}-`)) continue;
    const parsed = Number.parseInt(id.slice(prefix.length + 1), 36);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return `${prefix}-${(highest + 1).toString(36)}`;
}

/** An empty authored layer, as the app writes one. */
export function emptyCanvas() {
  return { view: { mode: "both", layout: "tree" }, shapes: [], connectors: [] };
}

/**
 * Read a map document, or say what is wrong with it.
 *
 * A missing file is not an error — a workspace with no map is a workspace
 * nobody has analysed yet, and the first `oh map add` should still work. A
 * file that exists and cannot be parsed *is* an error, because overwriting it
 * would discard whatever is in there.
 */
export async function readMap(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { document: null, missing: true };
    throw error;
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${file} is not readable JSON (${error.message}). Refusing to ` +
        "overwrite it: whatever is in there would be lost.",
    );
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${file} is not a map document.`);
  }
  return { document, missing: false };
}

/** The authored layer of a document, created if absent. */
export function canvasOf(document) {
  const canvas = document.canvas;
  if (!canvas || typeof canvas !== "object") return emptyCanvas();
  return {
    view: canvas.view ?? emptyCanvas().view,
    shapes: Array.isArray(canvas.shapes) ? canvas.shapes : [],
    connectors: Array.isArray(canvas.connectors) ? canvas.connectors : [],
  };
}

/**
 * A new shape, in the grammar the app's own factory produces.
 *
 * @param {{id?: string}[]} shapes  Existing shapes, for the id sequence.
 * @param {object} options
 * @param {string} options.kind
 * @param {number} options.x
 * @param {number} options.y
 * @param {string} [options.text]
 * @param {number} [options.width]
 * @param {number} [options.height]
 */
export function makeShape(shapes, { kind, text, x, y, width, height }) {
  const fallback = SHAPE_DEFAULTS[kind];
  if (!fallback) {
    throw new Error(
      `${kind} is not a shape kind; expected one of ${Object.keys(SHAPE_DEFAULTS).join(", ")}`,
    );
  }
  return {
    id: nextId(
      "shape",
      shapes.map((shape) => shape?.id),
    ),
    kind,
    text: text ?? "",
    x,
    y,
    width: Math.max(width ?? fallback.width, MIN_SIZE),
    height: Math.max(height ?? fallback.height, MIN_SIZE),
    accent: null,
    parent: null,
    anchor: null,
    // Authored from here is authored deliberately, so auto-layout leaves it
    // alone — the same thing a hand-placed shape means in the editor.
    pinned: true,
    collapsed: false,
    tags: [],
  };
}

/** A connector between two shapes, tagged as the document requires. */
export function makeConnector(connectors, fromShape, toShape, label) {
  return {
    id: nextId(
      "conn",
      connectors.map((connector) => connector?.id),
    ),
    from: { attach: "shape", shape: fromShape, side: null },
    to: { attach: "shape", shape: toShape, side: null },
    waypoints: [],
    dash: "solid",
    // "filled", not "arrow": the document's vocabulary is
    // none | open | filled | diamond, and the parser rejects anything else.
    // Guessing it cost one failing contract test, which is what that test is
    // for.
    head: "filled",
    label: label ?? null,
    accent: null,
  };
}

/**
 * Where to put the next shape when nobody said.
 *
 * Down the left, a row at a time, so a scripted series of additions is
 * readable rather than a stack at the origin.
 */
export function nextFreeSpot(shapes) {
  const placed = shapes.filter(
    (shape) => typeof shape?.y === "number" && typeof shape?.x === "number",
  );
  if (placed.length === 0) return { x: 0, y: 0 };
  const lowest = Math.max(
    ...placed.map((shape) => shape.y + (shape.height ?? 0)),
  );
  return { x: 0, y: lowest + 40 };
}

/** Write a document back, leaving everything this did not touch alone. */
export async function writeMap(file, document, canvas) {
  const next = { ...document, canvas };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/** One line per shape, with what connects to it. */
export function describeCanvas(canvas) {
  const lines = [];
  if (canvas.shapes.length === 0 && canvas.connectors.length === 0) {
    return ["Nothing drawn yet."];
  }
  lines.push(
    `view: ${canvas.view?.mode ?? "?"} · layout ${canvas.view?.layout ?? "?"}`,
    "",
  );
  canvas.shapes.forEach((shape) => {
    lines.push(
      `${shape.id}  ${shape.kind.padEnd(8)} (${shape.x},${shape.y})  ${shape.text || "(no label)"}`,
    );
  });
  if (canvas.connectors.length > 0) lines.push("");
  canvas.connectors.forEach((connector) => {
    const from = connector.from?.shape ?? connector.from?.node ?? "?";
    const to = connector.to?.shape ?? connector.to?.node ?? "?";
    lines.push(
      `${connector.id}  ${from} → ${to}${connector.label ? `  ${connector.label}` : ""}`,
    );
  });
  return lines;
}
