/**
 * Reading `.openhands/project-map.json` without trusting it.
 *
 * The document is a committed file that both a person and an agent edit by
 * hand, so it arrives malformed sooner or later. The page must say what is
 * wrong instead of rendering a blank canvas or throwing inside React, which is
 * why this module returns a result rather than throwing, and reports a
 * *locator* (`nodes[3].kind`) that the page pairs with translated prose.
 *
 * Two different failure appetites are deliberate:
 *
 * - A structural mistake — unreadable JSON, an unknown version, a node with no
 *   identity or an unknown kind — rejects the whole document. Guessing would
 *   silently drop part of the picture, and a map you cannot trust is worse
 *   than no map.
 * - A *referential* mistake — an edge to a node that was removed, a second
 *   node claiming an existing id, a group nobody declares, a note whose
 *   subject is gone — is repaired and counted. These happen every time
 *   someone deletes something, and losing the whole map over one stale edge
 *   would make the file feel brittle to edit.
 */

import {
  PROJECT_MAP_CONNECTOR_DASHES,
  PROJECT_MAP_CONNECTOR_HEADS,
  PROJECT_MAP_EDGE_KINDS,
  PROJECT_MAP_LAYER_IDS,
  PROJECT_MAP_NODE_KINDS,
  PROJECT_MAP_SHAPE_KINDS,
  PROJECT_MAP_SIDES,
  PROJECT_MAP_VERSION,
  type ProjectMapAnchor,
  type ProjectMapCanvasLayer,
  type ProjectMapConnector,
  type ProjectMapConnectorDash,
  type ProjectMapConnectorHead,
  type ProjectMapDocument,
  type ProjectMapEdge,
  type ProjectMapEdgeKind,
  type ProjectMapEndpoint,
  type ProjectMapGroup,
  type ProjectMapLabelSource,
  type ProjectMapLayerId,
  type ProjectMapNode,
  type ProjectMapNodeKind,
  type ProjectMapNote,
  type ProjectMapShape,
  type ProjectMapShapeKind,
  type ProjectMapSide,
} from "#/types/project-map";
import {
  defaultProjectMapCanvas,
  isEmptyProjectMapCanvas,
  isProjectMapLayoutKind,
  isProjectMapMode,
} from "./project-map-authoring";
import { projectMapNodeSize } from "./project-map-layout";

/** Why a document was rejected outright. */
export type ProjectMapParseFailureReason =
  | "not-json"
  | "not-an-object"
  | "unsupported-version"
  | "invalid-field";

/** What was repaired on the way in. */
export type ProjectMapWarningKind =
  | "dangling-edge"
  | "duplicate-node"
  | "unknown-group"
  | "orphan-note"
  /** Drawn content was anchored to an analysed node the analysis dropped. */
  | "unresolved-anchor"
  /** A line or a branch pointed at a drawn shape that is gone. */
  | "dangling-link";

export interface ProjectMapWarning {
  kind: ProjectMapWarningKind;
  count: number;
}

export interface ProjectMapParseFailure {
  ok: false;
  reason: ProjectMapParseFailureReason;
  /** Locator of the offending value, never prose: `nodes[3].kind`. */
  pointer: string | null;
  /** The version found, when the version is what we rejected. */
  foundVersion: number | null;
}

export interface ProjectMapParseSuccess {
  ok: true;
  document: ProjectMapDocument;
  warnings: ProjectMapWarning[];
}

export type ProjectMapParseResult =
  | ProjectMapParseSuccess
  | ProjectMapParseFailure;

/** Thrown internally so a nested check can abort with its own locator. */
class InvalidField extends Error {
  constructor(readonly pointer: string) {
    super(pointer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  pointer: string,
): string | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidField(pointer);
  return value;
}

function requiredText(
  source: Record<string, unknown>,
  key: string,
  pointer: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidField(pointer);
  }
  return value;
}

function optionalNumber(
  source: Record<string, unknown>,
  key: string,
  pointer: string,
): number | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidField(pointer);
  }
  return value;
}

