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
  PlacedProjectMapNode,
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
  /**
   * Where those parts live, in the repository's own words: the folder they
   * all share and, inside it, whatever holds the most of them —
   * `server/{research/, engine.js}` — or the fullest root entries when they
   * share no folder. A layer's name is the analysis's invention; its folders
   * are what a maintainer recognises first. Empty for a layer with no parts.
   */
  where: string;
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

/** How many folders a block names; the rest are the detail level's. */
const FOLDERS_PER_BLOCK = 3;

/**
 * The leading folders every path shares — `src/` in most repositories —
 * which say nothing about any one layer and are stripped before naming.
 */
function sharedLeadingFolders(paths: string[]): string {
  if (paths.length === 0) return "";
  const first = paths[0].split("/").slice(0, -1);
  let shared = first.length;
  for (const path of paths.slice(1)) {
    const parts = path.split("/").slice(0, -1);
    let same = 0;
    while (same < shared && same < parts.length && parts[same] === first[same])
      same += 1;
    shared = same;
    if (shared === 0) break;
  }
  return shared === 0 ? "" : `${first.slice(0, shared).join("/")}/`;
}

/** The first folder (or lone file) under `prefix` in each path, counted. */
function namesUnder(paths: string[], prefix: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : `${rest.slice(0, slash)}/`;
    if (name === "") continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** Fullest first; folders before lone files; then by name. */
function byFullness(
  [a, countA]: [string, number],
  [b, countB]: [string, number],
): number {
  return (
    countB - countA ||
    Number(b.endsWith("/")) - Number(a.endsWith("/")) ||
    a.localeCompare(b)
  );
}

/**
 * Where a layer's parts live, `shared` being the folders every path in the
 * document has in common (`src/`, usually), stripped first because they say
 * nothing about any one layer. A layer whose parts all sit under one folder
 * is named by it, and by the folders inside it where they differ —
 * `server/{research/, engine/}` — or by the folder alone when nothing inside
 * it is a folder. A layer spread over the root names the fullest root
 * folders, then lone files. At most three names either way.
 */
export function projectMapOverviewWhere(
  paths: string[],
  shared: string,
): string {
  const relative = paths.map((path) =>
    path.startsWith(shared) ? path.slice(shared.length) : path,
  );
  if (relative.length === 0) return "";
  const own = sharedLeadingFolders(relative);
  const names = [...namesUnder(relative, own).entries()]
    .sort(byFullness)
    .map(([name]) => name);
  const inside = names.slice(0, FOLDERS_PER_BLOCK);
  if (own === "") return inside.join(", ");
  if (inside.length === 0) return own;
  if (inside.length === 1) return `${own}${inside[0]}`;
  return `${own}{${inside.join(", ")}}`;
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
  const pathOf = (node: PlacedProjectMapNode): string[] =>
    node.path === null ? [] : [node.path];
  const shared = sharedLeadingFolders(visible.flatMap(pathOf));
  const blocks = document.groups.map((group, index) => ({
    group,
    count: visible.filter((node) => groupOf.get(node.id) === group.id).length,
    where: projectMapOverviewWhere(
      visible
        .filter((node) => groupOf.get(node.id) === group.id)
        .flatMap(pathOf),
      shared,
    ),
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
