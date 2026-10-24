/**
 * Arranging the drawing: the layouts the user can ask for by name.
 *
 * This is the counterpart to `project-map-layout`, and the split is the point.
 * That module promises never to move a node that already has a position, which
 * is what lets a hand-made arrangement survive every regeneration. These
 * functions exist precisely to move things, so they live apart rather than
 * weakening that promise with a flag.
 *
 * Three rules hold across all of them, and they matter more than any of the
 * algorithms:
 *
 *  - A `pinned` shape, or one carrying an `anchor`, is never moved. Its
 *    position already has an owner — a person who put it there, or the derived
 *    node it travels with — and it is also an obstacle, so an arrangement is
 *    offset clear of the box those shapes occupy rather than landing on them.
 *  - Positions come back only for the shapes an arrangement moves, so a caller
 *    writes them back with a lookup and touches nothing else.
 *  - Nothing snaps to the grid and nothing mutates its input. Snapping belongs
 *    to the caller, so one arrangement is never quantised twice.
 *
 * The layered arrangement is Sugiyama-lite and knowingly approximate; see
 * `layoutProjectMapLayered` for what a real implementation adds.
 */

import type {
  ProjectMapConnector,
  ProjectMapLayoutKind,
  ProjectMapShape,
} from "#/types/project-map";
import {
  PROJECT_MAP_COLUMN_PITCH,
  PROJECT_MAP_GRID,
  PROJECT_MAP_NEW_NODE_GUTTER,
  PROJECT_MAP_ROW_PITCH,
} from "./project-map-layout";

/** Gap left between two sibling bands, across the direction of growth. */
const CROSS_GUTTER = PROJECT_MAP_GRID * 2;

/** Gap left between one depth and the next, along the direction of growth. */
const ALONG_GUTTER = PROJECT_MAP_GRID * 4;

/** Distance between two rings of the radial arrangement. */
const RADIAL_RING_PITCH = PROJECT_MAP_COLUMN_PITCH;

/** Down-then-up barycentre sweeps the layered arrangement runs. */
const BARYCENTRE_PASSES = 2;

const TAU = Math.PI * 2;

/** Which way a tree grows. */
export type ProjectMapGrowthDirection = "right" | "down";

export interface ProjectMapAutoLayoutOptions {
  kind: ProjectMapLayoutKind;
  /** Where the arrangement starts, in diagram coordinates. */
  origin: { x: number; y: number };
  /** Lines, needed only by the layered arrangement. */
  connectors?: ProjectMapConnector[];
  /** Tree growth direction. Default "right". */
  direction?: ProjectMapGrowthDirection;
}

/**
 * The two axes a tree can grow along, so the algorithm is written once.
 *
 * `along` is depth and `cross` is the band a subtree gets. The minimum band
 * follows the pitch the rest of the map auto-places on, which differs per axis
 * because a column of boxes needs less room than a row of them.
 */
interface ProjectMapGrowthAxis {
  along: (shape: ProjectMapShape) => number;
  cross: (shape: ProjectMapShape) => number;
  point: (along: number, cross: number) => { x: number; y: number };
  minBand: number;
}

const GROWTH_AXES: Record<ProjectMapGrowthDirection, ProjectMapGrowthAxis> = {
  right: {
    along: (shape) => shape.width,
    cross: (shape) => shape.height,
    point: (along, cross) => ({ x: along, y: cross }),
    minBand: PROJECT_MAP_ROW_PITCH,
  },
  down: {
    along: (shape) => shape.height,
    cross: (shape) => shape.width,
    point: (along, cross) => ({ x: cross, y: along }),
    minBand: PROJECT_MAP_COLUMN_PITCH,
  },
};

/**
 * A shape no arrangement may move.
 *
 * The two reasons are deliberately treated the same: `pinned` means a person
 * placed it, and an `anchor` means its position is the derived node's to set.
 * Either way the position is not this module's to decide.
 */
