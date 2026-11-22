/**
 * Which adapter incidents this installation has already filed as lessons.
 *
 * An incident is one `(conversation, adapter, what, kind)`. Filed once each:
 * the adapter already says it once per session, and the lesson service treats
 * a second filing of the same text as a repeat — which is right across
 * conversations (the same gap, still open) and wrong within one (the same
 * sighting, twice). The record also carries what filing it came to, so the
 * notice in the chat can say "recorded" or say why not, instead of nothing.
 *
 * Persisted, so a reload of a conversation whose incidents were filed does
 * not file them again.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface AdapterIncidentRecord {
  conversationId: string;
  adapter: string;
  what: string;
  kind: string | null;
  /** When the filing was attempted. */
  at: string;
  /** The lesson it became, once the automation service accepted it. */
  lessonId: string | null;
  /** Why it could not be filed, in the service's or the network's words. */
  error: string | null;
}

interface AdapterIncidentsState {
  records: Record<string, AdapterIncidentRecord>;
}

interface AdapterIncidentsActions {
  /** Claims an incident before filing it, so a re-render cannot file it twice. */
  begin: (
    key: string,
    record: Omit<AdapterIncidentRecord, "lessonId" | "error">,
  ) => void;
  settle: (
    key: string,
    outcome: { lessonId: string } | { error: string },
  ) => void;
}

export type AdapterIncidentsStore = AdapterIncidentsState &
  AdapterIncidentsActions;

/** The identity of one sighting. */
export function adapterIncidentKey(input: {
  conversationId: string;
  adapter: string;
  what: string;
  kind: string | null;
}): string {
  return [
    input.conversationId,
    input.adapter,
    input.what,
    input.kind ?? "",
  ].join("|");
}

export const useAdapterIncidentsStore = create<AdapterIncidentsStore>()(
  persist(
    (set) => ({
      records: {},
      begin: (key, record) =>
        set((state) => ({
          records: {
            ...state.records,
            [key]: { ...record, lessonId: null, error: null },
          },
        })),
      settle: (key, outcome) =>
        set((state) => {
          const current = state.records[key];
          if (current === undefined) return {};
          return {
            records: {
              ...state.records,
              [key]:
                "lessonId" in outcome
                  ? { ...current, lessonId: outcome.lessonId, error: null }
                  : { ...current, lessonId: null, error: outcome.error },
            },
          };
        }),
    }),
    {
      name: "adapter-incidents",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
