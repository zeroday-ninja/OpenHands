/**
 * Where nodes sit, and how big they are.
 *
 * The map's whole value is that the arrangement is *yours*, so this module is
 * deliberately modest: it only places nodes that have never been placed, and
 * it puts a batch of new ones in a fresh band to the right of everything that
 * already exists. Nothing here ever moves a node that already has a position.
 */

import type {
  PlacedProjectMapDocument,
  PlacedProjectMapNode,
  ProjectMapDocument,
  ProjectMapNode,
} from "#/types/project-map";

/** Pitch of the drafting grid the canvas draws and snaps to. */
export const PROJECT_MAP_GRID = 20;

/** Pitch between auto-placed columns and rows. */
export const PROJECT_MAP_COLUMN_PITCH = 260;
export const PROJECT_MAP_ROW_PITCH = 96;

/** Clear space left between the existing drawing and a batch of new nodes. */
export const PROJECT_MAP_NEW_NODE_GUTTER = 140;

/** How tall an auto-placed column gets before it wraps. */
export const PROJECT_MAP_COLUMN_ROWS = 10;

/** A node of unremarkable size, in lines. Sets the middle of the weight scale. */
const TYPICAL_NODE_LINES = 300;

const NODE_BASE_WIDTH = 168;
const NODE_BASE_HEIGHT = 48;
const MIN_NODE_WEIGHT = 0.78;
const MAX_NODE_WEIGHT = 1.5;

export interface ProjectMapNodeSize {
  width: number;
  height: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * How much room a node takes, from its line count.
 *
 * The square root is the point: area, not width, should track size, so a file
 * ten times longer reads as heavier without becoming ten times wider and
 * wrecking the drawing. Both ends are clamped so a one-line barrel stays
 * readable and a 5,000-line monster stays on the canvas.
 */
export function projectMapNodeSize(size: number): ProjectMapNodeSize {
  const lines = Number.isFinite(size) ? Math.max(size, 0) : 0;
  const weight = clamp(
    Math.sqrt(lines / TYPICAL_NODE_LINES),
    MIN_NODE_WEIGHT,
    MAX_NODE_WEIGHT,
  );
  return {
    width: Math.round(NODE_BASE_WIDTH * weight),
    height: Math.round(NODE_BASE_HEIGHT * weight),
  };
}

function isPlaced(node: ProjectMapNode): node is PlacedProjectMapNode {
  return node.x !== null && node.y !== null;
}

/**
 * The reading order for nodes that have to be placed from nothing: grouped the
 * way the document groups them, then heaviest first inside each group, so the
 * first glance at a brand-new map lands on the biggest thing in each layer.
 */
function layoutOrder(
  nodes: ProjectMapNode[],
  groupOrder: string[],
): ProjectMapNode[][] {
  const columns = new Map<string, ProjectMapNode[]>();
  for (const node of nodes) {
    const key = node.group ?? "";
    const column = columns.get(key);
    if (column) column.push(node);
    else columns.set(key, [node]);
  }
  const keys = [...columns.keys()].sort((left, right) => {
    // Ungrouped nodes go last; otherwise follow the document's group order.
    if (left === "") return 1;
    if (right === "") return -1;
    return groupOrder.indexOf(left) - groupOrder.indexOf(right);
  });
  return keys.map((key) =>
    [...(columns.get(key) ?? [])].sort(
      (left, right) =>
        right.size - left.size || left.id.localeCompare(right.id),
    ),
  );
}

/**
 * Positions for nodes that have none, given the ones that already do.
 *
 * With an empty drawing the new nodes become one column per group. With an
 * existing drawing they all land in a band past its right edge: a batch of
 * things the last analysis did not know about is easier to triage when it
 * arrives together and nowhere near the part you arranged by hand.
 */
export function placeProjectMapNodes(
  placed: PlacedProjectMapNode[],
  pending: ProjectMapNode[],
  groupOrder: string[] = [],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (pending.length === 0) return positions;

  if (placed.length === 0) {
    layoutOrder(pending, groupOrder).forEach((column, columnIndex) => {
      column.forEach((node, rowIndex) => {
        positions.set(node.id, {
          x: columnIndex * PROJECT_MAP_COLUMN_PITCH,
          y: rowIndex * PROJECT_MAP_ROW_PITCH,
        });
      });
    });
    return positions;
  }

  const right = Math.max(
    ...placed.map((node) => node.x + projectMapNodeSize(node.size).width),
  );
  const top = Math.min(...placed.map((node) => node.y));
  const originX =
    Math.ceil((right + PROJECT_MAP_NEW_NODE_GUTTER) / PROJECT_MAP_GRID) *
    PROJECT_MAP_GRID;
  const originY = Math.round(top / PROJECT_MAP_GRID) * PROJECT_MAP_GRID;

  const ordered = [...pending].sort(
    (left, right_) =>
      (left.group ?? "").localeCompare(right_.group ?? "") ||
      left.id.localeCompare(right_.id),
  );
  ordered.forEach((node, index) => {
    positions.set(node.id, {
      x:
        originX +
        Math.floor(index / PROJECT_MAP_COLUMN_ROWS) * PROJECT_MAP_COLUMN_PITCH,
      y: originY + (index % PROJECT_MAP_COLUMN_ROWS) * PROJECT_MAP_ROW_PITCH,
    });
  });
  return positions;
}

/**
 * Gives every node a position, so nothing downstream has to handle the gap.
 * A document whose nodes are all placed is returned structurally unchanged.
 */
export function ensureProjectMapLayout(
  document: ProjectMapDocument,
): PlacedProjectMapDocument {
  const placed = document.nodes.filter(isPlaced);
  const pending = document.nodes.filter((node) => !isPlaced(node));
  const positions = placeProjectMapNodes(
    placed,
    pending,
    document.groups.map((group) => group.id),
  );
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (isPlaced(node)) return node;
      const position = positions.get(node.id) ?? { x: 0, y: 0 };
      return { ...node, x: position.x, y: position.y };
    }),
  };
}

