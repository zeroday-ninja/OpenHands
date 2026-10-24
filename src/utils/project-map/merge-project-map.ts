/**
 * Regeneration as a merge.
 *
 * This is the single rule that makes the map worth editing: a new analysis
 * replaces what the code *is* and keeps what the person *decided*. Without it,
 * every regeneration throws away the arrangement, so nobody arranges anything,
 * so the picture never becomes theirs.
 *
 * Who owns what:
 *
 * | Field                      | Owner    | On regeneration          |
 * | -------------------------- | -------- | ------------------------ |
 * | `kind` `path` `summary` `size` `tags` | analysis | replaced     |
 * | `x` `y` `pinned` `hidden` `group`     | user     | carried over |
 * | `label`                    | either   | carried over only when `label_source` is `"user"` |
 * | group `label` `accent` `collapsed`    | user     | carried over |
 * | `notes`                    | user     | carried over, re-anchored if the subject is gone |
 * | `canvas`                   | user     | carried over, always |
 * | `generated_at` `commit`    | analysis | replaced     |
 *
 * The node *set* belongs to the analysis: a file that no longer exists leaves
 * the map, even if it was pinned. Keeping it would mean the map asserts
 * something about the repository that is not true, which is the one thing a
 * committed document must never do.
 *
 * That rule is also exactly why the authored layer is a separate key rather
 * than extra nodes: drawn content must survive a regeneration that drops the
 * node it was attached to. It is carried over wholesale, and an anchor whose
 * node is gone releases the shape in place rather than deleting it.
 */

import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
  type ProjectMapCanvasLayer,
  type ProjectMapConnector,
  type ProjectMapDocument,
  type ProjectMapEndpoint,
  type ProjectMapGroup,
  type ProjectMapNode,
  type ProjectMapNote,
} from "#/types/project-map";
import {
  defaultProjectMapCanvas,
  isEmptyProjectMapCanvas,
} from "./project-map-authoring";
import { ensureProjectMapLayout } from "./project-map-layout";

export interface ProjectMapMergeResult {
  /** Every node placed, because the layout pass runs as part of the merge. */
  document: PlacedProjectMapDocument;
  /** Nodes this analysis introduced; the page can point them out. */
  addedNodeIds: string[];
  /** Nodes this analysis no longer reports, and the map therefore drops. */
  removedNodeIds: string[];
  /** Drawn shapes that stopped travelling with a node the analysis dropped. */
  releasedShapeIds: string[];
}

function carryOverNode(
  incoming: ProjectMapNode,
  previous: ProjectMapNode,
): ProjectMapNode {
  const keepsLabel = previous.label_source === "user";
  return {
    ...incoming,
    x: previous.x,
    y: previous.y,
    pinned: previous.pinned,
    hidden: previous.hidden,
    group: previous.group,
    label: keepsLabel ? previous.label : incoming.label,
    ...(keepsLabel ? { label_source: previous.label_source } : {}),
  };
}

/**
 * Groups the user still needs, which is more than the ones the analysis
 * reports: a carried-over `group` assignment points at a group the analysis
 * may never mention, and dropping it would strand the nodes in it.
 */
function mergeGroups(
  previous: ProjectMapGroup[],
  incoming: ProjectMapGroup[],
): ProjectMapGroup[] {
  const kept = new Map(previous.map((group) => [group.id, group]));
  const added = incoming.filter((group) => !kept.has(group.id));
  return [...previous, ...added];
}

function mergeNotes(
  previous: ProjectMapNote[],
  incoming: ProjectMapNote[],
  nodeIds: Set<string>,
): ProjectMapNote[] {
  const reanchored = previous.map((note) =>
    note.anchor !== null && !nodeIds.has(note.anchor)
      ? { ...note, anchor: null }
      : note,
  );
  const seen = new Set(reanchored.map((note) => note.id));
  return [...reanchored, ...incoming.filter((note) => !seen.has(note.id))];
}

/**
 * The authored layer after a regeneration.
 *
 * The user's layer wins outright: an incoming one is accepted only when the
 * previous document has nothing drawn in it, which is how an agent asked to
 * "sketch a plan on the map" can contribute without ever being able to
 * overwrite work the person did themselves.
 *
 * Anchors are re-resolved against the new node set, and only for the `code`
 * layer. A reference into a layer this document does not carry is left alone
 * for the reason stated in the parser: the live work layer always looks
 * missing from in here.
 */
function mergeCanvas(
  previous: ProjectMapCanvasLayer | undefined,
  incoming: ProjectMapCanvasLayer | undefined,
  nodeIds: Set<string>,
): { canvas: ProjectMapCanvasLayer; releasedShapeIds: string[] } {
  const kept =
    previous !== undefined && !isEmptyProjectMapCanvas(previous)
      ? previous
      : (incoming ?? previous ?? defaultProjectMapCanvas());

  const releasedShapeIds: string[] = [];
  const shapes = kept.shapes.map((shape) => {
    const resolved =
      shape.anchor?.layer !== "code" || nodeIds.has(shape.anchor.node);
    if (resolved) return shape;
    releasedShapeIds.push(shape.id);
    return { ...shape, anchor: null };
  });

  const release = (endpoint: ProjectMapEndpoint): ProjectMapEndpoint =>
    endpoint.attach === "derived" &&
    endpoint.layer === "code" &&
    !nodeIds.has(endpoint.node)
      ? { attach: "free", x: 0, y: 0 }
      : endpoint;

  const connectors: ProjectMapConnector[] = kept.connectors.map(
    (connector) => ({
      ...connector,
      from: release(connector.from),
      to: release(connector.to),
    }),
  );

  return { canvas: { view: kept.view, shapes, connectors }, releasedShapeIds };
}

export function mergeProjectMap(
  previous: ProjectMapDocument,
  incoming: ProjectMapDocument,
): ProjectMapMergeResult {
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const incomingIds = new Set(incoming.nodes.map((node) => node.id));

  const groups = mergeGroups(previous.groups, incoming.groups);
  const groupIds = new Set(groups.map((group) => group.id));

  const addedNodeIds: string[] = [];
  const nodes = incoming.nodes.map((node) => {
    const before = previousById.get(node.id);
    if (!before) {
      addedNodeIds.push(node.id);
      // A new node's incoming coordinates describe a drawing that no longer
      // exists, so they are dropped and the layout pass places it instead.
      return { ...node, x: null, y: null };
    }
    const merged = carryOverNode(node, before);
    return merged.group !== null && !groupIds.has(merged.group)
      ? { ...merged, group: null }
      : merged;
  });

  const removedNodeIds = previous.nodes
    .filter((node) => !incomingIds.has(node.id))
    .map((node) => node.id);

  const { canvas, releasedShapeIds } = mergeCanvas(
    previous.canvas,
    incoming.canvas,
    incomingIds,
  );

  return {
    addedNodeIds,
    removedNodeIds,
    releasedShapeIds,
    document: ensureProjectMapLayout({
      version: PROJECT_MAP_VERSION,
      generated_at: incoming.generated_at,
      commit: incoming.commit,
      groups,
      nodes,
      edges: incoming.edges,
      notes: mergeNotes(previous.notes, incoming.notes, incomingIds),
      canvas,
    }),
  };
}
