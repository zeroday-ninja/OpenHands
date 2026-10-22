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
 * | `generated_at` `commit`    | analysis | replaced     |
 *
 * The node *set* belongs to the analysis: a file that no longer exists leaves
 * the map, even if it was pinned. Keeping it would mean the map asserts
 * something about the repository that is not true, which is the one thing a
 * committed document must never do.
 */

import {
  PROJECT_MAP_VERSION,
  type ProjectMapDocument,
  type ProjectMapGroup,
  type ProjectMapNode,
  type ProjectMapNote,
} from "#/types/project-map";
import { ensureProjectMapLayout } from "./project-map-layout";

export interface ProjectMapMergeResult {
  document: ProjectMapDocument;
  /** Nodes this analysis introduced; the page can point them out. */
  addedNodeIds: string[];
  /** Nodes this analysis no longer reports, and the map therefore drops. */
  removedNodeIds: string[];
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

  return {
    addedNodeIds,
    removedNodeIds,
    document: ensureProjectMapLayout({
      version: PROJECT_MAP_VERSION,
      generated_at: incoming.generated_at,
      commit: incoming.commit,
      groups,
      nodes,
      edges: incoming.edges,
      notes: mergeNotes(previous.notes, incoming.notes, incomingIds),
    }),
  };
}
