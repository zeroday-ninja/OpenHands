/**
 * Pure geometry for the Design canvas: where a part is in absolute canvas
 * units, where a repo group's frame is, where a wire leaves and enters a part,
 * and which things a lasso or a highlight encloses.
 *
 * Nothing here touches the DOM, which is what makes the canvas testable
 * without drawing it.
 */

import {
  WORKBENCH_PART_HEIGHT,
  WORKBENCH_PART_WIDTH,
  type WorkbenchDocument,
  type WorkbenchPart,
  type WorkbenchPoint,
  type WorkbenchRepo,
} from "#/types/workbench";

export interface WorkbenchBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Padding between a group's parts and its frame. */
export const GROUP_PADDING = 24;
/** Height of the group's title bar, which is also its drag handle. */
export const GROUP_TITLE_HEIGHT = 32;
/** Frame for a repo that has no parts yet: big enough to drop into. */
const EMPTY_GROUP_SIZE = { w: 400, h: 240 };

export interface WorkbenchViewport {
  x: number;
  y: number;
  k: number;
}

export const WORKBENCH_VIEWPORT_MIN_SCALE = 0.3;
export const WORKBENCH_VIEWPORT_MAX_SCALE = 2.5;

export function repoById(document: WorkbenchDocument, id: string) {
  return document.repos.find((repo) => repo.id === id) ?? null;
}

export function partById(document: WorkbenchDocument, id: string) {
  return document.parts.find((part) => part.id === id) ?? null;
}

/** A part's top-left corner in canvas units. */
export function partOrigin(
  part: WorkbenchPart,
  repo: WorkbenchRepo | null,
): WorkbenchPoint {
  return { x: (repo?.x ?? 0) + part.x, y: (repo?.y ?? 0) + part.y };
}

export function partCenter(
  part: WorkbenchPart,
  repo: WorkbenchRepo | null,
): WorkbenchPoint {
  const origin = partOrigin(part, repo);
  return {
    x: origin.x + WORKBENCH_PART_WIDTH / 2,
    y: origin.y + WORKBENCH_PART_HEIGHT / 2,
  };
}

export function partBox(
  part: WorkbenchPart,
  repo: WorkbenchRepo | null,
): WorkbenchBox {
  const origin = partOrigin(part, repo);
  return {
    x0: origin.x,
    y0: origin.y,
    x1: origin.x + WORKBENCH_PART_WIDTH,
    y1: origin.y + WORKBENCH_PART_HEIGHT,
  };
}

/** The frame drawn around a repo's parts, including its title bar. */
export function groupBox(
  document: WorkbenchDocument,
  repo: WorkbenchRepo,
): WorkbenchBox {
  const parts = document.parts.filter((part) => part.repoId === repo.id);
  if (parts.length === 0) {
    return {
      x0: repo.x - GROUP_PADDING,
      y0: repo.y - GROUP_TITLE_HEIGHT - GROUP_PADDING + 4,
      x1: repo.x + EMPTY_GROUP_SIZE.w,
      y1: repo.y + EMPTY_GROUP_SIZE.h,
    };
  }
  const boxes = parts.map((part) => partBox(part, repo));
  return {
    x0: Math.min(...boxes.map((b) => b.x0)) - GROUP_PADDING,
    y0:
      Math.min(...boxes.map((b) => b.y0)) -
      GROUP_TITLE_HEIGHT -
      GROUP_PADDING +
      4,
    x1: Math.max(...boxes.map((b) => b.x1)) + GROUP_PADDING,
    y1: Math.max(...boxes.map((b) => b.y1)) + GROUP_PADDING,
  };
}

export function boxContains(box: WorkbenchBox, point: WorkbenchPoint) {
  return (
    point.x >= box.x0 &&
    point.x <= box.x1 &&
    point.y >= box.y0 &&
    point.y <= box.y1
  );
}

