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
  PROJECT_MAP_EDGE_KINDS,
  PROJECT_MAP_NODE_KINDS,
  PROJECT_MAP_VERSION,
  type ProjectMapDocument,
  type ProjectMapEdge,
  type ProjectMapEdgeKind,
  type ProjectMapGroup,
  type ProjectMapLabelSource,
  type ProjectMapNode,
  type ProjectMapNodeKind,
  type ProjectMapNote,
} from "#/types/project-map";

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
  | "orphan-note";

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
): Record<string, unknown>[] {
  const value = source[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidField(key);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new InvalidField(`${key}[${index}]`);
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

function readNote(
  raw: Record<string, unknown>,
  pointer: string,
): ProjectMapNote {
  return {
    id: requiredText(raw, "id", `${pointer}.id`),
    text: optionalString(raw, "text", `${pointer}.text`) ?? "",
    anchor: optionalString(raw, "anchor", `${pointer}.anchor`),
    x: optionalNumber(raw, "x", `${pointer}.x`) ?? 0,
    y: optionalNumber(raw, "y", `${pointer}.y`) ?? 0,
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

    const notes = readList(parsed, "notes").map((raw_, index) => {
      const note = readNote(raw_, `notes[${index}]`);
      if (note.anchor !== null && !nodesById.has(note.anchor)) {
        warnings.add("orphan-note");
        return { ...note, anchor: null };
      }
      return note;
    });

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
 */
export function serializeProjectMap(document: ProjectMapDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
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
