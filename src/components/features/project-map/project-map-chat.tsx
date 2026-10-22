/**
 * The chat beside the canvas, sharing its selection.
 *
 * The selection appears as removable chips and, under a disclosure, as the
 * exact text that will be sent. Showing the real block rather than a
 * reassuring summary is the whole difference between this feeling precise and
 * feeling like magic: you can read what the agent is told before you send it,
 * and take a node out of it if it is not part of the question.
 *
 * The first send opens a conversation in this workspace with that message as
 * its first turn, and `ProjectMapConversation` binds it to the pane; every
 * send after that goes into that conversation over its WebSocket, the same way
 * the conversation route's composer does. Either way the user stays on the
 * map, which is the point: the agent can edit
 * `.openhands/project-map.json`, so "group these three" is a thing you can
 * simply ask for and then watch happen on the canvas in front of you.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Send, X } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { useSendMessage } from "#/hooks/use-send-message";
import { createChatMessage } from "#/services/chat-service";
import { useOptimisticUserMessageStore } from "#/stores/optimistic-user-message-store";
import { useProjectMapStore } from "#/stores/project-map-store";
import type { PlacedProjectMapDocument } from "#/types/project-map";
import {
  buildProjectMapLaunchMessage,
  buildProjectMapQuestionMessage,
  type ProjectMapIntent,
} from "#/utils/project-map/project-map-context";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import {
  PROJECT_MAP_BUTTON_CLASS,
  PROJECT_MAP_CHIP_CLASS,
  PROJECT_MAP_PRIMARY_BUTTON_CLASS,
} from "./project-map-controls";

const ICON_SIZE = 13;

/** Kinds whose redesign is a visual job, so the design skill is worth seeding. */
const REDESIGNABLE_KINDS = new Set(["component", "route"]);

export interface ProjectMapChatProps {
  document: PlacedProjectMapDocument;
  /**
   * Absolute path of the open map, named in the context block so the
   * conversation this starts can find the file. It does not run where the
   * page reads: see `ProjectMapContextOptions`.
   */
  mapPath: string;
  /**
   * The conversation already bound to the pane, or null when the next send
   * has to start one.
   */
  conversationId: string | null;
  /** Called with the id of the conversation a send just created. */
  onConversationStarted: (conversationId: string) => void;
}