export function boxesOverlap(a: WorkbenchBox, b: WorkbenchBox) {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/** The union of several boxes, or null for none. */
export function unionBox(boxes: WorkbenchBox[]): WorkbenchBox | null {
  if (boxes.length === 0) return null;
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** The repo whose frame contains the point, preferring the last drawn. */
export function repoAtPoint(
  document: WorkbenchDocument,
  repoIds: string[],
  point: WorkbenchPoint,
): WorkbenchRepo | null {
  const visible = document.repos.filter((repo) => repoIds.includes(repo.id));
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    if (boxContains(groupBox(document, visible[index]), point))
      return visible[index];
  }
  return null;
}

/** Where a wire from `from` towards `to` leaves `from`'s box. */
export interface WireAnchor extends WorkbenchPoint {
  horizontal: boolean;
  sign: number;
}

export function wireAnchor(from: WorkbenchBox, to: WorkbenchBox): WireAnchor {
  const cx = (from.x0 + from.x1) / 2;
  const cy = (from.y0 + from.y1) / 2;
  const dx = (to.x0 + to.x1) / 2 - cx;
  const dy = (to.y0 + to.y1) / 2 - cy;
  const w = from.x1 - from.x0;
  const h = from.y1 - from.y0;
  if (Math.abs(dx) * h > Math.abs(dy) * w) {
    return {
      x: dx > 0 ? from.x1 : from.x0,
      y: cy,
      horizontal: true,
      sign: Math.sign(dx) || 1,
    };
  }
  return {
    x: cx,
    y: dy > 0 ? from.y1 : from.y0,
    horizontal: false,
    sign: Math.sign(dy) || 1,
  };
}

/** An S-curve between two anchors, as an SVG path. */
export function wirePath(p: WireAnchor, q: WireAnchor): string {
  const c = 50;
  const c1 = p.horizontal
    ? `${p.x + p.sign * c} ${p.y}`
    : `${p.x} ${p.y + p.sign * c}`;
  const c2 = q.horizontal
    ? `${q.x + q.sign * c} ${q.y}`
    : `${q.x} ${q.y + q.sign * c}`;
  return `M${p.x} ${p.y} C ${c1}, ${c2}, ${q.x} ${q.y}`;
}

/** A closed, lightly smoothed outline through the points a hand drew. */
export function highlightPath(points: WorkbenchPoint[]): string {
  if (points.length === 0) return "";
  if (points.length < 3) {
    return `M${points.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
  }
  let d = `M${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    d += ` Q ${prev.x} ${prev.y} ${(prev.x + next.x) / 2} ${(prev.y + next.y) / 2}`;
  }
  return `${d} Z`;
}

/** Ray-casting point-in-polygon. */
export function polygonContains(
  polygon: WorkbenchPoint[],
  point: WorkbenchPoint,
) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Parts whose centre a highlight encloses. */
export function partsInsidePolygon(
  document: WorkbenchDocument,
  repoIds: string[],
  polygon: WorkbenchPoint[],
): WorkbenchPart[] {
  return document.parts.filter((part) => {
    if (!repoIds.includes(part.repoId)) return false;
    return polygonContains(
      polygon,
      partCenter(part, repoById(document, part.repoId)),
    );
  });
}

/** Parts whose box overlaps the lasso rectangle. */
export function partsInBox(
  document: WorkbenchDocument,
  repoIds: string[],
  box: WorkbenchBox,
): WorkbenchPart[] {
  const normalized: WorkbenchBox = {
    x0: Math.min(box.x0, box.x1),
    y0: Math.min(box.y0, box.y1),
    x1: Math.max(box.x0, box.x1),
    y1: Math.max(box.y0, box.y1),
  };
  return document.parts.filter(
    (part) =>
      repoIds.includes(part.repoId) &&
      boxesOverlap(partBox(part, repoById(document, part.repoId)), normalized),
  );
}

/** Screen → canvas units under a viewport. */
export function toCanvasPoint(
  viewport: WorkbenchViewport,
  screen: WorkbenchPoint,
): WorkbenchPoint {
  return {
    x: (screen.x - viewport.x) / viewport.k,
    y: (screen.y - viewport.y) / viewport.k,
  };
}

/** The viewport that frames `box` inside a stage of `width` × `height`. */
export function fitViewport(
  box: WorkbenchBox | null,
  width: number,
  height: number,
  padding = 60,
): WorkbenchViewport {
  if (box === null || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
  const w = Math.max(1, box.x1 - box.x0);
  const h = Math.max(1, box.y1 - box.y0);
  const k = Math.min(
    WORKBENCH_VIEWPORT_MAX_SCALE,
    Math.max(
      WORKBENCH_VIEWPORT_MIN_SCALE,
      Math.min((width - padding * 2) / w, (height - padding * 2) / h),
    ),
  );
  return {
    x: (width - w * k) / 2 - box.x0 * k,
    y: (height - h * k) / 2 - box.y0 * k,
    k,
  };
}

/** Zoom around a screen point, clamped. */
export function zoomViewport(
  viewport: WorkbenchViewport,
  factor: number,
  around: WorkbenchPoint,
): WorkbenchViewport {
  const k = Math.min(
    WORKBENCH_VIEWPORT_MAX_SCALE,
    Math.max(WORKBENCH_VIEWPORT_MIN_SCALE, viewport.k * factor),
  );
  const ratio = k / viewport.k;
  return {
    x: around.x - (around.x - viewport.x) * ratio,
    y: around.y - (around.y - viewport.y) * ratio,
    k,
  };
}

/** Every box the visible repos occupy, for fit-to-view. */
export function visibleBounds(
  document: WorkbenchDocument,
  repoIds: string[],
): WorkbenchBox | null {
  return unionBox(
    document.repos
      .filter((repo) => repoIds.includes(repo.id))
      .map((repo) => groupBox(document, repo)),
  );
}

/** Snap to the canvas grid. */
export const WORKBENCH_GRID = 10;
export function snap(value: number) {
  return Math.round(value / WORKBENCH_GRID) * WORKBENCH_GRID;
}

/** A free slot inside a repo for a new part: below its lowest part. */
export function nextPartSlot(
  document: WorkbenchDocument,
  repoId: string,
): WorkbenchPoint {
  const parts = document.parts.filter((part) => part.repoId === repoId);
  if (parts.length === 0) return { x: 0, y: 0 };
  const bottom = Math.max(...parts.map((part) => part.y));
  const column = parts.filter((part) => part.y === bottom).length;
  return column >= 2
    ? { x: 0, y: bottom + WORKBENCH_PART_HEIGHT + 60 }
    : { x: column * (WORKBENCH_PART_WIDTH + 40), y: bottom };
}