function isFixedShape(shape: ProjectMapShape): boolean {
  return shape.pinned || shape.anchor !== null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function unionBounds(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Boxes that merely touch along an edge do not overlap. */
function overlaps(left: Box, right: Box): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/**
 * Moves a finished arrangement to where the caller asked for it, and out of
 * the way of the shapes that may not move.
 *
 * Each algorithm works from a local origin of (0, 0) and hands its result
 * here, so the clearance rule is written once instead of three times and each
 * algorithm can be read without the obstacle case in the way.
 */
function anchorArrangement(
  relative: Map<string, { x: number; y: number }>,
  movable: ProjectMapShape[],
  origin: { x: number; y: number },
  fixed: ProjectMapShape[],
): Map<string, { x: number; y: number }> {
  const arrangement = unionBounds(
    movable.flatMap((shape) => {
      const point = relative.get(shape.id);
      if (point === undefined) return [];
      return [{ ...point, width: shape.width, height: shape.height }];
    }),
  );
  const obstacle = unionBounds(
    fixed.map((shape) => ({
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
    })),
  );

  let offsetX = origin.x;
  if (arrangement !== null && obstacle !== null) {
    const asked = {
      ...arrangement,
      x: arrangement.x + offsetX,
      y: arrangement.y + origin.y,
    };
    if (overlaps(asked, obstacle)) {
      // Past the right-hand edge of everything that cannot move — the same
      // move `placeProjectMapNodes` makes when a batch of new nodes arrives
      // and the existing drawing is already somewhere.
      offsetX =
        obstacle.x +
        obstacle.width +
        PROJECT_MAP_NEW_NODE_GUTTER -
        arrangement.x;
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, point] of relative) {
    positions.set(id, { x: point.x + offsetX, y: point.y + origin.y });
  }
  return positions;
}

interface ProjectMapForest {
  /** Shapes that start a tree, in input order. */
  roots: string[];
  /** The children a node really owns, after any back-edge is dropped. */
  kidsOf: Map<string, string[]>;
  /** Depth-first, so a parent always precedes its children. */
  order: string[];
  depthOf: Map<string, number>;
  byId: Map<string, ProjectMapShape>;
}

/**
 * The forest the `parent` field describes.
 *
 * The document is a hand-editable file, so two inputs that are not forests
 * have to be survivable. A `parent` naming a shape that is not here (or naming
 * itself) makes the shape a root. A `parent` chain that loops leaves its
 * members unreachable from any root, so once the walk is done the first
 * unreachable shape is promoted to a root and the rest of its cycle hangs off
 * it: that drops exactly one edge and, which is the whole point, terminates.
 */
function buildProjectMapForest(shapes: ProjectMapShape[]): ProjectMapForest {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const declared = new Map<string, string[]>();
  const rooted: string[] = [];
  for (const shape of shapes) {
    const parent = shape.parent;
    if (parent === null || parent === shape.id || !byId.has(parent)) {
      rooted.push(shape.id);
      continue;
    }
    const siblings = declared.get(parent);
    if (siblings) siblings.push(shape.id);
    else declared.set(parent, [shape.id]);
  }

  const roots: string[] = [];
  const order: string[] = [];
  const kidsOf = new Map<string, string[]>();
  const depthOf = new Map<string, number>();
  const seen = new Set<string>();

  const walk = (rootId: string) => {
    roots.push(rootId);
    seen.add(rootId);
    depthOf.set(rootId, 0);
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) break;
      order.push(id);
      const depth = depthOf.get(id) ?? 0;
      // Anything already seen is an ancestor or belongs to another tree, so
      // claiming it here is what would turn the walk into a loop.
      const kids = (declared.get(id) ?? []).filter((kid) => !seen.has(kid));
      kidsOf.set(id, kids);
      for (const kid of kids) {
        seen.add(kid);
        depthOf.set(kid, depth + 1);
      }
      // Reversed, so siblings pop back off the stack in input order.
      for (let index = kids.length - 1; index >= 0; index -= 1) {
        stack.push(kids[index]);
      }
    }
  };

  for (const id of rooted) walk(id);
  for (const shape of shapes) {
    if (!seen.has(shape.id)) walk(shape.id);
  }

  return { roots, kidsOf, order, depthOf, byId };
}

function sumOf(ids: string[], values: Map<string, number>): number {
  return ids.reduce((total, id) => total + (values.get(id) ?? 0), 0);
}

/**
 * Stacked-extent Reingold-Tilford over the mind-map forest.
 *
 * Each subtree is given a band across the direction of growth, sibling bands
 * are laid end to end, and a node is centred on its own band — which is what
 * makes a parent read as belonging to the children under it. Depth sets the
 * position along the axis.
 */
