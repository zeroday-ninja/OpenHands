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

/**
 * Where the page lives. Declared beside the document format rather than in the
 * feature directory so the sidebar and the command menu can name the route
 * without pulling the page's component graph into their own chunk.
 */
export const PROJECT_MAP_ROUTE_PATH = "/map";

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

/**
 * Which layer a node belongs to.
 *
 * `code` is the committed analysis — the nodes, edges and groups below. `work`
 * is the live graph of what the agents are doing, which is assembled from the
 * services on every fetch and **never serialized**: writing run status into a
 * committed file would churn the repository on every poll and leak deployment
 * identity into source control. The id exists here so authored content can
 * point at either layer without this type changing when the work layer lands.
 */
export const PROJECT_MAP_LAYER_IDS = ["code", "work"] as const;

export type ProjectMapLayerId = (typeof PROJECT_MAP_LAYER_IDS)[number];

/**
 * Authored content attached to a derived node, which it then travels with.
 *
 * Deliberately not called `pinned`: on a node and on a shape that word already
 * means "auto-layout must not move this", and the two concepts sitting under
 * one name is a bug waiting to happen.
 */
export interface ProjectMapAnchor {
  layer: ProjectMapLayerId;
  /** Node id inside that layer. */
  node: string;
  /** Offset from the node's position, so the attachment keeps its place. */
  dx: number;
  dy: number;
}

/**
 * What a drawn shape *is*.
 *
 * `sticky` is the palette's Note: the user's own object, with geometry and no
 * required subject. The `notes` array below is a different thing and keeps its
 * name — an annotation the analysis writes, with a leader line to a node it is
 * about. Two things a person would call a note, kept apart because migrating
 * one into the other would silently rewrite every committed map on the next
 * save.
 *
 * `frame` is the freeform group. It is not a `ProjectMapGroup` because a
 * group's outline is computed from its members, so a group can neither be
 * empty nor be resized, and a frame must be able to be both. Frame membership
 * is containment at gesture time and is never stored.
 */
export const PROJECT_MAP_SHAPE_KINDS = [
  "box",
  "diamond",
  "sticky",
  "frame",
  "branch",
] as const;

export type ProjectMapShapeKind = (typeof PROJECT_MAP_SHAPE_KINDS)[number];

export interface ProjectMapShape {
  /** `shape-<base36>`, so an authored id can never collide with a path id. */
  id: string;
  kind: ProjectMapShapeKind;
  text: string;
  /**
   * Top-left and extent, in diagram coordinates. Always present: unlike an
   * analysed node, a drawn shape has no "not placed yet" state, so the
   * authored layer needs no second placed-document type.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Palette index as a string, the same grammar as `ProjectMapGroup.accent`. */
  accent: string | null;
  /**
   * Mind-map parent, or null. A forest, not a graph: branch lines are derived
   * from this field and never stored as connectors, so the tree has one source
   * of truth.
   */
  parent: string | null;
  /** The derived node this shape travels with, or null to float free. */
  anchor: ProjectMapAnchor | null;
  /** The user placed this one. Auto-layout must not move it. */
  pinned: boolean;
  /** Children (branch) or contents (frame) folded away. */
  collapsed: boolean;
  tags: string[];
}

/** Which side of a box a connector leaves from or arrives at. */
export const PROJECT_MAP_SIDES = ["left", "right", "top", "bottom"] as const;

export type ProjectMapSide = (typeof PROJECT_MAP_SIDES)[number];

/**
 * One end of a connector. Tagged, so the JSON says what it attaches to rather
 * than leaving a reader to infer it from which fields are present.
 */
export type ProjectMapEndpoint =
  | { attach: "shape"; shape: string; side: ProjectMapSide | null }
  | {
      attach: "derived";
      layer: ProjectMapLayerId;
      node: string;
      side: ProjectMapSide | null;
    }
  | { attach: "free"; x: number; y: number };

export const PROJECT_MAP_ENDPOINT_ATTACHMENTS = [
  "shape",
  "derived",
  "free",
] as const;

export const PROJECT_MAP_CONNECTOR_DASHES = [
  "solid",
  "dashed",
  "dotted",
] as const;

