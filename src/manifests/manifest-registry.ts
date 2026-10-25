/**
 * Registry of admitted setup manifests.
 *
 * Stage 1 of the setup flow: load the catalog, decide which entries this host
 * will act on, and index the survivors by id. An entry that fails admission is
 * dropped entirely rather than rendered partially, because everything
 * downstream treats its content as instructions.
 *
 * Dropped, but not forgotten. A refusal used to be a `console.warn` and
 * nothing else, so the setup page for a refused entry fell through to the
 * automation lookup and told the reader there was no such automation — which
 * is a different claim from "the catalog published this and we would not run
 * it". The rejections travel with the registry so the page can say which.
 */

import { hasSetupBlock, validateSetupEntry } from "./manifest-validation";
import type { SetupEntry } from "./types";

/** A catalog entry this host would not act on, and why. */
export interface SetupRejection {
  /** The entry's own id, when it had a usable one. */
  readonly id: string | null;
  readonly reason: string;
}

export interface SetupRegistry {
  /** Entries this host has admitted, in source order. */
  readonly entries: readonly SetupEntry[];
  /** Entries it refused, in source order. Empty is the normal case. */
  readonly rejections: readonly SetupRejection[];
  findById(id: string): SetupEntry | null;
  /**
   * Why this id is not in `entries`, or `null` if nothing claimed it.
   *
   * The distinction a caller needs: an id nobody published is a dead link, an
   * id that was published and refused is a package defect, and the two read
   * identically without this.
   */
  rejectionFor(id: string): SetupRejection | null;
}

export function createSetupRegistry(
  candidates: readonly unknown[],
): SetupRegistry {
  const entries: SetupEntry[] = [];
  const byId = new Map<string, SetupEntry>();
  const rejections: SetupRejection[] = [];

  candidates.forEach((candidate) => {
    // A catalog entry without a setup block is a card, not a setup experience.
    // That is the normal case, so it is skipped rather than reported.
    if (!hasSetupBlock(candidate)) return;

    const { valid, errors } = validateSetupEntry(candidate);
    if (!valid) {
      const reason = errors.join("; ");
      console.warn("Rejected a setup manifest:", reason);
      // The id is read off the raw candidate deliberately: it may be the one
      // field that *was* valid, and it is the only thing that lets the page
      // for that id explain itself.
      rejections.push({ id: idOf(candidate), reason });
      return;
    }

    const entry = candidate as SetupEntry;
    if (byId.has(entry.id)) {
      const reason = `id "${entry.id}" is already registered`;
      console.warn(`Rejected a setup manifest: ${reason}`);
      rejections.push({ id: entry.id, reason });
      return;
    }

    entries.push(entry);
    byId.set(entry.id, entry);
  });

  return {
    entries,
    rejections,
    findById: (id) => byId.get(id) ?? null,
    rejectionFor: (id) =>
      rejections.find((rejection) => rejection.id === id) ?? null,
  };
}

/** A candidate's `id`, when it has a usable one. */
function idOf(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== "object") return null;
  const id = (candidate as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}