export function ProjectMapChat({
  document: map,
  mapPath,
  conversationId,
  onConversationStarted,
}: ProjectMapChatProps) {
  const { t } = useTranslation("openhands");
  const selection = useProjectMapStore((state) => state.selection);
  const removeFromSelection = useProjectMapStore(
    (state) => state.toggleInSelection,
  );
  const clearSelection = useProjectMapStore((state) => state.clearSelection);
  const createConversation = useCreateConversation();
  // Null outside a conversation provider, which is the unbound case — where
  // the branch below never reaches it.
  const { send } = useSendMessage();
  const enqueuePendingMessage = useOptimisticUserMessageStore(
    (state) => state.enqueuePendingMessage,
  );
  const [question, setQuestion] = React.useState("");
  const [showContext, setShowContext] = React.useState(false);

  const selected = map.nodes.filter((node) => selection.includes(node.id));
  const contextOptions = { commit: map.commit, mapPath };
  const preview = buildProjectMapQuestionMessage(
    question,
    selected,
    contextOptions,
  );
  const canRedesign =
    selected.length > 0 &&
    selected.every((node) => REDESIGNABLE_KINDS.has(node.kind));

  /**
   * Into the bound conversation when there is one, otherwise into a new one
   * bound to the pane. Both stay on the map; neither navigates.
   */
  const submit = async (message: string) => {
    if (message.trim() === "") return;
    if (conversationId !== null) {
      // The same two steps the conversation composer takes: show the bubble
      // immediately, then send. The echoed message event drains the bubble.
      setQuestion("");
      enqueuePendingMessage({ conversationId, text: message });
      await send(createChatMessage(message, [], [], new Date().toISOString()));
      return;
    }
    try {
      const conversation = await createConversation.mutateAsync({
        query: message,
      });
      setQuestion("");
      onConversationStarted(conversation.conversation_id);
    } catch {
      // The mutation's own toast covers the request; this keeps a thrown
      // launch from leaving an unhandled rejection behind. A launch that
      // failed is not a save that failed — nothing was being written.
      displayErrorToast(t(I18nKey.PROJECT_MAP$LAUNCH_FAILED));
    }
  };

  const submitIntent = (intent: ProjectMapIntent) =>
    submit(buildProjectMapLaunchMessage(intent, selected, contextOptions));

  return (
    <div data-testid="project-map-chat" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="project-map-ask"
          className={PROJECT_MAP_BUTTON_CLASS}
          disabled={selected.length === 0 || createConversation.isPending}
          onClick={() => void submitIntent("ask")}
        >
          {t(I18nKey.PROJECT_MAP$ASK_ABOUT)}
        </button>
        <button
          type="button"
          data-testid="project-map-change"
          className={PROJECT_MAP_BUTTON_CLASS}
          disabled={selected.length === 0 || createConversation.isPending}
          onClick={() => void submitIntent("change")}
        >
          {t(I18nKey.PROJECT_MAP$CHANGE_THIS)}
        </button>
        {canRedesign && (
          <button
            type="button"
            data-testid="project-map-redesign"
            className={PROJECT_MAP_BUTTON_CLASS}
            disabled={createConversation.isPending}
            onClick={() => void submitIntent("redesign")}
          >
            {t(I18nKey.PROJECT_MAP$REDESIGN_THIS)}
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <ul
            data-testid="project-map-selection-chips"
            className="flex flex-wrap gap-1.5"
          >
            {selected.map((node) => (
              <li key={node.id} className={PROJECT_MAP_CHIP_CLASS}>
                <span className="truncate">{node.label}</span>
                <button
                  type="button"
                  aria-label={t(I18nKey.PROJECT_MAP$REMOVE_FROM_SELECTION, {
                    label: node.label,
                  })}
                  className="text-muted transition-colors hover:text-foreground"
                  onClick={() => removeFromSelection(node.id)}
                >
                  <X size={ICON_SIZE} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="self-start text-xs text-muted underline-offset-2 hover:underline"
            onClick={clearSelection}
          >
            {t(I18nKey.PROJECT_MAP$CLEAR_SELECTION)}
          </button>
        </div>
      )}

      <textarea
        data-testid="project-map-composer"
        aria-label={t(I18nKey.PROJECT_MAP$CHAT_PLACEHOLDER)}
        placeholder={t(I18nKey.PROJECT_MAP$CHAT_PLACEHOLDER)}
        rows={3}
        value={question}
        className="w-full resize-y rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          void submit(preview);
        }}
      />

      <button
        type="button"
        data-testid="project-map-send"
        className={PROJECT_MAP_PRIMARY_BUTTON_CLASS}
        disabled={preview.trim() === "" || createConversation.isPending}
        onClick={() => void submit(preview)}
      >
        <Send size={ICON_SIZE} aria-hidden />
        {/* The label names what the press actually does: the first one opens a
            conversation, every one after that sends into the one already
            beside the map. */}
        {createConversation.isPending
          ? t(I18nKey.PROJECT_MAP$STARTING_CONVERSATION)
          : conversationId !== null
            ? t(I18nKey.BUTTON$SEND)
            : t(I18nKey.PROJECT_MAP$CHAT_SEND)}
      </button>

      <details
        open={showContext}
        onToggle={(event) => setShowContext(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs text-text-secondary">
          {t(I18nKey.PROJECT_MAP$CHAT_CONTEXT_TOGGLE)}
        </summary>
        <pre
          data-testid="project-map-context-preview"
          className="mt-2 max-h-56 overflow-auto rounded border border-border-subtle bg-surface-deep p-2 font-mono text-micro whitespace-pre-wrap text-text-secondary custom-scrollbar"
        >
          {preview}
        </pre>
      </details>

      <p className="text-xs leading-relaxed text-muted">
        {conversationId !== null
          ? t(I18nKey.PROJECT_MAP$CHAT_HINT_BOUND)
          : t(I18nKey.PROJECT_MAP$CHAT_HINT)}
      </p>
    </div>
  );
}
