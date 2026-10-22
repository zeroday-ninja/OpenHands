/**
 * The answer, beside the canvas.
 *
 * This renders the conversation the pane is bound to with the same components
 * `/conversations/:conversationId` uses — `Messages` for the event stream and
 * `PendingUserMessages` for what has been sent but not echoed — so an action
 * card, a thought, a grouped run of tool calls and a streamed reply all look
 * here exactly as they do there. Nothing about how a conversation renders is
 * reimplemented; only the frame around it is this page's.
 *
 * It also closes the loop back to the drawing. An answer that says
 * `src/stores/events.ts` is naming something on the map, and
 * `findProjectMapMentions` can tell which node that is — so each mention
 * becomes a control that selects that node, which puts it in the inspector and
 * in the context block for the next message. Reading an explanation and
 * pointing at the thing it is about stop being two separate activities.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { Messages } from "#/components/conversation-events/chat/messages";
import { parseMessageFromEvent } from "#/components/conversation-events/chat/event-content-helpers/parse-message-from-event";
import { getActionContent } from "#/components/conversation-events/chat/event-content-helpers/get-action-content";
import { PendingUserMessages } from "#/components/features/chat/pending-user-messages";
import { ScrollProvider, useScrollContext } from "#/context/scroll-context";
import { useFilteredEvents } from "#/hooks/use-filtered-events";
import { useProjectMapStore } from "#/stores/project-map-store";
import type { OpenHandsEvent } from "#/types/agent-server/core";
import {
  isActionEvent,
  isMessageEvent,
} from "#/types/agent-server/type-guards";
import type { PlacedProjectMapDocument } from "#/types/project-map";
import { findProjectMapMentions } from "#/utils/project-map/project-map-context";
import {
  PROJECT_MAP_BUTTON_CLASS,
  PROJECT_MAP_SECTION_LABEL_CLASS,
} from "./project-map-controls";

/**
 * The text of one event, if it is the agent talking to the user.
 *
 * Both shapes are here because both are how an answer actually arrives: the
 * OpenHands agent finishes a turn with an assistant `MessageEvent`, while an
 * ACP agent (Claude Code, Codex, …) ends it with a `FinishAction` carrying the
 * reply. Reading only the first would leave the mentions row permanently empty
 * on every ACP profile, which is what the map is most often driven by.
 */
function agentAnswerIn(event: OpenHandsEvent): string | null {
  if (isMessageEvent(event) && event.llm_message.role === "assistant") {
    const text = parseMessageFromEvent(event);
    return text.trim() === "" ? null : text;
  }
  if (isActionEvent(event) && event.action.kind === "FinishAction") {
    const text = getActionContent(event);
    return text.trim() === "" ? null : text;
  }
  return null;
}

/**
 * The most recent thing the agent said, which is the text the mentions are
 * read from. Only the latest answer is scanned: a chip row rebuilt from the
 * whole history would accumulate every node ever named and stop meaning
 * anything.
 */
function latestAgentAnswer(events: OpenHandsEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const text = agentAnswerIn(events[index]);
    if (text !== null) return text;
  }
  return null;
}

export interface ProjectMapTranscriptProps {
  document: PlacedProjectMapDocument;
}

export function ProjectMapTranscript({
  document: map,
}: ProjectMapTranscriptProps) {
  const { t } = useTranslation("openhands");
  const { renderableEvents, allConversationEvents } = useFilteredEvents();
  const setSelection = useProjectMapStore((state) => state.setSelection);

  const mentions = React.useMemo(() => {
    const answer = latestAgentAnswer(allConversationEvents);
    return answer === null ? [] : findProjectMapMentions(answer, map);
  }, [allConversationEvents, map]);

  return (
    <div className="flex flex-col gap-2">
      <ScrollProvider>
        <TranscriptBody
          renderableEvents={renderableEvents}
          allConversationEvents={allConversationEvents}
        />
      </ScrollProvider>

      {mentions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
            {t(I18nKey.PROJECT_MAP$MENTIONED_TITLE)}
          </span>
          <ul
            data-testid="project-map-mentions"
            className="flex flex-wrap gap-1.5"
          >
            {mentions.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  data-testid={`project-map-mention-${node.id}`}
                  aria-label={t(I18nKey.PROJECT_MAP$SELECT_MENTIONED, {
                    label: node.label,
                  })}
                  className={PROJECT_MAP_BUTTON_CLASS}
                  onClick={() => setSelection([node.id])}
                >
                  <span className="truncate">{node.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Separate from the component above only because the scroll ref it attaches
 * comes from the provider that wraps it. `ScrollProvider` is what plan
 * previews and the rest of the shared chat rendering expect to find above
 * them, and it carries the "stick to the bottom while new events arrive"
 * behaviour the chat already has.
 */
function TranscriptBody({
  renderableEvents,
  allConversationEvents,
}: {
  renderableEvents: OpenHandsEvent[];
  allConversationEvents: OpenHandsEvent[];
}) {
  const { t } = useTranslation("openhands");
  const { scrollRef, onChatBodyScroll } = useScrollContext();

  return (
    <div
      ref={scrollRef}
      data-testid="project-map-transcript"
      onScroll={(event) => onChatBodyScroll(event.currentTarget)}
      className="custom-scrollbar flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border border-border-subtle bg-surface p-2"
    >
      {renderableEvents.length === 0 ? (
        <p className="text-xs text-muted">
          {t(I18nKey.PROJECT_MAP$TRANSCRIPT_EMPTY)}
        </p>
      ) : (
        <Messages
          messages={renderableEvents}
          allEvents={allConversationEvents}
        />
      )}
      <PendingUserMessages />
    </div>
  );
}
