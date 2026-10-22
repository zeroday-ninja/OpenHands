/**
 * Reading the map as a graph: what is visible, what is adjacent, and what the
 * keyboard should reach next.
 *
 * Collapsing a group is modelled here rather than in the canvas, because it
 * changes the graph and not just the painting: the group becomes one node and
 * every edge that crossed its boundary has to arrive at the group instead.
 * Keeping that in one pure place is what stops a collapsed group from quietly
 * losing edges.
 */

import type {
  PlacedProjectMapDocument,
  PlacedProjectMapNode,
  ProjectMapEdge,
  ProjectMapEdgeKind,
} from "#/types/project-map";
import { projectMapNodeSize } from "./project-map-layout";

/** Prefix for the synthetic node a collapsed group draws as. */
export const PROJECT_MAP_GROUP_NODE_PREFIX = "group:";

export function projectMapGroupNodeId(groupId: string): string {
  return `${PROJECT_MAP_GROUP_NODE_PREFIX}${groupId}`;
}

export interface ProjectMapNeighbors {
  inbound: ProjectMapEdge[];
  outbound: ProjectMapEdge[];
}

/** The edges touching one node, split by direction, for the inspector list. */
export function projectMapNeighbors(
  edges: ProjectMapEdge[],
  nodeId: string,
): ProjectMapNeighbors {
  return {
    inbound: edges.filter((edge) => edge.to === nodeId),
    outbound: edges.filter((edge) => edge.from === nodeId),
  };
}

/**
 * The ids that stay fully lit while something is selected: the selection plus
 * everything directly wired to it. Everything else fades — which is how a
 * diagram this dense is actually read, one neighbourhood at a time.
 */
export function projectMapFocusIds(
  selectedIds: readonly string[],
  edges: ProjectMapEdge[],
): Set<string> {
  const selected = new Set(selectedIds);
  if (selected.size === 0) return selected;
  // Adjacency is measured against the selection itself, never against the
  // growing result: one more hop per edge would light the whole component.
  const focus = new Set(selected);
  for (const edge of edges) {
    if (selected.has(edge.from)) focus.add(edge.to);
    if (selected.has(edge.to)) focus.add(edge.from);
  }
  return focus;
}

export interface ProjectMapRenderEdge extends ProjectMapEdge {
  /** Stable key; a collapsed group can fold several edges onto one run. */
  key: string;
}

export interface ProjectMapRenderModel {
  nodes: PlacedProjectMapNode[];
  /** One synthetic node per collapsed group, drawn as a single plate. */
  collapsedGroupIds: string[];
  edges: ProjectMapRenderEdge[];
}

/**
 * What the canvas should draw.
 *
 * Hidden nodes leave entirely — hiding is how a user says "this is noise", and
 * a hidden node that still trails edges has not been hidden. Nodes in a
 * collapsed group are replaced by the group, edges that stayed inside it
 * disappear with it, and edges that crossed its boundary are redirected and
 * de-duplicated so the collapsed plate shows one line per relationship rather
 * than a fan of identical ones.
 */
export function projectMapRenderModel(
  document: PlacedProjectMapDocument,
): ProjectMapRenderModel {
  const collapsedGroupIds = document.groups
    .filter((group) => group.collapsed)
    .map((group) => group.id);
  const collapsed = new Set(collapsedGroupIds);

  const visible = document.nodes.filter((node) => !node.hidden);
  const byId = new Map(visible.map((node) => [node.id, node]));

  const resolve = (nodeId: string): string | null => {
    const node = byId.get(nodeId);
    if (!node) return null;
    if (node.group !== null && collapsed.has(node.group)) {
      return projectMapGroupNodeId(node.group);
    }
    return node.id;
  };

  const seen = new Set<string>();
  const edges: ProjectMapRenderEdge[] = [];
  for (const edge of document.edges) {
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    if (from === null || to === null || from === to) continue;
    const key = `${from}\u0000${to}\u0000${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...edge, key, from, to });
  }

  return {
    collapsedGroupIds,
    edges,
    nodes: visible.filter(
      (node) => node.group === null || !collapsed.has(node.group),
    ),
  };
}

/** The kinds present in a document, for the legend, in canonical order. */
export function projectMapEdgeKindsInUse(
  edges: ProjectMapEdge[],
  order: readonly ProjectMapEdgeKind[],
): ProjectMapEdgeKind[] {
  const present = new Set(edges.map((edge) => edge.kind));
  return order.filter((kind) => present.has(kind));
}

export type ProjectMapArrowDirection = "left" | "right" | "up" | "down";

/**
 * The node an arrow key should move to: the nearest one in that direction on
 * screen.
 *
 * Arrows mean "over there" on a drawing, so they move spatially; walking the
 * graph is what the inspector's edge list is for. Candidates are scored by
 * distance along the pressed axis plus a penalty for drifting off it, so a
 * node straight ahead always beats a closer one well off to the side.
 */
export function projectMapArrowTarget(
  nodes: PlacedProjectMapNode[],
  fromId: string,
  direction: ProjectMapArrowDirection,
): string | null {
  const origin = nodes.find((node) => node.id === fromId);
  if (!origin) return nodes[0]?.id ?? null;
  const centerOf = (node: PlacedProjectMapNode) => {
    const { width, height } = projectMapNodeSize(node.size);
    return { x: node.x + width / 2, y: node.y + height / 2 };
  };
  const start = centerOf(origin);

  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    if (node.id === fromId) continue;
    const center = centerOf(node);
    const forward =
      direction === "right"
        ? center.x - start.x
        : direction === "left"
          ? start.x - center.x
          : direction === "down"
            ? center.y - start.y
            : start.y - center.y;
    if (forward <= 0) continue;
    const sideways =
      direction === "right" || direction === "left"
        ? Math.abs(center.y - start.y)
        : Math.abs(center.x - start.x);
    const score = forward + sideways * 2;
    if (best === null || score < best.score) best = { id: node.id, score };
  }
  return best?.id ?? null;
}
