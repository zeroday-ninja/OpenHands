import type { Automation } from "#/types/automation";
import {
  IMPROVE_PRESET_TYPE,
  type ImproveCycle,
  type ImproveCycleRepository,
  type ImproveVerdict,
} from "#/types/improve";
import { displayUrlFor } from "#/utils/git-sync-repo-url";

/**
 * An improvement program is an ordinary automation: the only thing that marks
 * one is `preset_metadata.preset_type`, which the service stamps when the
 * program is created. Read it in one place so the detail page, the dashboard
 * and any future entry point agree on what counts as a program.
 */
export function isImprovementProgram(automation: Automation): boolean {
  const metadata = automation.preset_metadata;
  if (typeof metadata !== "object" || metadata === null) return false;
  return (
    (metadata as Record<string, unknown>).preset_type === IMPROVE_PRESET_TYPE
  );
}

/** The dashboard for one program. */
export function improveProgramPath(automationId: string): string {
  return `/automations/improve/${automationId}`;
}

/**
 * How a rotation entry is named: its Git Sync label when it has one,
 * otherwise its repository URL without embedded credentials.
 */
export function improveRepositoryDisplayName(
  repository: Pick<ImproveCycleRepository, "label" | "url">,
): string {
  return repository.label.trim() || displayUrlFor(repository.url);
}

/**
 * The verdict each repository most recently earned, keyed by repository URL.
 *
 * The rotation response carries only the single newest cycle, so a per-
 * repository verdict has to come from the history. Cycles arrive newest
 * first, so the first one seen for a URL is its latest; a cycle that has not
 * concluded yet contributes nothing rather than hiding the last real verdict.
 * The URL is the key because a Git Sync label can be renamed between cycles.
 */
export function lastVerdictByRepository(
  cycles: ImproveCycle[],
): Map<string, ImproveVerdict> {
  const verdicts = new Map<string, ImproveVerdict>();
  for (const cycle of cycles) {
    const { url } = cycle.repository;
    if (cycle.verdict !== null && !verdicts.has(url)) {
      verdicts.set(url, cycle.verdict);
    }
  }
  return verdicts;
}

/**
 * Where a merge commit can be read, when the forge is one we know the path for.
 *
 * Only GitHub: every forge spells a commit path differently, and a guessed
 * link that 404s is worse than the SHA on its own, which is still enough to
 * run `git show`. A SHA with nowhere to point is rendered as text.
 */
export function improveCommitUrl(
  repositoryUrl: string,
  sha: string,
): string | null {
  if (!sha.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    return null;
  }
  if (
    parsed.hostname !== "github.com" &&
    parsed.hostname !== "www.github.com"
  ) {
    return null;
  }
  const path = parsed.pathname.replace(/\.git$/, "").replace(/\/+$/, "");
  if (!path || path === "/") return null;
  return `https://github.com${path}/commit/${encodeURIComponent(sha.trim())}`;
}
