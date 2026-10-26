/**
 * File an adapter's incident report as a lesson, the moment it arrives.
 *
 * This is the consumer the typed field was waiting for. An adapter that meets
 * an event it cannot translate says so in a sentence and in a field; the
 * field now arrives here as `ACPAdapterIncidentEvent`, and the first sighting
 * of each `(conversation, adapter, what, kind)` becomes a runtime-scoped
 * lesson against that adapter — "the antigravity adapter met a step it does
 * not understand" — plus a line in MEMORY.md, the same two places a
 * thumbs-down goes. A later sighting in another conversation files again and
 * the lesson service records it as a repeat: the gap is still open.
 *
 * Nobody had to notice first, which is what the plan's capture stage asks for
 * and the user asked for in as many words: OpenHands watching itself.
 */

import React from "react";
import AutomationService from "#/api/automation-service/automation-service.api";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import {
  adapterIncidentKey,
  useAdapterIncidentsStore,
} from "#/stores/adapter-incidents-store";
import { useEventStore } from "#/stores/use-event-store";
import type { ACPAdapterIncidentEvent } from "#/types/agent-server/core/events/acp-adapter-incident-event";
import { isACPAdapterIncidentEvent } from "#/types/agent-server/type-guards";
import { fileCorrectionInMemory } from "#/utils/soul/file-correction-in-memory";

/** The lesson's words. Not a person's, so they say what and where, plainly. */
export function adapterIncidentLessonText(
  event: ACPAdapterIncidentEvent,
): string {
  if (event.what === "process") {
    // The adapter's process went away under a turn. The detail is the SDK's
    // account of what it came to and its last stderr lines — the evidence
    // the next cycle on this runtime needs, kept with the lesson.
    return `The ${event.adapter} adapter's process went away mid-turn: ${event.detail}. Find out why, in the adapter.`;
  }
  const kind =
    event.unrecognised_kind === null ? "" : ` '${event.unrecognised_kind}'`;
  return `The ${event.adapter} adapter met a ${event.what} it does not understand:${kind}. Translate it, or ignore it deliberately, in the adapter.`;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useRecordAdapterIncidents(): void {
  const { conversationId } = useOptionalConversationId();
  const events = useEventStore((state) => state.events);
  const begin = useAdapterIncidentsStore((state) => state.begin);
  const settle = useAdapterIncidentsStore((state) => state.settle);

  React.useEffect(() => {
    if (!conversationId) return;
    for (const event of events) {
      if (!isACPAdapterIncidentEvent(event)) continue;
      const key = adapterIncidentKey({
        conversationId,
        adapter: event.adapter,
        what: event.what,
        kind: event.unrecognised_kind,
      });
      // Claimed synchronously, before any await, so a re-render while the
      // request is in flight cannot file the same sighting twice.
      if (useAdapterIncidentsStore.getState().records[key] !== undefined) {
        continue;
      }
      begin(key, {
        conversationId,
        adapter: event.adapter,
        what: event.what,
        kind: event.unrecognised_kind,
        at: new Date().toISOString(),
      });
      const text = adapterIncidentLessonText(event);
      void (async () => {
        try {
          const captured = await AutomationService.captureLesson({
            scope: "runtime",
            subject: event.adapter,
            trigger: "adapter_incident",
            text,
            why: `Reported by the ${event.adapter} adapter in conversation ${conversationId}.`,
            source: {
              conversation_id: conversationId,
              event_id: event.id,
              adapter: event.adapter,
              what: event.what,
              kind: event.unrecognised_kind,
            },
          });
          settle(key, { lessonId: captured.lesson.id });
          await fileCorrectionInMemory({
            lessonId: captured.lesson.id,
            scope: "runtime",
            subject: event.adapter,
            trigger: "adapter_incident",
            text,
          });
        } catch (error) {
          // Said on the notice, not only here: a lesson that was never filed
          // must not look like one that was.
          console.warn(
            "An adapter incident could not be filed as a lesson:",
            error,
          );
          settle(key, { error: describe(error) });
        }
      })();
    }
  }, [events, conversationId, begin, settle]);
}
