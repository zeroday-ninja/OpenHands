/**
 * Making the things the user draws.
 *
 * Kept out of the store so the rules about *what* a new shape is — its id, its
 * size, where it lands — are pure functions a test can state directly, and the
 * store is left owning only *when* they happen.
 */

import {
  PROJECT_MAP_LAYOUT_KINDS,
  PROJECT_MAP_MODES,
  type ProjectMapAnchor,
  type ProjectMapCanvasLayer,
  type ProjectMapConnector,
  type ProjectMapConnectorDash,
  type ProjectMapConnectorHead,
  type ProjectMapEndpoint,
  type ProjectMapLayoutKind,
  type ProjectMapMode,
  type ProjectMapShape,
  type ProjectMapShapeKind,
} from "#/types/project-map";

/**
 * How big a shape is when it is created by a tap rather than drawn out.
 *
 * A sticky is square because it holds a few words; a frame starts large
 * because its job is to contain other things; a branch is wide and short
 * because it holds one line of a mind map.
 */
export const PROJECT_MAP_SHAPE_DEFAULT_SIZE: Record<
  ProjectMapShapeKind,
  { width: number; height: number }
> = {
  box: { width: 180, height: 64 },
  diamond: { width: 160, height: 96 },
  sticky: { width: 140, height: 140 },
  frame: { width: 420, height: 280 },
  branch: { width: 200, height: 48 },
};

/** Smallest a shape may be dragged or resized to, in diagram units. */
export const PROJECT_MAP_SHAPE_MIN_SIZE = 40;

export const DEFAULT_PROJECT_MAP_MODE: ProjectMapMode = "derived";
export const DEFAULT_PROJECT_MAP_LAYOUT: ProjectMapLayoutKind = "free";

/**
 * The authored layer of a document nobody has drawn on.
 *
 * The default mode is `derived` rather than `both` so an existing map opens
 * exactly the way it does today, and only starts showing an editor once
 * someone asks for one.
 */
export function defaultProjectMapCanvas(): ProjectMapCanvasLayer {
  return {
    view: {
      mode: DEFAULT_PROJECT_MAP_MODE,
      layout: DEFAULT_PROJECT_MAP_LAYOUT,
    },
    shapes: [],
    connectors: [],
  };
}

/**
 * True when the authored layer says nothing a reader would miss.
 *
 * This is what keeps the promise that a map nobody has drawn on round-trips
 * byte-identically: the serializer omits the key entirely in this case, so
 * opening and saving a committed map does not add a block to its diff.
 */
export function isEmptyProjectMapCanvas(
  canvas: ProjectMapCanvasLayer,
): boolean {
  return (
    canvas.shapes.length === 0 &&
    canvas.connectors.length === 0 &&
    canvas.view.mode === DEFAULT_PROJECT_MAP_MODE &&
    canvas.view.layout === DEFAULT_PROJECT_MAP_LAYOUT &&
    // An unset layer and an explicit `code` mean the same thing, so a
    // document that only ever had the default still writes no block.
    (canvas.view.layer ?? "code") === "code"
  );
}

export function isProjectMapMode(value: unknown): value is ProjectMapMode {
  return PROJECT_MAP_MODES.includes(value as ProjectMapMode);
}

export function isProjectMapLayoutKind(
  value: unknown,
): value is ProjectMapLayoutKind {
  return PROJECT_MAP_LAYOUT_KINDS.includes(value as ProjectMapLayoutKind);
}

/**
 * The next id in a prefixed series.
 *
 * Counted from the ids already present rather than from a clock, so two shapes
 * created in the same millisecond cannot collide and a test can state the id
 * it expects. The prefix is what keeps an authored id out of the derived id
 * space, where ids are repository paths.
 */
function nextId(prefix: string, existing: Iterable<string>): string {
  let highest = 0;
  for (const id of existing) {
    if (!id.startsWith(`${prefix}-`)) continue;
    const parsed = Number.parseInt(id.slice(prefix.length + 1), 36);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return `${prefix}-${(highest + 1).toString(36)}`;
}

export function nextProjectMapShapeId(shapes: ProjectMapShape[]): string {
  return nextId(
    "shape",
    shapes.map((shape) => shape.id),
  );
}

export function nextProjectMapConnectorId(
  connectors: ProjectMapConnector[],
): string {
  return nextId(
    "conn",
    connectors.map((connector) => connector.id),
  );
}

export interface CreateProjectMapShapeOptions {
  kind: ProjectMapShapeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  accent?: string | null;
  parent?: string | null;
  anchor?: ProjectMapAnchor | null;
  tags?: string[];
}

export function createProjectMapShape(
  shapes: ProjectMapShape[],
  options: CreateProjectMapShapeOptions,
): ProjectMapShape {
  const fallback = PROJECT_MAP_SHAPE_DEFAULT_SIZE[options.kind];
  return {
    id: nextProjectMapShapeId(shapes),
    kind: options.kind,
    text: options.text ?? "",
    x: options.x,
    y: options.y,
    width: Math.max(
      options.width ?? fallback.width,
      PROJECT_MAP_SHAPE_MIN_SIZE,
    ),
    height: Math.max(
      options.height ?? fallback.height,
      PROJECT_MAP_SHAPE_MIN_SIZE,
    ),
    accent: options.accent ?? null,
    parent: options.parent ?? null,
    anchor: options.anchor ?? null,
    pinned: false,
    collapsed: false,
    tags: options.tags ?? [],
  };
}

export interface CreateProjectMapConnectorOptions {
  from: ProjectMapEndpoint;
  to: ProjectMapEndpoint;
  dash?: ProjectMapConnectorDash;
  head?: ProjectMapConnectorHead;
  label?: string | null;
  accent?: string | null;
  waypoints?: { x: number; y: number }[];
}

export function createProjectMapConnector(
  connectors: ProjectMapConnector[],
  options: CreateProjectMapConnectorOptions,
): ProjectMapConnector {
  return {
    id: nextProjectMapConnectorId(connectors),
    from: options.from,
    to: options.to,
    waypoints: options.waypoints ?? [],
    dash: options.dash ?? "solid",
    head: options.head ?? "filled",
    label: options.label ?? null,
    accent: options.accent ?? null,
  };
}

/** Where a connector endpoint points, for the repair passes that follow ids. */
export function endpointTargetId(endpoint: ProjectMapEndpoint): string | null {
  if (endpoint.attach === "shape") return endpoint.shape;
  if (endpoint.attach === "derived") return endpoint.node;
  return null;
}
