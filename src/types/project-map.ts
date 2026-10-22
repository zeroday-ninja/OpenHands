/**
 * The project map document: `.openhands/project-map.json`, one per repository,
 * committed alongside the code it describes.
 *
 * This is deliberately *not* called a code map. A user's repository may
 * already contain a "CodeMap" with its own grammar; reusing that name would
 * make every later conversation about either artifact ambiguous.
 *
 * The document is owned jointly by the user and the agent: the user drags,
 * groups, renames and hides through the `/map` page, the agent regenerates the
 * analysis and may edit the file directly. That only works because
 * regeneration is a *merge* (see `mergeProjectMap`) rather than a replace, so
 * the hand-made layout survives every new analysis.
 *
 * The shapes below are the on-disk wire format. They use snake_case for the
 * fields the agent writes, matching the rest of the repository's server-facing
 * types, so a human reading the JSON and a human reading this file see the
 * same names.
 */

/** Where the document lives, relative to the repository root. */
export const PROJECT_MAP_FILE_PATH = ".openhands/project-map.json";

/** The only document version this build understands. */
export const PROJECT_MAP_VERSION = 1;

/**
 * What a node *is*. The kind drives the silhouette the canvas draws, so a
 * reader can tell a data store from a route without reading a single label.
 * Keep this list short: every member costs a distinguishable shape.
 */
export const PROJECT_MAP_NODE_KINDS = [
  "dir",
  "module",
  "route",
  "component",
  "hook",
  "service",
  "store",
  "endpoint",
  "table",
  "job",
  "external",
] as const;

export type ProjectMapNodeKind = (typeof PROJECT_MAP_NODE_KINDS)[number];

/**
 * What an edge *means*. The kind drives the line style, on two axes a reader
 * can learn in one sitting: the dash pattern says how real the relationship is
 * at runtime, and the arrow head says what kind of effect travels along it.
 */
export const PROJECT_MAP_EDGE_KINDS = [
  "imports",
  "renders",
  "calls",
  "reads",
  "writes",
  "routes-to",
  "publishes",
] as const;

export type ProjectMapEdgeKind = (typeof PROJECT_MAP_EDGE_KINDS)[number];

/**
 * Who last set a node's label.
 *
 * Regeneration has to keep a label the user typed and replace one the previous
 * analysis guessed, and nothing else in the document can tell those apart — so
 * the provenance is recorded. An absent value means "generated", which makes
 * every document written before this field existed behave the way a fresh
 * analysis should.
 */
export type ProjectMapLabelSource = "generated" | "user";

/** A hand-made grouping: the layer or subsystem a person thinks in. */
export interface ProjectMapGroup {
  id: string;
  label: string;
  /**
   * Index into the map's accent palette, as a string so the file stays easy to
   * hand-edit. Never a color: the map has to follow the light and dark themes.
   * Resolve it with `resolveProjectMapAccent`, which also covers the absent
   * and out-of-range cases.
   */
  accent: string | null;
  collapsed: boolean;
}

export interface ProjectMapNode {
  /**
   * Stable identity, and the reason layout survives regeneration: a
   * repository-relative path, or `ext:<name>` for something outside the repo.
   */
  id: string;
  kind: ProjectMapNodeKind;
  label: string;
  label_source?: ProjectMapLabelSource;
  /** Repository-relative path, or null for an external or conceptual node. */
  path: string | null;
  group: string | null;
  summary: string;
  /** Lines of code. Drives how much weight the node carries on the canvas. */
  size: number;
  /**
   * Canvas position. Null means "not placed yet"; `ensureProjectMapLayout`
   * fills those in and nothing else in the app has to cope with the gap.
   */
  x: number | null;
  y: number | null;
  /** The user placed this one. Auto-layout must not move it. */
  pinned: boolean;
  hidden: boolean;
  tags: string[];
}

export interface ProjectMapEdge {
  from: string;
  to: string;
  kind: ProjectMapEdgeKind;
  label: string | null;
}

/** A remark the user left on the drawing, with a leader line to its subject. */
export interface ProjectMapNote {
  id: string;
  text: string;
  /** The node this remark is about, or null for a free-floating one. */
  anchor: string | null;
  x: number;
  y: number;
}

export interface ProjectMapDocument {
  version: number;
  /** ISO 8601 instant the analysis ran. */
  generated_at: string | null;
  /**
   * The commit the analysis ran against. The page shows it so a map generated
   * against an older commit is visibly stale rather than quietly wrong.
   */
  commit: string | null;
  groups: ProjectMapGroup[];
  nodes: ProjectMapNode[];
  edges: ProjectMapEdge[];
  notes: ProjectMapNote[];
}

/** A node whose position is known, which is every node the canvas renders. */
export type PlacedProjectMapNode = ProjectMapNode & { x: number; y: number };

/** A document every node of which has been placed. */
export type PlacedProjectMapDocument = Omit<ProjectMapDocument, "nodes"> & {
  nodes: PlacedProjectMapNode[];
};
