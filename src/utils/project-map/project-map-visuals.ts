/**
 * The map's visual grammar.
 *
 * The drawing is an engineering plate, not a node editor: hairline ink on
 * paper, no shadows, no gradients. That gives the two properties the feature
 * needs most.
 *
 * **Silhouette carries meaning.** Every node kind gets its own outline — a
 * folder tab, a pennant, a cylinder, a dashed pill — so a reader can tell a
 * data store from a route at a glance, without reading a label and without
 * spending the colour budget on kinds. Colour is left for grouping, which is
 * the thing the reader arranged by hand.
 *
 * **Line style carries relationship.** Edge kind reads on two axes a person
 * can learn in one sitting: the dash pattern says how real the relationship
 * is at runtime (dashed = structural, solid = something happens), and the
 * head says what travels along it.
 *
 * Arrow heads are drawn as ordinary paths rather than SVG `<marker>`s, because
 * a marker cannot take the per-edge accent colour without either
 * `context-stroke` or an inline `color` style, and this file would rather
 * compute six points than depend on either.
 */

import {
  type ProjectMapEdgeKind,
  type ProjectMapNodeKind,
} from "#/types/project-map";

/** How many accents the theme palette offers. See `--oh-map-accent-*`. */
export const PROJECT_MAP_ACCENT_COUNT = 6;

/**
 * The accent series as CSS token references. Indexed, never inlined as a
 * colour, so a committed document follows light and dark themes.
 */
const ACCENT_TOKENS = [
  "var(--color-map-accent-1)",
  "var(--color-map-accent-2)",
  "var(--color-map-accent-3)",
  "var(--color-map-accent-4)",
  "var(--color-map-accent-5)",
  "var(--color-map-accent-6)",
] as const;

/**
 * Which accent a group uses, as a 1-based palette index.
 *
 * A declared index wins, wrapping rather than failing so a hand-edited `"9"`
 * still draws. With nothing usable declared, the group id is hashed: a stable,
 * distinguishable colour beats everything collapsing onto accent 1, and the
 * user can always set one explicitly.
 */
export function resolveProjectMapAccent(
  accent: string | null | undefined,
  seed: string,
): number {
  const declared =
    accent === null || accent === undefined ? NaN : Number(accent.trim());
  if (Number.isInteger(declared) && declared > 0) {
    return ((declared - 1) % PROJECT_MAP_ACCENT_COUNT) + 1;
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1_000_003;
  }
  return (hash % PROJECT_MAP_ACCENT_COUNT) + 1;
}

/** The CSS token reference for a 1-based accent index. */
export function projectMapAccentToken(accent: number): string {
  const index = Math.max(
    1,
    Math.min(PROJECT_MAP_ACCENT_COUNT, Math.round(accent)),
  );
  return ACCENT_TOKENS[index - 1];
}