function optionalBoolean(
  source: Record<string, unknown>,
  key: string,
  pointer: string,
): boolean {
  const value = source[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new InvalidField(pointer);
  return value;
}

function optionalStringList(
  source: Record<string, unknown>,
  key: string,
  pointer: string,
): string[] {
  const value = source[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidField(pointer);
  return value.map((entry, index) => {
    if (typeof entry !== "string")
      throw new InvalidField(`${pointer}[${index}]`);
    return entry;
  });
}

/** Reads one of a closed set of tags, so an unknown tag cannot reach the UI. */
function requiredTag<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  pointer: string,
): T {
  const value = source[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new InvalidField(pointer);
  }
  return value as T;
}

function readList(
  source: Record<string, unknown>,
  key: string,
  pointer: string = key,
): Record<string, unknown>[] {
  const value = source[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidField(pointer);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new InvalidField(`${pointer}[${index}]`);
    return entry;
  });
}

function readGroup(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapGroup {
  const id = requiredText(raw, "id", `${pointer}.id`);
  return {
    id,
    label: optionalString(raw, "label", `${pointer}.label`) ?? id,
    accent: optionalString(raw, "accent", `${pointer}.accent`),
    collapsed: optionalBoolean(raw, "collapsed", `${pointer}.collapsed`),
  };
}

function readNode(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapNode {
  const labelSource = optionalString(
    raw,
    "label_source",
    `${pointer}.label_source`,
  );
  if (
    labelSource !== null &&
    labelSource !== "generated" &&
    labelSource !== "user"
  ) {
    throw new InvalidField(`${pointer}.label_source`);
  }
  const id = requiredText(raw, "id", `${pointer}.id`);
  const node: ProjectMapNode = {
    id,
    kind: requiredTag<ProjectMapNodeKind>(
      raw,
      "kind",
      PROJECT_MAP_NODE_KINDS,
      `${pointer}.kind`,
    ),
    label: optionalString(raw, "label", `${pointer}.label`) ?? id,
    path: optionalString(raw, "path", `${pointer}.path`),
    group: optionalString(raw, "group", `${pointer}.group`),
    summary: optionalString(raw, "summary", `${pointer}.summary`) ?? "",
    size: optionalNumber(raw, "size", `${pointer}.size`) ?? 0,
    x: optionalNumber(raw, "x", `${pointer}.x`),
    y: optionalNumber(raw, "y", `${pointer}.y`),
    pinned: optionalBoolean(raw, "pinned", `${pointer}.pinned`),
    hidden: optionalBoolean(raw, "hidden", `${pointer}.hidden`),
    tags: optionalStringList(raw, "tags", `${pointer}.tags`),
  };
  if (labelSource !== null) {
    node.label_source = labelSource as ProjectMapLabelSource;
  }
  return node;
}

function readEdge(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapEdge {
  return {
    from: requiredText(raw, "from", `${pointer}.from`),
    to: requiredText(raw, "to", `${pointer}.to`),
    kind: requiredTag<ProjectMapEdgeKind>(
      raw,
      "kind",
      PROJECT_MAP_EDGE_KINDS,
      `${pointer}.kind`,
    ),
    label: optionalString(raw, "label", `${pointer}.label`),
  };
}

/** Clearance between a node and a note placed beside it, and between stacked notes. */
const NOTE_BESIDE_GAP = 24;
const NOTE_STACK_PITCH = 72;

/**
 * A note's place on the paper.
 *
 * The analysis is asked for a note's anchor, not its position — where a
 * remark sits is the reader's decision, like everything else about the
 * arrangement. A note that arrives without one and names a placed node sits
 * beside that node, stacked under any earlier note on the same node, instead
 * of at the origin, where every unplaced note of a map used to pile up on
 * top of whatever happened to be drawn there.
 */
function readNote(
  raw: Record<string, unknown>,
  pointer: string,
  placeBeside: (anchor: string | null) => { x: number; y: number },
): ProjectMapNote {
  const anchor = optionalString(raw, "anchor", `${pointer}.anchor`);
  const x = optionalNumber(raw, "x", `${pointer}.x`);
  const y = optionalNumber(raw, "y", `${pointer}.y`);
  const placed = x === null || y === null ? placeBeside(anchor) : { x, y };
  return {
    id: requiredText(raw, "id", `${pointer}.id`),
    text: optionalString(raw, "text", `${pointer}.text`) ?? "",
    anchor,
    x: x ?? placed.x,
    y: y ?? placed.y,
  };
}

function requiredNumber(
  source: Record<string, unknown>,
  key: string,
  pointer: string,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidField(pointer);
  }
  return value;
}

function optionalTag<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  pointer: string,
): T | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new InvalidField(pointer);
  }
  return value as T;
}

