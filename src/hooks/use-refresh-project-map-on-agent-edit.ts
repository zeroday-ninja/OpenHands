import React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { stripRedundantTitlePrefix } from "#/components/conversation-events/chat/event-content-helpers/get-acp-tool-call-content";
import { PROJECT_MAP_QUERY_KEYS } from "#/hooks/query/query-keys";
import { useEventStore, type OHEvent } from "#/stores/use-event-store";
import { isACPToolCallEvent } from "#/types/agent-server/type-guards";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";

/**
 * The OpenHands agent's file-editor tools, whose observations name the path
 * they wrote.
 *
 * Bash observations are deliberately not watched: their `command` is a whole
 * shell line, so deciding whether it wrote the map would mean guessing, and
 * guessing wrong in the "yes" direction re-reads the file for every command
 * the agent runs.
 */
const FILE_EDITOR_OBSERVATION_KINDS = new Set([
  "FileEditorObservation",
  "StrReplaceEditorObservation",
]);

/** The one file-editor command that reads instead of writing. */
const READ_ONLY_COMMAND = "view";

function pathsFromObservation(event: OHEvent): string[] {
  const observation = (
    event as {
      observation?: { kind?: string; command?: string; path?: string | null };
    }
  ).observation;
  if (!observation || typeof observation.kind !== "string") return [];
  if (!FILE_EDITOR_OBSERVATION_KINDS.has(observation.kind)) return [];
  if (observation.command === READ_ONLY_COMMAND) return [];
  return typeof observation.path === "string" ? [observation.path] : [];
}

/**
 * Paths an ACP agent's edit names.
 *
 * ACP servers — Claude Code, Codex, Gemini CLI — do not emit the OpenHands
 * observation at all; an edit arrives as an `ACPToolCallEvent` of kind
 * `"edit"`. Three places can carry the path and which ones are populated is up
 * to the server, so all three are read: the diff blocks on `content`, the
 * server's own `raw_input`, and the title, which the SDK documents as "the
 * path being edited".
 */
function pathsFromACPEdit(event: OHEvent): string[] {
  if (!isACPToolCallEvent(event)) return [];
  if (event.tool_kind !== "edit") return [];
  // A started event precedes the terminal one; reading the file then would
  // read it before the write landed.
  if (event.status !== null && event.status !== "completed") return [];
  if (event.is_error) return [];

  const paths: string[] = [];
  for (const block of event.content ?? []) {
    const { path } = block as { path?: unknown };
    if (typeof path === "string") paths.push(path);
  }
  const rawInput = event.raw_input as
    | { file_path?: unknown; path?: unknown }
    | null
    | undefined;
  for (const candidate of [rawInput?.file_path, rawInput?.path]) {
    if (typeof candidate === "string") paths.push(candidate);
  }
  paths.push(stripRedundantTitlePrefix(event));
  return paths;
}

/**
 * True when this event is the agent reporting that it just wrote `filePath`.
 *
 * The path is compared by suffix because the two ends name it differently: the
 * agent reports an absolute path in whichever workspace it is working in — a
 * directory on the host, or `/workspace` inside its own container — and all
 * the page needs to know is that the file it wrote was the one it is showing,
 * which is to say that the path ends with `.openhands/<file>.json`.
 */
export function agentWroteFile(event: OHEvent, filePath: string): boolean {
  const paths = [...pathsFromObservation(event), ...pathsFromACPEdit(event)];
  return paths.some((path) => path.endsWith(filePath));
}

/**
 * Re-reads a workspace document when the agent writes it.
 *
 * A document two parties edit only works beside a conversation if asking for
 * a change and seeing it happen are the same moment. So the page watches the
 * conversation it hosts for a write to the file and invalidates the query that
 * reads it; nothing polls, and a conversation that never touches the file
 * never causes a read.
 *
 * Events are tracked by object reference: the store rebuilds its array on
 * every mutation but keeps element identity, and a `WeakSet` therefore handles
 * events with and without an id without inventing a key for the ones without.
 */
export function useRefreshQueryOnAgentEdit(
  filePath: string,
  queryKey: readonly unknown[],
): void {
  const queryClient = useQueryClient();
  const events = useEventStore((state) => state.events);
  const seenRef = React.useRef<WeakSet<OHEvent>>(new WeakSet());

  React.useEffect(() => {
    let wrote = false;
    for (const event of events) {
      if (!seenRef.current.has(event)) {
        seenRef.current.add(event);
        if (agentWroteFile(event, filePath)) wrote = true;
      }
    }
    if (!wrote) return;
    queryClient.invalidateQueries({ queryKey });
  }, [events, queryClient, filePath, queryKey]);
}

/**
 * Re-reads the project map when the agent writes it.
 *
 * Unsaved hand edits survive this. The query's result is handed to
 * `useProjectMapStore.hydrate`, which merges a new revision onto a dirty
 * buffer via `mergeProjectMap` — the analysis wins on facts, the user's
 * arrangement is carried over — so picking up the agent's write never costs
 * the user the moves still in their hand.
 */
export function useRefreshProjectMapOnAgentEdit(): void {
  useRefreshQueryOnAgentEdit(PROJECT_MAP_FILE_PATH, PROJECT_MAP_QUERY_KEYS.all);
}
