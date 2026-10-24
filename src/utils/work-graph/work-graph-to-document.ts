/**
 * The work graph, drawn on the project map's canvas.
 *
 * The canvas already knows how to draw a graph of plates and lines, pan it,
 * select it and annotate it. A second renderer would be a second set of
 * bugs — so the work graph is projected onto the shapes the canvas already
 * has, rather than the canvas being taught a second vocabulary.
 *
 * That projection is a deliberate loan of meaning, and it is worth stating
 * plainly: a cycle is drawn with the silhouette of a scheduled job, an agent
 * with a service's, a repository with a directory's. The kinds are not the
 * same thing; the shapes are a visual alphabet the reader already knows, and
 * the legend says which is which.
 *
 * Nothing here is ever serialized. The work layer is assembled live on every
 * fetch, and writing run status into a committed document would churn the
 * repository on every poll and put deployment identity into source control.
 */

import type {
  PlacedProjectMapNode,
  ProjectMapDerivedLayer,
  ProjectMapEdge,
  ProjectMapEdgeKind,
  ProjectMapNodeKind,
} from "#/types/project-map";
import type {
  MergedWorkGraph,
  MergedWorkGraphNode,
} from "#/utils/work-graph/work-graph-merge";
import type { WorkGraphEdgeKind } from "#/types/work-graph";

/** Which silhouette each kind of work borrows. */
const NODE_SHAPE: Record<string, ProjectMapNodeKind> = {
  backend: "external",
  program: "job",
  run: "job",
  "run-tombstone": "job",
  cycle: "module",
  agent: "service",
  repository: "dir",
  artifact: "endpoint",
  source: "external",
  suggestion: "table",
};

/**
 * Which line style each relationship borrows.
 *
 * The canvas reads a dash pattern as "how real is this at runtime" and an
 * arrow head as "what travels along it". The loan keeps that grammar:
 * scheduling and claiming are control, so they route; building and producing
 * move an artifact, so they write; reading evidence reads.
 */
const EDGE_STYLE: Record<WorkGraphEdgeKind, ProjectMapEdgeKind> = {
  hosts: "imports",
  schedules: "routes-to",
  claims: "routes-to",
  targets: "calls",
  builds: "calls",
  delegates: "calls",
  "forked-from": "imports",
  produces: "writes",
  reviews: "reads",
  cites: "reads",
  disputes: "reads",
  verifies: "reads",
  proposes: "publishes",
};

/** Plate size scales with `size`, so weight has to mean something here. */
const NODE_WEIGHT: Record<string, number> = {
  backend: 600,
  program: 900,
  cycle: 700,
  agent: 500,
  run: 300,
  "run-tombstone": 200,
  repository: 800,
  artifact: 300,
  source: 200,
  suggestion: 250,
};

/** Columns, left to right: the order work actually happens in. */
const COLUMN_ORDER = [
  "backend",
  "program",
  "run",
  "run-tombstone",
  "cycle",
  "agent",
  "artifact",
  "repository",
  "source",
  "suggestion",
];

const COLUMN_PITCH = 420;
const ROW_PITCH = 150;

/**
 * Where a node sits: a column for its kind, a row for its position in it.
 *
 * Deliberately not a general graph layout. Work has a shape — a program
 * schedules a run which claims a cycle which is built and reviewed — and
 * putting each kind in its own column makes that shape readable at a glance,
 * which no force-directed arrangement of the same nodes manages.
 */
function place(nodes: MergedWorkGraphNode[]): PlacedProjectMapNode[] {
  const byColumn = new Map<string, MergedWorkGraphNode[]>();
  for (const node of nodes) {
    const column = byColumn.get(node.kind) ?? [];
    column.push(node);
    byColumn.set(node.kind, column);
  }

  const placed: PlacedProjectMapNode[] = [];
  COLUMN_ORDER.forEach((kind, columnIndex) => {
    const column = (byColumn.get(kind) ?? []).sort((left, right) =>
      // Newest first down the column, so the work a reader came to see is at
      // the top rather than wherever it happened to be fetched.
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
    column.forEach((node, rowIndex) => {
      placed.push({
        id: node.key,
        kind: NODE_SHAPE[node.kind] ?? "module",
        label: node.label,
        path: null,
        group: null,
        summary: describe(node),
        size: NODE_WEIGHT[node.kind] ?? 400,
        x: columnIndex * COLUMN_PITCH,
        y: rowIndex * ROW_PITCH,
        pinned: false,
        hidden: false,
        tags: [node.kind, node.status],
      });
    });
  });
  return placed;
}

/** One line a reader can act on, from whatever the node happens to carry. */
function describe(node: MergedWorkGraphNode): string {
  const parts: string[] = [node.status.replace("_", " ")];
  const verdict = node.attrs.verdict;
  if (typeof verdict === "string" && verdict) parts.push(verdict.toLowerCase());
  const runtime = node.attrs.runtime;
  if (typeof runtime === "string" && runtime) parts.push(runtime);
  const summary = node.attrs.summary;
  if (typeof summary === "string" && summary) parts.push(summary);
  return parts.join(" · ");
}

export function workGraphToDerivedLayer(
  graph: MergedWorkGraph,
): ProjectMapDerivedLayer {
  const nodes = place(graph.nodes);
  const present = new Set(nodes.map((node) => node.id));
  const edges: ProjectMapEdge[] = graph.edges
    // An edge to something not on the paper would be drawn to nowhere; the
    // merge already reports those, so dropping them here hides nothing.
    .filter((edge) => present.has(edge.from) && present.has(edge.to))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: EDGE_STYLE[edge.kind] ?? "calls",
      label: null,
    }));
  return { id: "work", nodes, edges, groups: [] };
}

/** The conversation behind an agent node, when it has one. */
export function conversationIdOf(node: MergedWorkGraphNode): string | null {
  const id = node.attrs.conversation_id;
  return typeof id === "string" && id ? id : null;
}