/** The drawing's extent, for fit-to-view. Null when there is nothing to fit. */
export function projectMapBounds(nodes: PlacedProjectMapNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const { width, height } = projectMapNodeSize(node.size);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + width);
    maxY = Math.max(maxY, node.y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Breathing room between a group's boundary and the nodes inside it. */
export const PROJECT_MAP_GROUP_PADDING = 26;

/**
 * The boundary drawn around a group: the bounding box of its visible members,
 * padded.
 *
 * A group has no stored geometry of its own on purpose. Its outline follows
 * whatever the user dragged into it, which is also what makes dropping a node
 * inside the boundary a sensible way to join it — the boundary is not a
 * container the node has to be put into, it is a description of where the
 * members already are.
 */
export function projectMapGroupBounds(
  nodes: PlacedProjectMapNode[],
  groupId: string,
): { x: number; y: number; width: number; height: number } | null {
  const members = nodes.filter((node) => node.group === groupId);
  const bounds = projectMapBounds(members);
  if (bounds === null) return null;
  return {
    x: bounds.x - PROJECT_MAP_GROUP_PADDING,
    y: bounds.y - PROJECT_MAP_GROUP_PADDING,
    width: bounds.width + PROJECT_MAP_GROUP_PADDING * 2,
    height: bounds.height + PROJECT_MAP_GROUP_PADDING * 2,
  };
}

/** The group whose boundary contains a point, innermost (smallest) first. */
export function projectMapGroupAtPoint(
  nodes: PlacedProjectMapNode[],
  groupIds: readonly string[],
  point: { x: number; y: number },
): string | null {
  const hits = groupIds
    .map((groupId) => ({
      groupId,
      bounds: projectMapGroupBounds(nodes, groupId),
    }))
    .filter(
      (
        entry,
      ): entry is {
        groupId: string;
        bounds: NonNullable<ReturnType<typeof projectMapGroupBounds>>;
      } =>
        entry.bounds !== null &&
        point.x >= entry.bounds.x &&
        point.x <= entry.bounds.x + entry.bounds.width &&
        point.y >= entry.bounds.y &&
        point.y <= entry.bounds.y + entry.bounds.height,
    )
    .sort(
      (left, right) =>
        left.bounds.width * left.bounds.height -
        right.bounds.width * right.bounds.height,
    );
  return hits[0]?.groupId ?? null;
}

/** The frame's top-left in diagram coordinates, plus its zoom. */
export interface ProjectMapViewBox {
  x: number;
  y: number;
  scale: number;
}

/** Margin left around the drawing when fitting it to the frame. */
const FIT_PADDING = 56;

/**
 * The viewport that shows the whole drawing, centred.
 *
 * Pure, so the Fit button is an ordinary calculation from the drawing's extent
 * and the frame's measured size rather than an animation with state in it.
 */
export function fitProjectMapViewBox(
  bounds: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
  limits: { min: number; max: number },
): ProjectMapViewBox {
  const usableWidth = Math.max(1, frame.width - FIT_PADDING * 2);
  const usableHeight = Math.max(1, frame.height - FIT_PADDING * 2);
  const scale = Math.min(
    limits.max,
    Math.max(
      limits.min,
      Math.min(
        usableWidth / Math.max(1, bounds.width),
        usableHeight / Math.max(1, bounds.height),
      ),
    ),
  );
  return {
    scale,
    x: bounds.x + bounds.width / 2 - frame.width / (2 * scale),
    y: bounds.y + bounds.height / 2 - frame.height / (2 * scale),
  };
}
