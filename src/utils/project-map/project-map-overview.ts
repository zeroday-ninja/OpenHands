/**
 * The map at the level a newcomer can read: one block per layer.
 *
 * A generated map of a real repository is a hundred-odd plates. Fitted to a
 * laptop frame they are a wall of boxes with three-pixel labels, which is the
 * first thing a person sees and the reason they say they do not understand
 * it. The overview draws the groups instead — the four to eight layers the
 * analysis named — with how many parts each holds and how many relations run
 * between them, laid out by Canvas rather than by the nodes' positions. Click
 * a layer and the detailed drawing opens on it.
 *
 * It is a view, not a document: nothing here is written to the file, so a
 * regeneration cannot disturb it and it cannot disturb the user's arrangement.
 */

import type {
  PlacedProjectMapDocument,
  ProjectMapGroup,
} from "#/types/project-map";

/** A map with more parts than this opens as its layers. */
export const PROJECT_MAP_OVERVIEW_THRESHOLD = 40;

export const PROJECT_MAP_OVERVIEW_BLOCK = { width: 260, height: 120 } as const;
/** Distance between blocks, both ways. */
export const PROJECT_MAP_OVERVIEW_GAP = 70;

export interface ProjectMapOverviewBlock {
  group: ProjectMapGroup;
  /** Visible parts in the layer. */
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectMapOverviewLink {
  from: string;
  to: string;
  /** Relations running this way between the two layers. */
  count: number;
  key: string;
}

export interface ProjectMapOverview {
  blocks: ProjectMapOverviewBlock[];
  links: ProjectMapOverviewLink[];
  /** Visible parts that belong to no layer, named rather than lost. */
  ungrouped: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Whether a map should open as its layers. Enough parts to be a wall, and at
 * least two layers for the overview to be a picture of anything.
 */
export function projectMapWantsOverview(
  document: PlacedProjectMapDocument,
): boolean {
  return (
    document.nodes.filter((node) => !node.hidden).length >
      PROJECT_MAP_OVERVIEW_THRESHOLD && document.groups.length >= 2
  );
}

/** Blocks per row: a near-square grid reads better than one long line. */
export function projectMapOverviewColumns(groups: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(groups)));
}

export function projectMapOverview(
  document: PlacedProjectMapDocument,
): ProjectMapOverview {
  const visible = document.nodes.filter((node) => !node.hidden);
  const groupIds = new Set(document.groups.map((group) => group.id));
  const groupOf = new Map(
    visible.map((node) => [
      node.id,
      node.group !== null && groupIds.has(node.group) ? node.group : null,
    ]),
  );

  const columns = projectMapOverviewColumns(document.groups.length);
  const { width, height } = PROJECT_MAP_OVERVIEW_BLOCK;
  const blocks = document.groups.map((group, index) => ({
    group,
    count: visible.filter((node) => groupOf.get(node.id) === group.id).length,
    x: (index % columns) * (width + PROJECT_MAP_OVERVIEW_GAP),
    y: Math.floor(index / columns) * (height + PROJECT_MAP_OVERVIEW_GAP),
    width,
    height,
  }));

  // Relations between layers, folded by direction. What happens inside a
  // layer is the detail level's business.
  const counts = new Map<string, ProjectMapOverviewLink>();
  for (const edge of document.edges) {
    const from = groupOf.get(edge.from);
    const to = groupOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === null || to === null || from === to) continue;
    const key = `${from}>${to}`;
    const link = counts.get(key);
    if (link) link.count += 1;
    else counts.set(key, { from, to, count: 1, key });
  }

  const last = blocks.at(-1);
  const bounds =
    last === undefined
      ? null
      : {
          x: 0,
          y: 0,
          width:
            Math.min(columns, blocks.length) *
              (width + PROJECT_MAP_OVERVIEW_GAP) -
            PROJECT_MAP_OVERVIEW_GAP,
          height: last.y + height,
        };

  return {
    blocks,
    links: [...counts.values()],
    ungrouped: visible.filter((node) => groupOf.get(node.id) === null).length,
    bounds,
  };
}