function readAnchor(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapAnchor {
  return {
    layer: requiredTag<ProjectMapLayerId>(
      raw,
      "layer",
      PROJECT_MAP_LAYER_IDS,
      `${pointer}.layer`,
    ),
    node: requiredText(raw, "node", `${pointer}.node`),
    dx: optionalNumber(raw, "dx", `${pointer}.dx`) ?? 0,
    dy: optionalNumber(raw, "dy", `${pointer}.dy`) ?? 0,
  };
}

function readShape(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapShape {
  const rawAnchor = raw.anchor;
  let anchor: ProjectMapAnchor | null = null;
  if (rawAnchor !== undefined && rawAnchor !== null) {
    if (!isRecord(rawAnchor)) throw new InvalidField(`${pointer}.anchor`);
    anchor = readAnchor(rawAnchor, `${pointer}.anchor`);
  }
  return {
    id: requiredText(raw, "id", `${pointer}.id`),
    kind: requiredTag<ProjectMapShapeKind>(
      raw,
      "kind",
      PROJECT_MAP_SHAPE_KINDS,
      `${pointer}.kind`,
    ),
    text: optionalString(raw, "text", `${pointer}.text`) ?? "",
    x: requiredNumber(raw, "x", `${pointer}.x`),
    y: requiredNumber(raw, "y", `${pointer}.y`),
    width: requiredNumber(raw, "width", `${pointer}.width`),
    height: requiredNumber(raw, "height", `${pointer}.height`),
    accent: optionalString(raw, "accent", `${pointer}.accent`),
    parent: optionalString(raw, "parent", `${pointer}.parent`),
    anchor,
    pinned: optionalBoolean(raw, "pinned", `${pointer}.pinned`),
    collapsed: optionalBoolean(raw, "collapsed", `${pointer}.collapsed`),
    tags: optionalStringList(raw, "tags", `${pointer}.tags`),
  };
}

function readEndpoint(raw: unknown, pointer: string): ProjectMapEndpoint {
  if (!isRecord(raw)) throw new InvalidField(pointer);
  const attach = raw.attach;
  if (attach === "shape") {
    return {
      attach: "shape",
      shape: requiredText(raw, "shape", `${pointer}.shape`),
      side: optionalTag<ProjectMapSide>(
        raw,
        "side",
        PROJECT_MAP_SIDES,
        `${pointer}.side`,
      ),
    };
  }
  if (attach === "derived") {
    return {
      attach: "derived",
      layer: requiredTag<ProjectMapLayerId>(
        raw,
        "layer",
        PROJECT_MAP_LAYER_IDS,
        `${pointer}.layer`,
      ),
      node: requiredText(raw, "node", `${pointer}.node`),
      side: optionalTag<ProjectMapSide>(
        raw,
        "side",
        PROJECT_MAP_SIDES,
        `${pointer}.side`,
      ),
    };
  }
  if (attach === "free") {
    return {
      attach: "free",
      x: requiredNumber(raw, "x", `${pointer}.x`),
      y: requiredNumber(raw, "y", `${pointer}.y`),
    };
  }
  throw new InvalidField(`${pointer}.attach`);
}

function readConnector(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapConnector {
  const waypoints = readList(raw, "waypoints", `${pointer}.waypoints`).map(
    (point, index) => ({
      x: requiredNumber(point, "x", `${pointer}.waypoints[${index}].x`),
      y: requiredNumber(point, "y", `${pointer}.waypoints[${index}].y`),
    }),
  );
  return {
    id: requiredText(raw, "id", `${pointer}.id`),
    from: readEndpoint(raw.from, `${pointer}.from`),
    to: readEndpoint(raw.to, `${pointer}.to`),
    waypoints,
    dash:
      optionalTag<ProjectMapConnectorDash>(
        raw,
        "dash",
        PROJECT_MAP_CONNECTOR_DASHES,
        `${pointer}.dash`,
      ) ?? "solid",
    head:
      optionalTag<ProjectMapConnectorHead>(
        raw,
        "head",
        PROJECT_MAP_CONNECTOR_HEADS,
        `${pointer}.head`,
      ) ?? "filled",
    label: optionalString(raw, "label", `${pointer}.label`),
    accent: optionalString(raw, "accent", `${pointer}.accent`),
  };
}

/** Collects repairs so the page can mention them once, with a count. */
class WarningTally {
  private readonly counts = new Map<ProjectMapWarningKind, number>();

  add(kind: ProjectMapWarningKind) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }

  list(): ProjectMapWarning[] {
    return [...this.counts.entries()].map(([kind, count]) => ({ kind, count }));
  }
}

/**
 * Where an endpoint goes when the thing it pointed at is gone.
 *
 * The line is never dropped — a line the user can still see must stay — so it
 * has to land somewhere defensible: the bend nearest that end, else the other
 * end if that one is already a point, else the origin.
 */
function releasePoint(
  connector: ProjectMapConnector,
  end: "from" | "to",
): { x: number; y: number } {
  const bend =
    end === "from" ? connector.waypoints.at(0) : connector.waypoints.at(-1);
  if (bend) return { x: bend.x, y: bend.y };
  const other = end === "from" ? connector.to : connector.from;
  if (other.attach === "free") return { x: other.x, y: other.y };
  return { x: 0, y: 0 };
}

/**
 * Reads the authored layer, repairing references rather than rejecting them.
 *
 * One rule here is load-bearing and easy to "simplify" away later: a reference
 * into a layer the document does not contain is left exactly as it is. The
 * work layer is assembled live and never serialized, so an anchor into it
 * always looks missing from in here, and repairing it would quietly delete
 * every annotation the user attached to running work.
 */
function readCanvas(
  parsed: Record<string, unknown>,
  nodeIds: Set<string>,
  warnings: WarningTally,
): ProjectMapCanvasLayer {
  const rawCanvas = parsed.canvas;
  if (rawCanvas === undefined || rawCanvas === null) {
    return defaultProjectMapCanvas();
  }
  if (!isRecord(rawCanvas)) throw new InvalidField("canvas");

  const fallback = defaultProjectMapCanvas();
  const rawView = rawCanvas.view;
  let view = fallback.view;
  if (rawView !== undefined && rawView !== null) {
    if (!isRecord(rawView)) throw new InvalidField("canvas.view");
    const mode = rawView.mode ?? fallback.view.mode;
    const layout = rawView.layout ?? fallback.view.layout;
    const layer = rawView.layer ?? "code";
    if (!isProjectMapMode(mode)) throw new InvalidField("canvas.view.mode");
    if (!isProjectMapLayoutKind(layout)) {
      throw new InvalidField("canvas.view.layout");
    }
    if (!PROJECT_MAP_LAYER_IDS.includes(layer as ProjectMapLayerId)) {
      throw new InvalidField("canvas.view.layer");
    }
    view = { mode, layout, layer: layer as ProjectMapLayerId };
  }

  const shapesById = new Map<string, ProjectMapShape>();
  readList(rawCanvas, "shapes", "canvas.shapes").forEach((raw, index) => {
    const pointer = `canvas.shapes[${index}]`;
    const shape = readShape(raw, pointer);
    // Authored ids come from this app's own generator, so a duplicate means
    // the file was broken by hand. Guessing which one the user meant would
    // silently drop drawn work.
    if (shapesById.has(shape.id)) throw new InvalidField(`${pointer}.id`);
    shapesById.set(shape.id, shape);
  });

  const shapes = [...shapesById.values()].map((shape) => {
    let repaired = shape;
    if (repaired.parent !== null && !shapesById.has(repaired.parent)) {
      warnings.add("dangling-link");
      repaired = { ...repaired, parent: null };
    }
    const { anchor: shapeAnchor } = repaired;
    if (
      shapeAnchor !== null &&
      shapeAnchor.layer === "code" &&
      !nodeIds.has(shapeAnchor.node)
    ) {
      warnings.add("unresolved-anchor");
      // The shape keeps its last absolute position and simply stops
      // travelling with anything. It is never deleted.
      repaired = { ...repaired, anchor: null };
    }
    return repaired;
  });

  const connectors = readList(rawCanvas, "connectors", "canvas.connectors").map(
    (raw, index) => {
      const connector = readConnector(raw, `canvas.connectors[${index}]`);
      const resolve = (
        endpoint: ProjectMapEndpoint,
        end: "from" | "to",
      ): ProjectMapEndpoint => {
        if (endpoint.attach === "shape" && !shapesById.has(endpoint.shape)) {
          warnings.add("dangling-link");
          return { attach: "free", ...releasePoint(connector, end) };
        }
        if (
          endpoint.attach === "derived" &&
          endpoint.layer === "code" &&
          !nodeIds.has(endpoint.node)
        ) {
          warnings.add("unresolved-anchor");
          return { attach: "free", ...releasePoint(connector, end) };
        }
        return endpoint;
      };
      return {
        ...connector,
        from: resolve(connector.from, "from"),
        to: resolve(connector.to, "to"),
      };
    },
  );

  return { view, shapes, connectors };
}

export function parseProjectMap(raw: string): ProjectMapParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "not-json", pointer: null, foundVersion: null };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      reason: "not-an-object",
      pointer: null,
      foundVersion: null,
    };
  }

  const version = parsed.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return {
      ok: false,
      reason: "invalid-field",
      pointer: "version",
      foundVersion: null,
    };
  }
  if (version !== PROJECT_MAP_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      pointer: "version",
      foundVersion: version,
    };
  }

  const warnings = new WarningTally();

  try {
    const groups = readList(parsed, "groups").map((raw_, index) =>
      readGroup(raw_, `groups[${index}]`),
    );
    const groupIds = new Set(groups.map((group) => group.id));

    const nodesById = new Map<string, ProjectMapNode>();
    readList(parsed, "nodes").forEach((raw_, index) => {
      const node = readNode(raw_, `nodes[${index}]`);
      if (nodesById.has(node.id)) {
        warnings.add("duplicate-node");
        return;
      }
      if (node.group !== null && !groupIds.has(node.group)) {
        warnings.add("unknown-group");
        nodesById.set(node.id, { ...node, group: null });
        return;
      }
      nodesById.set(node.id, node);
    });

    const edges = readList(parsed, "edges")
      .map((raw_, index) => readEdge(raw_, `edges[${index}]`))
      .filter((edge) => {
        const connected = nodesById.has(edge.from) && nodesById.has(edge.to);
        if (!connected) warnings.add("dangling-edge");
        return connected;
      });

    const besideCount = new Map<string, number>();
    const placeBeside = (anchor: string | null) => {
      const node = anchor === null ? undefined : nodesById.get(anchor);
      if (node === undefined) return { x: 0, y: 0 };
      if (node.x === null || node.y === null) return { x: 0, y: 0 };
      const stacked = besideCount.get(node.id) ?? 0;
      besideCount.set(node.id, stacked + 1);
      return {
        x: node.x + projectMapNodeSize(node.size).width + NOTE_BESIDE_GAP,
        y: node.y + stacked * NOTE_STACK_PITCH,
      };
    };
    const notes = readList(parsed, "notes").map((raw_, index) => {
      const note = readNote(raw_, `notes[${index}]`, placeBeside);
      if (note.anchor !== null && !nodesById.has(note.anchor)) {
        warnings.add("orphan-note");
        return { ...note, anchor: null };
      }
      return note;
    });

    const canvas = readCanvas(parsed, new Set(nodesById.keys()), warnings);

    return {
      ok: true,
      warnings: warnings.list(),
      document: {
        version: PROJECT_MAP_VERSION,
        generated_at: optionalString(parsed, "generated_at", "generated_at"),
        commit: optionalString(parsed, "commit", "commit"),
        groups,
        nodes: [...nodesById.values()],
        edges,
        notes,
        canvas,
      },
    };
  } catch (error) {
    if (error instanceof InvalidField) {
      return {
        ok: false,
        reason: "invalid-field",
        pointer: error.pointer,
        foundVersion: null,
      };
    }
    throw error;
  }
}