export interface ProjectMapSilhouette {
  /** The node's outline, as an SVG path starting at its own origin. */
  outline: string;
  /** An inner rule that completes the shape — a title bar, a cylinder rim. */
  detail: string | null;
  /** Outlines that are drawn dashed, for things outside the repository. */
  dashed: boolean;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The outline for a node kind, sized to `width` × `height` and drawn from the
 * node's own origin so the canvas only has to translate a group.
 */
export function projectMapSilhouette(
  kind: ProjectMapNodeKind,
  width: number,
  height: number,
): ProjectMapSilhouette {
  const w = round(width);
  const h = round(height);
  const rect = `M0 0H${w}V${h}H0Z`;

  switch (kind) {
    // A folder: containment, drawn the way every filing system draws it.
    case "dir": {
      const tabWidth = round(Math.min(w * 0.4, 72));
      const tabHeight = 8;
      return {
        outline: `M0 0H${tabWidth}L${round(tabWidth + 9)} ${tabHeight}H${w}V${h}H0Z`,
        detail: null,
        dashed: false,
      };
    }
    // A pennant: something arrives here, so the left edge is notched like a
    // flag tail rather than squared off.
    case "route":
      return {
        outline: `M0 0H${w}V${h}H0L13 ${round(h / 2)}Z`,
        detail: `M13 ${round(h / 2)}L0 0M13 ${round(h / 2)}L0 ${h}`,
        dashed: false,
      };
    // A window with a title bar: the thing a person actually sees.
    case "component":
      return { outline: rect, detail: `M0 13H${w}`, dashed: false };
    // A connector, clipped on opposite corners so it reads as in-line.
    case "hook": {
      const clip = 11;
      return {
        outline: `M${clip} 0H${w}V${round(h - clip)}L${round(w - clip)} ${h}H0V${clip}Z`,
        detail: null,
        dashed: false,
      };
    }
    // A process: pointed both ends, work passing through.
    case "service": {
      const point = 15;
      return {
        outline: `M${point} 0H${round(w - point)}L${w} ${round(h / 2)}L${round(w - point)} ${h}H${point}L0 ${round(h / 2)}Z`,
        detail: null,
        dashed: false,
      };
    }
    // A cylinder: the universal glyph for stored state.
    case "store": {
      const rim = 8;
      const rx = round(w / 2);
      return {
        outline: `M0 ${rim}A${rx} ${rim} 0 0 1 ${w} ${rim}V${round(h - rim)}A${rx} ${rim} 0 0 1 0 ${round(h - rim)}Z`,
        detail: `M0 ${rim}A${rx} ${rim} 0 0 0 ${w} ${rim}`,
        dashed: false,
      };
    }
    // Stacked rows: a table is rows, so the shape has rows.
    case "table":
      return {
        outline: rect,
        detail: `M0 ${round(h / 3)}H${w}M0 ${round((h * 2) / 3)}H${w}`,
        dashed: false,
      };
    // A pipe mouth: the far end is open to the world.
    case "endpoint": {
      const radius = round(h / 2);
      return {
        outline: `M0 0H${round(w - radius)}A${radius} ${radius} 0 0 1 ${round(w - radius)} ${h}H0Z`,
        detail: null,
        dashed: false,
      };
    }
    // A ticket: clipped on the trailing edge, something that gets taken.
    case "job": {
      const clip = 12;
      return {
        outline: `M0 0H${round(w - clip)}L${w} ${clip}V${round(h - clip)}L${round(w - clip)} ${h}H0Z`,
        detail: null,
        dashed: false,
      };
    }
    // Outside our walls: fully rounded, and the only dashed outline.
    case "external": {
      const radius = round(h / 2);
      return {
        outline: `M${radius} 0H${round(w - radius)}A${radius} ${radius} 0 0 1 ${round(w - radius)} ${h}H${radius}A${radius} ${radius} 0 0 1 ${radius} 0Z`,
        detail: null,
        dashed: true,
      };
    }
    case "module":
    default:
      return { outline: rect, detail: null, dashed: false };
  }
}

/** What an arrow head looks like, and therefore what travels along the line. */
export type ProjectMapEdgeHead = "none" | "open" | "filled" | "diamond";

export interface ProjectMapEdgeStyle {
  /** SVG `stroke-dasharray`, or null for a solid line. */
  dash: string | null;
  head: ProjectMapEdgeHead;
  /** Stroke width multiplier; the canvas scales it with zoom. */
  weight: number;
}

const EDGE_STYLES: Record<ProjectMapEdgeKind, ProjectMapEdgeStyle> = {
  // Structural, not runtime: dashed, and no head, because nothing travels.
  imports: { dash: "4 3", head: "none", weight: 1 },
  // Runtime containment: solid, hollow head.
  renders: { dash: null, head: "open", weight: 1 },
  // Runtime invocation: solid, filled head.
  calls: { dash: null, head: "filled", weight: 1.25 },
  // Data pulled: dotted, and a diamond because the effect is on the reader.
  reads: { dash: "1 4", head: "diamond", weight: 1 },
  // Data pushed: dotted, filled head, heavier — writes are the ones that bite.
  writes: { dash: "1 4", head: "filled", weight: 1.5 },
  // A URL resolving: solid and heavy, the map's strongest line.
  "routes-to": { dash: null, head: "filled", weight: 1.75 },
  // Broadcast: dash-dot, because the far end is not named here.
  publishes: { dash: "7 2 1 2", head: "filled", weight: 1 },
};

export function projectMapEdgeStyle(
  kind: ProjectMapEdgeKind,
): ProjectMapEdgeStyle {
  return EDGE_STYLES[kind];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EdgeDirection = "right" | "left" | "down" | "up";

export interface ProjectMapEdgeGeometry {
  /** The routed line. */
  d: string;
  /** Where the head sits, and which way it points. */
  tip: { x: number; y: number };
  direction: EdgeDirection;
  /** Midpoint of the run, for an edge label. */
  label: { x: number; y: number };
}

/**
 * An orthogonal run between two nodes, leaving and arriving at a side
 * midpoint.
 *
 * Right angles rather than curves: a plate drawing is read by following lines,
 * and a dozen overlapping beziers is exactly the picture this feature exists
 * to replace. The dominant axis decides which pair of sides to use, so the
 * line leaves in the direction it is actually going.
 */
export function projectMapEdgeGeometry(
  from: Rect,
  to: Rect,
): ProjectMapEdgeGeometry {
  const fromCenter = {
    x: from.x + from.width / 2,
    y: from.y + from.height / 2,
  };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const goingRight = dx >= 0;
    const start = {
      x: goingRight ? from.x + from.width : from.x,
      y: fromCenter.y,
    };
    const end = { x: goingRight ? to.x : to.x + to.width, y: toCenter.y };
    const middle = round((start.x + end.x) / 2);
    return {
      d: `M${round(start.x)} ${round(start.y)}H${middle}V${round(end.y)}H${round(end.x)}`,
      tip: { x: round(end.x), y: round(end.y) },
      direction: goingRight ? "right" : "left",
      label: { x: middle, y: round((start.y + end.y) / 2) },
    };
  }

  const goingDown = dy >= 0;
  const start = {
    x: fromCenter.x,
    y: goingDown ? from.y + from.height : from.y,
  };
  const end = { x: toCenter.x, y: goingDown ? to.y : to.y + to.height };
  const middle = round((start.y + end.y) / 2);
  return {
    d: `M${round(start.x)} ${round(start.y)}V${middle}H${round(end.x)}V${round(end.y)}`,
    tip: { x: round(end.x), y: round(end.y) },
    direction: goingDown ? "down" : "up",
    label: { x: round((start.x + end.x) / 2), y: middle },
  };
}

/** How far back from the tip a head reaches, in diagram units. */
const HEAD_LENGTH = 9;
const HEAD_HALF_WIDTH = 4;

/**
 * The arrow head as a path, pointing the way the line arrives. Returns null
 * for a headless edge so the caller renders nothing rather than an empty path.
 */
export function projectMapEdgeHeadPath(
  head: ProjectMapEdgeHead,
  tip: { x: number; y: number },
  direction: EdgeDirection,
): string | null {
  if (head === "none") return null;
  const along =
    direction === "right"
      ? { x: -1, y: 0 }
      : direction === "left"
        ? { x: 1, y: 0 }
        : direction === "down"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  const across = { x: -along.y, y: along.x };
  const base = {
    x: tip.x + along.x * HEAD_LENGTH,
    y: tip.y + along.y * HEAD_LENGTH,
  };
  const left = {
    x: base.x + across.x * HEAD_HALF_WIDTH,
    y: base.y + across.y * HEAD_HALF_WIDTH,
  };
  const right = {
    x: base.x - across.x * HEAD_HALF_WIDTH,
    y: base.y - across.y * HEAD_HALF_WIDTH,
  };
  if (head === "diamond") {
    const far = {
      x: tip.x + along.x * HEAD_LENGTH * 2,
      y: tip.y + along.y * HEAD_LENGTH * 2,
    };
    return `M${round(tip.x)} ${round(tip.y)}L${round(left.x)} ${round(left.y)}L${round(far.x)} ${round(far.y)}L${round(right.x)} ${round(right.y)}Z`;
  }
  return `M${round(tip.x)} ${round(tip.y)}L${round(left.x)} ${round(left.y)}L${round(right.x)} ${round(right.y)}Z`;
}