export function layoutProjectMapTree(
  shapes: ProjectMapShape[],
  options: ProjectMapAutoLayoutOptions,
): Map<string, { x: number; y: number }> {
  const movable = shapes.filter((shape) => !isFixedShape(shape));
  const forest = buildProjectMapForest(movable);
  const axis = GROWTH_AXES[options.direction ?? "right"];

  // Post-order: a band is only known once every child's band is.
  const band = new Map<string, number>();
  for (let index = forest.order.length - 1; index >= 0; index -= 1) {
    const id = forest.order[index];
    const shape = forest.byId.get(id);
    if (shape === undefined) continue;
    const subtree = sumOf(forest.kidsOf.get(id) ?? [], band);
    // The largest of the three, not just the subtree sum: a node taller than
    // everything below it still needs room for its own box, or the next
    // sibling subtree would be drawn on top of it.
    band.set(
      id,
      Math.max(axis.cross(shape) + CROSS_GUTTER, axis.minBand, subtree),
    );
  }

  // Pre-order: a band can only be divided once it has been allocated.
  const bandStart = new Map<string, number>();
  let rootCursor = 0;
  for (const id of forest.roots) {
    bandStart.set(id, rootCursor);
    rootCursor += band.get(id) ?? 0;
  }
  for (const id of forest.order) {
    const kids = forest.kidsOf.get(id) ?? [];
    const subtree = sumOf(kids, band);
    // Centred in the parent's band, which is wider than its children whenever
    // the parent's own box is what set it.
    let cursor = (bandStart.get(id) ?? 0) + ((band.get(id) ?? 0) - subtree) / 2;
    for (const kid of kids) {
      bandStart.set(kid, cursor);
      cursor += band.get(kid) ?? 0;
    }
  }

  const maxDepth = forest.order.reduce(
    (deepest, id) => Math.max(deepest, forest.depthOf.get(id) ?? 0),
    0,
  );
  const widestAtDepth = Array.from({ length: maxDepth + 1 }, () => 0);
  for (const id of forest.order) {
    const shape = forest.byId.get(id);
    if (shape === undefined) continue;
    const depth = forest.depthOf.get(id) ?? 0;
    widestAtDepth[depth] = Math.max(widestAtDepth[depth], axis.along(shape));
  }
  // A running total rather than `depth * pitch`. With a per-depth extent a
  // multiple of one depth's width says nothing about where the previous depth
  // ended, so a narrow depth following a wide one would be drawn inside it.
  const alongAtDepth = Array.from({ length: maxDepth + 1 }, () => 0);
  let alongCursor = 0;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    alongAtDepth[depth] = alongCursor;
    alongCursor += widestAtDepth[depth] + ALONG_GUTTER;
  }

  const relative = new Map<string, { x: number; y: number }>();
  for (const id of forest.order) {
    const shape = forest.byId.get(id);
    if (shape === undefined) continue;
    const depth = forest.depthOf.get(id) ?? 0;
    const centre = (bandStart.get(id) ?? 0) + (band.get(id) ?? 0) / 2;
    relative.set(
      id,
      axis.point(alongAtDepth[depth], centre - axis.cross(shape) / 2),
    );
  }

  return anchorArrangement(
    relative,
    movable,
    options.origin,
    shapes.filter(isFixedShape),
  );
}

/**
 * The same forest, spread around a centre.
 *
 * A subtree's share of its parent's wedge is its leaf count, because leaves
 * are what a reader actually counts around the rim; depth becomes the radius.
 */
