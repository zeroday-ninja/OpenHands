import React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { PROJECT_MAP_QUERY_KEYS } from "#/hooks/query/query-keys";
import { useEventStore, type OHEvent } from "#/stores/use-event-store";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";

/**
 * The file-editor tools, whose observations name the path they wrote.
 *
 * Bash observations are deliberately not watched: their `command` is a whole
 * shell line, so deciding whether it wrote the map would mean guessing, and
 * guessing wrong in the "yes" direction re-reads the file for every command the
 * agent runs.
 */
const FILE_EDITOR_OBSERVATION_KINDS = new Set([
  "FileEditorObservation",
  "StrReplaceEditorObservation",
]);

/** The one file-editor command that reads instead of writing. */
const READ_ONLY_COMMAND = "view";

/**
 * True when this event is the agent reporting that it just wrote the map.
 *
 * The path is compared by suffix because the two ends resolve it differently:
 * the page reads the backend's working directory, while the conversation runs
 * in a subdirectory of it, so the agent's absolute path is longer than — but
 * ends with — `.openhands/project-map.json`.
 */
function wroteTheProjectMap(event: OHEvent): boolean {
  const observation = (
    event as {
      observation?: { kind?: string; command?: string; path?: string | null };
    }
  ).observation;
  if (!observation || typeof observation.kind !== "string") return false;
  if (!FILE_EDITOR_OBSERVATION_KINDS.has(observation.kind)) return false;
  if (observation.command === READ_ONLY_COMMAND) return false;
  return (
    typeof observation.path === "string" &&
    observation.path.endsWith(PROJECT_MAP_FILE_PATH)
  );
}

/**
 * Re-reads the project map when the agent writes it.
 *
 * The map is a document two parties edit, and the whole point of putting a
 * conversation beside the canvas is that asking for a change and seeing it
 * happen are the same moment. So the page watches the conversation it hosts for
 * a write to the map file and invalidates its own query; nothing polls, and a
 * conversation that never touches the file never causes a read.
 *
 * Unsaved hand edits survive this. The query's result is handed to
 * `useProjectMapStore.hydrate`, which merges a new revision onto a dirty buffer
 * via `mergeProjectMap` — the analysis wins on facts, the user's arrangement is
 * carried over — so picking up the agent's write never costs the user the moves
 * still in their hand.
 *
 * Events are tracked by object reference: the store rebuilds its array on every
 * mutation but keeps element identity, and a `WeakSet` therefore handles events
 * with and without an id without inventing a key for the ones without.
 */
export function useRefreshProjectMapOnAgentEdit(): void {
  const queryClient = useQueryClient();
  const events = useEventStore((state) => state.events);
  const seenRef = React.useRef<WeakSet<OHEvent>>(new WeakSet());

  React.useEffect(() => {
    let wrote = false;
    for (const event of events) {
      if (!seenRef.current.has(event)) {
        seenRef.current.add(event);
        if (wroteTheProjectMap(event)) wrote = true;
      }
    }
    if (!wrote) return;
    queryClient.invalidateQueries({ queryKey: PROJECT_MAP_QUERY_KEYS.all });
  }, [events, queryClient]);
}
