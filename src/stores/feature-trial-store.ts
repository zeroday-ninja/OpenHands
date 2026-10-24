/**
 * What this installation has done with each feature the app shipped itself.
 *
 * Local on purpose. The existing analytics are consent-gated and point at
 * OpenHands' own project, so the improvement loop that shipped a feature
 * cannot read back whether anyone used it — which makes them useless for the
 * one question that matters here. This ledger answers it without sending
 * anything anywhere.
 *
 * `localStorage` rather than a store on the server, because the question is
 * "did *this person* reach for it", and a per-backend answer would make the
 * same feature look unused on every new machine.
 */

import { create } from "zustand";
import {
  emptyFeatureTrialRecord,
  type FeatureTrialRecord,
} from "#/types/feature-trial";

const STORAGE_KEY = "openhands-feature-trials";

/**
 * Longest a comment is kept. A comment is a correction in the user's own
 * words, and this is well past the length of one; the bound exists so a paste
 * cannot fill the storage quota and lose the whole ledger.
 */
export const MAX_FEATURE_COMMENT = 2000;

interface FeatureTrialState {
  records: Record<string, FeatureTrialRecord>;
  /** Mark a feature as reached for. Called from the feature itself. */
  markUsed: (id: string) => void;
  markAnnounced: (id: string) => void;
  rate: (id: string, rating: "up" | "down", comment?: string | null) => void;
  /** Replace a record wholesale, for a rating that reached the service. */
  recordOf: (id: string) => FeatureTrialRecord;
}

function read(): Record<string, FeatureTrialRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const records: Record<string, FeatureTrialRecord> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
      if (!value || typeof value !== "object") return;
      // Merged onto an empty record rather than trusted: this is
      // user-writable storage, and a missing field read as undefined would
      // make `useCount + 1` produce NaN and silently stop counting.
      records[id] = {
        ...emptyFeatureTrialRecord(id),
        ...(value as Partial<FeatureTrialRecord>),
        id,
      };
      if (typeof records[id].useCount !== "number") records[id].useCount = 0;
    });
    return records;
  } catch {
    // Unparseable storage is an empty ledger, not a broken app. The cost is
    // one feature looking unused; the alternative is the page not rendering.
    return {};
  }
}

function write(records: Record<string, FeatureTrialRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // A full quota must not throw out of a click handler. The in-memory
    // ledger still answers for this session.
  }
}

export const useFeatureTrialStore = create<FeatureTrialState>((set, get) => ({
  records: read(),

  recordOf: (id) => get().records[id] ?? emptyFeatureTrialRecord(id),

  markUsed: (id) =>
    set((state) => {
      const now = new Date().toISOString();
      const current = state.records[id] ?? emptyFeatureTrialRecord(id);
      const next = {
        ...current,
        firstUsedAt: current.firstUsedAt ?? now,
        lastUsedAt: now,
        useCount: current.useCount + 1,
      };
      const records = { ...state.records, [id]: next };
      write(records);
      return { records };
    }),

  markAnnounced: (id) =>
    set((state) => {
      const current = state.records[id] ?? emptyFeatureTrialRecord(id);
      // Not overwritten: the first time it was shown is the date that says
      // how long the feature has had to prove itself.
      if (current.announcedAt) return state;
      const records = {
        ...state.records,
        [id]: { ...current, announcedAt: new Date().toISOString() },
      };
      write(records);
      return { records };
    }),

  rate: (id, rating, comment) =>
    set((state) => {
      const current = state.records[id] ?? emptyFeatureTrialRecord(id);
      const records = {
        ...state.records,
        [id]: {
          ...current,
          rating,
          ratedAt: new Date().toISOString(),
          // A rating never waits for a comment, and changing a rating does
          // not erase the comment that explained the last one.
          comment: comment?.slice(0, MAX_FEATURE_COMMENT) || current.comment,
        },
      };
      write(records);
      return { records };
    }),
}));

/** Reset the ledger. Exported for tests, which must not leak into each other. */
export function clearFeatureTrials(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  useFeatureTrialStore.setState({ records: {} });
}