export function layoutProjectMapRadial(
  shapes: ProjectMapShape[],
  options: ProjectMapAutoLayoutOptions,
): Map<string, { x: number; y: number }> {
  const movable = shapes.filter((shape) => !isFixedShape(shape));
  const forest = buildProjectMapForest(movable);

  // Post-order again: a wedge is shared out by leaf count, which is only known
  // from below.
  const weight = new Map<string, number>();
  for (let index = forest.order.length - 1; index >= 0; index -= 1) {
    const id = forest.order[index];
    const kids = forest.kidsOf.get(id) ?? [];
    weight.set(id, kids.length === 0 ? 1 : sumOf(kids, weight));
  }

  // One root sits at the centre. Several cannot — they would be drawn on top
  // of one another — so they share the first ring instead.
  const ringOffset = forest.roots.length === 1 ? 0 : 1;

  const wedge = new Map<string, { start: number; span: number }>();
  const rootWeight = sumOf(forest.roots, weight);
  let rootCursor = 0;
  for (const id of forest.roots) {
    const span =
      rootWeight === 0 ? 0 : (TAU * (weight.get(id) ?? 1)) / rootWeight;
    wedge.set(id, { start: rootCursor, span });
    rootCursor += span;
  }
  for (const id of forest.order) {
    const own = wedge.get(id);
    const kids = forest.kidsOf.get(id) ?? [];
    if (own === undefined || kids.length === 0) continue;
    const kidWeight = sumOf(kids, weight);
    let cursor = own.start;
    for (const kid of kids) {
      const span =
        kidWeight === 0 ? 0 : (own.span * (weight.get(kid) ?? 1)) / kidWeight;
      wedge.set(kid, { start: cursor, span });
      cursor += span;
    }
  }

  const relative = new Map<string, { x: number; y: number }>();
  for (const id of forest.order) {
    const shape = forest.byId.get(id);
    const own = wedge.get(id);
    if (shape === undefined || own === undefined) continue;
    const radius =
      ((forest.depthOf.get(id) ?? 0) + ringOffset) * RADIAL_RING_PITCH;
    const angle = own.start + own.span / 2;
    // The ring carries the shape's centre, not its corner, or a wide shape
    // would hang off its own ring and the spokes would stop lining up.
    relative.set(id, {
      x: Math.cos(angle) * radius - shape.width / 2,
      y: Math.sin(angle) * radius - shape.height / 2,
    });
  }

  return anchorArrangement(
    relative,
    movable,
    options.origin,
    shapes.filter(isFixedShape),
  );
}

/** Separator for an edge key. A shape id is `shape-<base36>`, so it has no bar. */
const EDGE_KEY_SEPARATOR = "|";

function edgeKey(from: string, to: string): string {
  return `${from}${EDGE_KEY_SEPARATOR}${to}`;
}

function pushInto(index: Map<string, string[]>, key: string, value: string) {
  const existing = index.get(key);
  if (existing) existing.push(value);
  else index.set(key, [value]);
}

/**
 * Layers read off the lines the user drew: Sugiyama-lite.
 *
 * Cycles are broken by dropping the back-edges a depth-first walk finds, and
 * only from the layering input — a dropped line still pulls its two ends
 * together when the order inside a layer is decided. Layers then come from the
 * longest path to a node, and the order within each layer from the barycentre
 * of the neighbours already placed in the layer being read, swept down and up
 * twice.
 *
 * It is approximate, and the three things a real implementation adds are worth
 * naming so nobody mistakes this for one: dummy nodes, so an edge spanning
 * several layers is routed through placeholders instead of across whatever sits
 * between its ends; the priority method, so the coordinate pass can straighten
 * long chains by letting heavier nodes push lighter ones aside; and orthogonal
 * edge routing, which this module cannot do at all because it returns
 * positions and never touches a connector.
 *
 * Only a connector with *both* ends attached to a shape in the input can say
 * anything about layers. A line to a pinned shape, to a derived node or to a
 * free point is ignored, because the thing at the other end is not ours to
 * place.
 */