/**
 * Writes the document back the way a person would: two-space indent, trailing
 * newline. The file is committed, so its diffs are read by humans.
 *
 * An authored layer nobody has touched is omitted entirely, which is what
 * keeps opening and saving a map that was never drawn on out of the diff.
 */
export function serializeProjectMap(document: ProjectMapDocument): string {
  const { canvas, ...rest } = document;
  const body =
    canvas === undefined || isEmptyProjectMapCanvas(canvas)
      ? rest
      : { ...rest, canvas };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Identity of the bytes on disk, used to decide whether a re-read is a new
 * revision of the map or the same one again.
 *
 * It fingerprints the raw text rather than reading `generated_at` or `commit`,
 * because the interesting writer is the agent asked to "group these three",
 * which rewrites positions and groups and has no reason to touch the
 * provenance fields. Keying on provenance alone would make that edit look
 * identical to what the page already had, and the page would ignore it.
 *
 * The fingerprint only has to change when the content does; it is never
 * stored, compared across machines, or used for security, so a short
 * multiply-and-add hash alongside the length is enough.
 */
export function projectMapRevision(
  absolutePath: string,
  raw: string | null,
): string {
  if (raw === null) return `${absolutePath}@absent`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % 2147483647;
  }
  return `${absolutePath}@${raw.length.toString()}@${hash.toString(36)}`;
}
