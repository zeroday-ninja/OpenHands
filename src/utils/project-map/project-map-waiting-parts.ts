/**
 * Which parts of the map a parked change touches.
 *
 * A change that stopped to ask a person names the files it changed, in its
 * own words, inside the changeover plan it carries. Rather than parse that
 * prose — the wording is the automation's to choose — this asks the opposite
 * question: does this part's path appear anywhere in what the change said
 * about itself? A full repository-relative path appearing in that text means
 * the change is about that file, and a path that does not appear marks
 * nothing.
 *
 * The map is of one folder, so a change about another repository is ignored
 * even when the two share a filename.
 */

import type { ImproveCycle } from "#/types/improve";
import type { PlacedProjectMapDocument } from "#/types/project-map";

/** Short paths match too much prose to be evidence of anything. */
const SHORTEST_PATH = 5;

/** Everything a parked change wrote about itself, as one body of text. */
function saidAboutItself(cycle: ImproveCycle): string {
  const plan = cycle.parked_plan ?? null;
  return [
    cycle.summary ?? "",
    cycle.parked_question ?? "",
    plan?.rollback ?? "",
    ...(plan?.breaks ?? []),
    ...(plan?.consumers ?? []),
    ...(plan?.sequence ?? []),
  ].join("\n");
}

/** Whether a parked change is about the repository this map is of. */
export function projectMapCycleIsAbout(
  cycle: ImproveCycle,
  repository: string,
): boolean {
  const name = repository.trim().toLowerCase();
  if (name === "") return false;
  return [cycle.repository.label, cycle.repository.url].some(
    (said) => typeof said === "string" && said.toLowerCase().includes(name),
  );
}

/**
 * Node id to the id of the parked change that names it. A node named by more
 * than one keeps the first, because the mark says "a change waits on you
 * here", and which one is the rail's answer to give.
 */
export function projectMapWaitingParts(
  document: PlacedProjectMapDocument,
  cycles: readonly ImproveCycle[],
  repository: string | null,
): Map<string, string> {
  const marked = new Map<string, string>();
  if (repository === null) return marked;
  const mine = cycles.filter((cycle) =>
    projectMapCycleIsAbout(cycle, repository),
  );
  if (mine.length === 0) return marked;

  const texts = mine.map(
    (cycle) => [cycle.id, saidAboutItself(cycle)] as const,
  );
  for (const node of document.nodes) {
    const path = node.path;
    if (path === null || path.length < SHORTEST_PATH) continue;
    const named = texts.find(([, text]) => text.includes(path));
    if (named !== undefined) marked.set(node.id, named[0]);
  }
  return marked;
}

/** How many marked parts each layer holds, for the overview. */
export function projectMapWaitingLayers(
  document: PlacedProjectMapDocument,
  parts: ReadonlyMap<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of document.nodes) {
    if (node.group === null || !parts.has(node.id)) continue;
    counts.set(node.group, (counts.get(node.group) ?? 0) + 1);
  }
  return counts;
}