export function layoutProjectMapLayered(
  shapes: ProjectMapShape[],
  options: ProjectMapAutoLayoutOptions,
): Map<string, { x: number; y: number }> {
  const movable = shapes.filter((shape) => !isFixedShape(shape));
  const byId = new Map(movable.map((shape) => [shape.id, shape]));
  const ids = movable.map((shape) => shape.id);

  const edges: { from: string; to: string }[] = [];
  const known = new Set<string>();
  for (const connector of options.connectors ?? []) {
    const { from, to } = connector;
    if (from.attach !== "shape" || to.attach !== "shape") continue;
    if (!byId.has(from.shape) || !byId.has(to.shape)) continue;
    if (from.shape === to.shape) continue;
    const key = edgeKey(from.shape, to.shape);
    // A second line between the same pair says nothing new about order, and
    // counting it twice would quietly double its pull on the barycentre.
    if (known.has(key)) continue;
    known.add(key);
    edges.push({ from: from.shape, to: to.shape });
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) pushInto(outgoing, edge.from, edge.to);

  // Depth-first back-edges. An edge reaching a node still open on the current
  // path is the one closing a cycle, so it is the one to leave out.
  const OPEN = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const backEdges = new Set<string>();
  for (const root of ids) {
    if (state.has(root)) continue;
    state.set(root, OPEN);
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const kids = outgoing.get(frame.id) ?? [];
      if (frame.next >= kids.length) {
        state.set(frame.id, DONE);
        stack.pop();
        continue;
      }
      const next = kids[frame.next];
      frame.next += 1;
      if (state.get(next) === OPEN) backEdges.add(edgeKey(frame.id, next));
      else if (!state.has(next)) {
        state.set(next, OPEN);
        stack.push({ id: next, next: 0 });
      }
    }
  }

  // Longest-path layering over what is left, which is now a DAG, so the queue
  // drains: a node is enqueued exactly when its last incoming edge is spent.
  const forward = edges.filter(
    (edge) => !backEdges.has(edgeKey(edge.from, edge.to)),
  );
  const forwardOut = new Map<string, string[]>();
  const pending = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of forward) {
    pushInto(forwardOut, edge.from, edge.to);
    pending.set(edge.to, (pending.get(edge.to) ?? 0) + 1);
  }
  const layerOf = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => (pending.get(id) ?? 0) === 0);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const next of forwardOut.get(id) ?? []) {
      layerOf.set(
        next,
        Math.max(layerOf.get(next) ?? 0, (layerOf.get(id) ?? 0) + 1),
      );
      const left = (pending.get(next) ?? 1) - 1;
      pending.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  const depth = ids.reduce(
    (deepest, id) => Math.max(deepest, layerOf.get(id) ?? 0),
    0,
  );
  const layers: string[][] = Array.from(
    { length: ids.length === 0 ? 0 : depth + 1 },
    () => [],
  );
  for (const id of ids) layers[layerOf.get(id) ?? 0].push(id);

  // Ordering reads every line, including the back-edges layering ignored: the
  // line is still drawn, so its two ends should still end up near each other.
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    pushInto(neighbours, edge.from, edge.to);
    pushInto(neighbours, edge.to, edge.from);
  }

  const placeIn = new Map<string, number>();
  const reindex = () => {
    for (const layer of layers) {
      layer.forEach((id, index) => placeIn.set(id, index));
    }
  };
  reindex();
  const sortByBarycentre = (target: number, against: number) => {
    const members = new Set(layers[against]);
    const keyed = layers[target].map((id, current) => {
      const near = (neighbours.get(id) ?? []).filter((other) =>
        members.has(other),
      );
      // Nothing in the layer being read has an opinion about this node, so it
      // keeps the place it already had instead of being swept to one end.
      const barycentre =
        near.length === 0
          ? current
          : near.reduce(
              (total, other) => total + (placeIn.get(other) ?? 0),
              0,
            ) / near.length;
      return { id, current, barycentre };
    });
    keyed.sort(
      (left, right) =>
        left.barycentre - right.barycentre || left.current - right.current,
    );
    layers[target] = keyed.map((entry) => entry.id);
    reindex();
  };
  for (let pass = 0; pass < BARYCENTRE_PASSES; pass += 1) {
    for (let index = 1; index < layers.length; index += 1) {
      sortByBarycentre(index, index - 1);
    }
    for (let index = layers.length - 2; index >= 0; index -= 1) {
      sortByBarycentre(index, index + 1);
    }
  }

  // Layers run left to right, like the tree's default direction, so a reader
  // who switches between the two arrangements keeps the same sense of flow.
  const relative = new Map<string, { x: number; y: number }>();
  let alongCursor = 0;
  for (const layer of layers) {
    let crossCursor = 0;
    for (const id of layer) {
      const shape = byId.get(id);
      if (shape === undefined) continue;
      const slot = Math.max(shape.height + CROSS_GUTTER, PROJECT_MAP_ROW_PITCH);
      relative.set(id, {
        x: alongCursor,
        y: crossCursor + (slot - shape.height) / 2,
      });
      crossCursor += slot;
    }
    const widest = layer.reduce(
      (width, id) => Math.max(width, byId.get(id)?.width ?? 0),
      0,
    );
    alongCursor += widest + ALONG_GUTTER;
  }

  return anchorArrangement(
    relative,
    movable,
    options.origin,
    shapes.filter(isFixedShape),
  );
}

/**
 * The arrangement the view asked for, as positions by shape id.
 *
 * `free` returns nothing on purpose: under it every position belongs to the
 * user, so the honest answer to "arrange this" is to move nothing at all.
 */
export function layoutProjectMapShapes(
  shapes: ProjectMapShape[],
  options: ProjectMapAutoLayoutOptions,
): Map<string, { x: number; y: number }> {
  switch (options.kind) {
    case "tree":
      return layoutProjectMapTree(shapes, options);
    case "radial":
      return layoutProjectMapRadial(shapes, options);
    case "layered":
      return layoutProjectMapLayered(shapes, options);
    case "free":
    default:
      return new Map();
  }
}