export type ProjectMapConnectorDash =
  (typeof PROJECT_MAP_CONNECTOR_DASHES)[number];

export const PROJECT_MAP_CONNECTOR_HEADS = [
  "none",
  "open",
  "filled",
  "diamond",
] as const;

export type ProjectMapConnectorHead =
  (typeof PROJECT_MAP_CONNECTOR_HEADS)[number];

/**
 * A line the user drew.
 *
 * Style is carried directly rather than inferred from a semantic `kind`, which
 * is the asymmetry with `edges` below and is intentional: an analysed edge
 * asserts a relationship the analysis can be held to, while a drawn line means
 * whatever the person drawing it meant.
 */
export interface ProjectMapConnector {
  /** `conn-<base36>`. */
  id: string;
  from: ProjectMapEndpoint;
  to: ProjectMapEndpoint;
  /** Hand-placed bends, in order, in diagram coordinates. */
  waypoints: { x: number; y: number }[];
  dash: ProjectMapConnectorDash;
  head: ProjectMapConnectorHead;
  label: string | null;
  accent: string | null;
}

/**
 * Which layers the canvas draws, and which of them the user is editing.
 *
 * `derived` is the picture the analysis made, `freeform` is only what the user
 * drew, and `both` puts the drawing over the analysis with anchors live.
 */
export const PROJECT_MAP_MODES = ["derived", "freeform", "both"] as const;

export type ProjectMapMode = (typeof PROJECT_MAP_MODES)[number];

/** Which arrangement, if any, is managing the authored layer's positions. */
export const PROJECT_MAP_LAYOUT_KINDS = [
  "tree",
  "radial",
  "layered",
  "free",
] as const;

export type ProjectMapLayoutKind = (typeof PROJECT_MAP_LAYOUT_KINDS)[number];

export interface ProjectMapView {
  mode: ProjectMapMode;
  layout: ProjectMapLayoutKind;
  /**
   * Which derived layer is on the paper: the committed analysis of the code,
   * or the live graph of what the agents are doing.
   *
   * Absent means `code`, which is what every document written before the work
   * layer existed meant. It is stored with the view for the same reason the
   * mode is: a map someone opens to watch work should open that way on every
   * machine they use.
   */
  layer?: ProjectMapLayerId;
}

/**
 * Everything the user drew. The analysis never reads or writes it.
 *
 * It is a separate top-level key rather than extra members of `nodes` for one
 * reason, and it is the load-bearing decision of the whole editor: the node
 * set belongs to the analysis, so a regeneration that no longer reports a file
 * drops its node even when pinned. Authored content cannot live under that
 * rule. Anything that later "simplifies" this by folding shapes into `nodes`
 * with a provenance flag deletes the user's diagram on the next regeneration.
 */
export interface ProjectMapCanvasLayer {
  view: ProjectMapView;
  /** Paint order is array order; frames sit at the front, behind everything. */
  shapes: ProjectMapShape[];
  connectors: ProjectMapConnector[];
}

/**
 * A layer as the canvas renders it.
 *
 * One producer ships today, for the committed `code` layer. The live `work`
 * layer adds a second producer rather than a second type.
 */
export interface ProjectMapDerivedLayer {
  id: ProjectMapLayerId;
  nodes: PlacedProjectMapNode[];
  edges: ProjectMapEdge[];
  groups: ProjectMapGroup[];
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
  /**
   * Absent in every document written before the editor existed, and omitted
   * again by `serializeProjectMap` whenever it is empty — so a map nobody has
   * drawn on stays byte-identical on save. The version is deliberately *not*
   * bumped for this field: the addition is additive, while a bump would make
   * every older build reject the file outright.
   */
  canvas?: ProjectMapCanvasLayer;
}

/** A node whose position is known, which is every node the canvas renders. */
export type PlacedProjectMapNode = ProjectMapNode & { x: number; y: number };

/**
 * A document every node of which has been placed, and whose authored layer is
 * present. In memory the canvas block is always a value even when the file
 * omits it, so no component has to branch on its absence.
 */
export type PlacedProjectMapDocument = Omit<
  ProjectMapDocument,
  "nodes" | "canvas"
> & {
  nodes: PlacedProjectMapNode[];
  canvas: ProjectMapCanvasLayer;
};
