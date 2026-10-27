/**
 * The right drawer: the conversation with the Architect or the project
 * manager, focused on whatever is selected.
 *
 * Selecting something on the canvas or the board focuses the chat on it; the
 * chips above the composer show exactly what the agent will be told, and a
 * disclosure shows the details. The first send opens a conversation in this
 * workspace and binds it to the pane; every later send goes into it over its
 * WebSocket, and the answer renders here with the same components the
 * conversation route uses. Closed, the drawer is a rail of the two personas
 * with an unread dot, so the chat is one click away without taking space.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronsLeft,
  ChevronsRight,
  Maximize2,
  MessageSquarePlus,
  Send,
  X,
} from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { Messages } from "#/components/conversation-events/chat/messages";
import { PendingUserMessages } from "#/components/features/chat/pending-user-messages";
import { ScrollProvider, useScrollContext } from "#/context/scroll-context";
import { useNavigation } from "#/context/navigation-context";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { useFilteredEvents } from "#/hooks/use-filtered-events";
import { useSendMessage } from "#/hooks/use-send-message";
import { createChatMessage } from "#/services/chat-service";
import { useOptimisticUserMessageStore } from "#/stores/optimistic-user-message-store";
import { useWorkbenchStore } from "#/stores/workbench-store";
import { useWorkbenchLayoutStore } from "#/stores/workbench-layout-store";
import {
  WORKBENCH_ROLES,
  type WorkbenchDocument,
  type WorkbenchPersona,
  type WorkbenchProject,
} from "#/types/workbench";
import { partById, repoById } from "#/utils/workbench/workbench-geometry";
import { buildWorkbenchMessage } from "#/utils/workbench/workbench-prompts";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { cn } from "#/utils/utils";
import {
  WORKBENCH_AVATAR_CLASS,
  WORKBENCH_BUTTON_CLASS,
  WORKBENCH_CHIP_CLASS,
  WORKBENCH_DRAG_TYPES,
  WORKBENCH_ICON_BUTTON_CLASS,
  WORKBENCH_INPUT_CLASS,
  WORKBENCH_PANEL_CLASS,
  WORKBENCH_PRIMARY_BUTTON_CLASS,
  WORKBENCH_SECTION_LABEL_CLASS,
  accentBgClass,
} from "./workbench-controls";
import {
  KIND_LABEL_KEYS,
  PERSONA_KEYS,
  STATUS_LABEL_KEYS,
  WIRE_LABEL_KEYS,
} from "./workbench-labels";

const PERSONAS: WorkbenchPersona[] = ["arch", "pm"];

export interface WorkbenchChatPanelProps {
  document: WorkbenchDocument;
  project: WorkbenchProject;
  documentPath: string | null;
  conversationId: string | null;
  launchWorkingDir: string | null;
  onConversationStarted: (conversationId: string) => void;
  onDetach: () => void;
  /** A question another part of the page wants sent, e.g. a crawl. */
  queued: { id: number; text: string; persona: WorkbenchPersona } | null;
  onQueuedSent: () => void;
}

export function WorkbenchChatPanel(props: WorkbenchChatPanelProps) {
  const { t } = useTranslation("openhands");
  const open = useWorkbenchLayoutStore((s) => s.rightOpen);
  const toggle = useWorkbenchLayoutStore((s) => s.toggleRight);
  const persona = useWorkbenchStore((s) => s.persona);
  const setPersona = useWorkbenchStore((s) => s.setPersona);
  const [unread, setUnread] = React.useState(false);

  // An answer arriving while the drawer is closed lights the dot.
  const { allConversationEvents } = useFilteredEvents();
  const seen = React.useRef(allConversationEvents.length);
  React.useEffect(() => {
    if (open) {
      seen.current = allConversationEvents.length;
      setUnread(false);
    } else if (allConversationEvents.length > seen.current) {
      setUnread(true);
    }
  }, [open, allConversationEvents.length]);

  if (!open) {
    return (
      <aside
        data-testid="workbench-right-rail"
        aria-label={t(I18nKey.WORKBENCH$CHAT_PANEL)}
        className="flex w-12 shrink-0 flex-col items-center gap-2 border-l border-border-subtle bg-base-secondary py-2"
      >
        <button
          type="button"
          data-testid="workbench-right-open"
          className={cn(WORKBENCH_ICON_BUTTON_CLASS, "relative")}
          aria-expanded={false}
          aria-label={t(I18nKey.WORKBENCH$SHOW_CHAT)}
          data-tip={t(I18nKey.WORKBENCH$SHOW_CHAT_TIP)}
          onClick={toggle}
        >
          <ChevronsLeft size={14} aria-hidden />
          {unread && (
            <span
              data-testid="workbench-unread-dot"
              aria-label={t(I18nKey.WORKBENCH$UNREAD)}
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary"
            />
          )}
        </button>
        {PERSONAS.map((p) => {
          const role = WORKBENCH_ROLES.find((r) => r.id === p);
          if (!role) return null;
          return (
            <button
              key={p}
              type="button"
              data-testid={`workbench-rail-talk-${p}`}
              aria-label={t(I18nKey.WORKBENCH$TALK_TO, {
                name: t(PERSONA_KEYS[p]),
              })}
              data-tip={t(I18nKey.WORKBENCH$TALK_TO, {
                name: t(PERSONA_KEYS[p]),
              })}
              className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus"
              onClick={() => {
                setPersona(p);
                toggle();
              }}
            >
              <span
                className={cn(
                  WORKBENCH_AVATAR_CLASS,
                  accentBgClass(role.accent),
                  persona === p &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-base-secondary",
                )}
              >
                {role.initials}
              </span>
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside
      data-testid="workbench-right-panel"
      aria-label={t(I18nKey.WORKBENCH$CHAT_PANEL)}
      className={cn(WORKBENCH_PANEL_CLASS, "w-88 shrink-0 border-l")}
    >
      <ChatBody {...props} onClose={toggle} />
    </aside>
  );
}

function ChatBody({
  document: doc,
  project,
  documentPath,
  conversationId,
  launchWorkingDir,
  onConversationStarted,
  onDetach,
  queued,
  onQueuedSent,
  onClose,
}: WorkbenchChatPanelProps & { onClose: () => void }) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const persona = useWorkbenchStore((s) => s.persona);
  const setPersona = useWorkbenchStore((s) => s.setPersona);
  const selection = useWorkbenchStore((s) => s.selection);
  const togglePart = useWorkbenchStore((s) => s.togglePart);
  const clearSelection = useWorkbenchStore((s) => s.clearSelection);
  const setSelection = useWorkbenchStore((s) => s.setSelection);
  const createConversation = useCreateConversation();
  const { send } = useSendMessage();
  const enqueuePendingMessage = useOptimisticUserMessageStore(
    (s) => s.enqueuePendingMessage,
  );
  const [question, setQuestion] = React.useState("");
  const [showContext, setShowContext] = React.useState(false);
  const [dropHot, setDropHot] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedParts = selection.partIds
    .map((id) => partById(doc, id))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const selectedItem = selection.itemId
    ? (doc.work.find((w) => w.id === selection.itemId) ?? null)
    : null;
  const selectedWire = selection.wireId
    ? (doc.wires.find((w) => w.id === selection.wireId) ?? null)
    : null;
  const context = {
    persona,
    document: doc,
    projectName: project.name,
    selectedPartIds: selection.partIds,
    selectedWireId: selection.wireId,
    selectedItemId: selection.itemId,
    documentPath,
  };
  const preview = buildWorkbenchMessage(question || "…", context);

  const submit = React.useCallback(
    async (text: string, as: WorkbenchPersona) => {
      if (text.trim() === "") return;
      const message = buildWorkbenchMessage(text, { ...context, persona: as });
      if (conversationId !== null) {
        setQuestion("");
        enqueuePendingMessage({ conversationId, text: message });
        await send(
          createChatMessage(message, [], [], new Date().toISOString()),
        );
        return;
      }
      try {
        const conversation = await createConversation.mutateAsync({
          query: message,
          ...(launchWorkingDir === null
            ? {}
            : { workingDir: launchWorkingDir }),
        });
        setQuestion("");
        onConversationStarted(conversation.conversation_id);
      } catch {
        displayErrorToast(t(I18nKey.WORKBENCH$LAUNCH_FAILED));
      }
      // The context object is rebuilt each render; its parts are listed instead.
    },
    [
      conversationId,
      launchWorkingDir,
      selection,
      doc,
      project.name,
      documentPath,
    ],
  );

  // Something else on the page asked for a message to go out (a crawl, "start this story").
  const sentQueued = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!queued || sentQueued.current === queued.id) return;
    sentQueued.current = queued.id;
    setPersona(queued.persona);
    void submit(queued.text, queued.persona).finally(onQueuedSent);
  }, [queued, submit, onQueuedSent, setPersona]);

  const onDrop = (event: React.DragEvent) => {
    setDropHot(false);
    const partId = event.dataTransfer.getData(WORKBENCH_DRAG_TYPES.part);
    if (partId) {
      event.preventDefault();
      setSelection({
        partIds: Array.from(new Set([...selection.partIds, partId])),
      });
      inputRef.current?.focus();
    }
  };

  return (
    <div
      data-testid="workbench-chat"
      data-conversation-id={conversationId ?? undefined}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3",
        dropHot && "rounded-md ring-2 ring-primary",
      )}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKBENCH_DRAG_TYPES.part)) {
          event.preventDefault();
          setDropHot(true);
        }
      }}
      onDragLeave={() => setDropHot(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={WORKBENCH_SECTION_LABEL_CLASS}
          data-testid="workbench-focus-heading"
        >
          {t(I18nKey.WORKBENCH$FOCUSED_ON, { name: t(PERSONA_KEYS[persona]) })}
        </span>
        <div className="flex items-center gap-1">
          {(selection.partIds.length > 0 ||
            selection.itemId ||
            selection.wireId) && (
            <button
              type="button"
              data-testid="workbench-focus-clear"
              className={WORKBENCH_BUTTON_CLASS}
              onClick={clearSelection}
            >
              {t(I18nKey.COMMON$CLEAR_SELECTION)}
            </button>
          )}
          <button
            type="button"
            data-testid="workbench-right-close"
            className={WORKBENCH_ICON_BUTTON_CLASS}
            aria-expanded
            aria-label={t(I18nKey.WORKBENCH$HIDE_CHAT)}
            data-tip={t(I18nKey.WORKBENCH$HIDE_CHAT_TIP)}
            onClick={onClose}
          >
            <ChevronsRight size={14} aria-hidden />
          </button>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        data-testid="workbench-focus-chips"
      >
        {selectedParts.map((part) => (
          <span key={part.id} className={WORKBENCH_CHIP_CLASS}>
            <span className="truncate">{part.name}</span>
            <button
              type="button"
              aria-label={t(I18nKey.WORKBENCH$REMOVE_FROM_FOCUS, {
                name: part.name,
              })}
              className="rounded hover:bg-interactive-active"
              onClick={() => togglePart(part.id)}
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        {selectedWire && (
          <span className={WORKBENCH_CHIP_CLASS}>
            {partById(doc, selectedWire.from)?.name} →{" "}
            {partById(doc, selectedWire.to)?.name}
          </span>
        )}
        {selectedItem && (
          <span className={WORKBENCH_CHIP_CLASS}>
            <span className="font-mono text-micro text-muted">
              {selectedItem.key}
            </span>
            <span className="truncate">{selectedItem.title}</span>
          </span>
        )}
        {selectedParts.length === 0 && !selectedWire && !selectedItem && (
          <span className="text-xs text-muted">
            {t(I18nKey.WORKBENCH$FOCUS_EMPTY)}
          </span>
        )}
      </div>

      {(selectedParts.length === 1 || selectedItem) && (
        <details
          className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-xs"
          data-testid="workbench-details"
        >
          <summary className="cursor-pointer text-text-secondary">
            {t(I18nKey.WORKBENCH$DETAILS)}
          </summary>
          {selectedParts.length === 1 &&
            (() => {
              const part = selectedParts[0];
              const repo = repoById(doc, part.repoId);
              const wires = doc.wires.filter(
                (w) => w.from === part.id || w.to === part.id,
              );
              return (
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-secondary">
                  <dt className="text-muted">
                    {t(I18nKey.WORKBENCH$DETAIL_KIND)}
                  </dt>
                  <dd>
                    {t(KIND_LABEL_KEYS[part.kind])} ·{" "}
                    {t(STATUS_LABEL_KEYS[part.status])}
                  </dd>
                  <dt className="text-muted">
                    {t(I18nKey.WORKBENCH$DETAIL_REPO)}
                  </dt>
                  <dd>{repo?.name}</dd>
                  {part.files.length > 0 && (
                    <>
                      <dt className="text-muted">
                        {t(I18nKey.WORKBENCH$DETAIL_FILES)}
                      </dt>
                      <dd className="break-all font-mono text-micro">
                        {part.files.join(", ")}
                      </dd>
                    </>
                  )}
                  {part.tests !== null && (
                    <>
                      <dt className="text-muted">
                        {t(I18nKey.WORKBENCH$DETAIL_TESTS)}
                      </dt>
                      <dd>{part.tests}%</dd>
                    </>
                  )}
                  {part.drift && (
                    <>
                      <dt className="text-danger">
                        {t(I18nKey.WORKBENCH$DETAIL_DRIFT)}
                      </dt>
                      <dd>{part.drift}</dd>
                    </>
                  )}
                  {part.gate && (
                    <>
                      <dt className="text-warning">
                        {t(I18nKey.WORKBENCH$DETAIL_GATE)}
                      </dt>
                      <dd>{part.gate}</dd>
                    </>
                  )}
                  {part.unsure && (
                    <>
                      <dt className="text-muted">
                        {t(I18nKey.WORKBENCH$DETAIL_UNSURE)}
                      </dt>
                      <dd>{part.unsure}</dd>
                    </>
                  )}
                  {wires.length > 0 && (
                    <>
                      <dt className="text-muted">
                        {t(I18nKey.WORKBENCH$DETAIL_WIRES)}
                      </dt>
                      <dd className="flex flex-col">
                        {wires.map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            className="text-left hover:underline"
                            onClick={() =>
                              setSelection({
                                partIds: [w.from === part.id ? w.to : w.from],
                              })
                            }
                          >
                            {w.from === part.id
                              ? `${t(WIRE_LABEL_KEYS[w.label])} → ${partById(doc, w.to)?.name}`
                              : `${partById(doc, w.from)?.name} ${t(WIRE_LABEL_KEYS[w.label])} →`}
                          </button>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
              );
            })()}
          {selectedItem && (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-secondary">
              <dt className="text-muted">
                {t(I18nKey.WORKBENCH$DETAIL_POINTS)}
              </dt>
              <dd>{selectedItem.points}</dd>
              {selectedItem.acceptance &&
                selectedItem.acceptance.length > 0 && (
                  <>
                    <dt className="text-muted">
                      {t(I18nKey.WORKBENCH$DETAIL_ACCEPTANCE)}
                    </dt>
                    <dd>
                      <ul className="list-disc pl-3">
                        {selectedItem.acceptance.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
              {selectedItem.tasks && selectedItem.tasks.length > 0 && (
                <>
                  <dt className="text-muted">
                    {t(I18nKey.WORKBENCH$DETAIL_TASKS)}
                  </dt>
                  <dd>
                    <ul className="list-disc pl-3">
                      {selectedItem.tasks.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
            </dl>
          )}
        </details>
      )}

      {conversationId !== null && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="workbench-open-conversation"
            className={WORKBENCH_BUTTON_CLASS}
            onClick={() => navigate(`/conversations/${conversationId}`)}
          >
            <Maximize2 size={12} aria-hidden />
            {t(I18nKey.WORKBENCH$OPEN_CONVERSATION)}
          </button>
          <button
            type="button"
            data-testid="workbench-detach-conversation"
            className={WORKBENCH_BUTTON_CLASS}
            onClick={onDetach}
          >
            <MessageSquarePlus size={12} aria-hidden />
            {t(I18nKey.COMMON$NEW_CONVERSATION)}
          </button>
        </div>
      )}

      <ScrollProvider>
        <Transcript bound={conversationId !== null} />
      </ScrollProvider>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question, persona);
        }}
      >
        <div
          role="group"
          aria-label={t(I18nKey.WORKBENCH$TALK_TO_GROUP)}
          className="flex gap-1"
        >
          {PERSONAS.map((p) => {
            const r = WORKBENCH_ROLES.find((x) => x.id === p);
            return (
              <button
                key={p}
                type="button"
                data-testid={`workbench-persona-${p}`}
                aria-pressed={persona === p}
                className={cn(
                  WORKBENCH_BUTTON_CLASS,
                  persona === p && "border-primary bg-interactive-selected",
                )}
                onClick={() => setPersona(p)}
              >
                {r && (
                  <span
                    className={cn(
                      WORKBENCH_AVATAR_CLASS,
                      "h-4 w-4 text-[7px]",
                      accentBgClass(r.accent),
                    )}
                  >
                    {r.initials}
                  </span>
                )}
                {t(PERSONA_KEYS[p])}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            data-testid="workbench-chat-input"
            className={WORKBENCH_INPUT_CLASS}
            placeholder={t(I18nKey.WORKBENCH$ASK_PLACEHOLDER, {
              name: t(PERSONA_KEYS[persona]),
            })}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={createConversation.isPending}
          />
          <button
            type="submit"
            data-testid="workbench-chat-send"
            className={WORKBENCH_PRIMARY_BUTTON_CLASS}
            disabled={question.trim() === "" || createConversation.isPending}
            aria-label={t(I18nKey.WORKBENCH$SEND)}
          >
            <Send size={12} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="self-start text-micro text-muted hover:underline"
          aria-expanded={showContext}
          onClick={() => setShowContext((v) => !v)}
        >
          {showContext
            ? t(I18nKey.WORKBENCH$HIDE_CONTEXT)
            : t(I18nKey.WORKBENCH$SHOW_CONTEXT)}
        </button>
        {showContext && (
          <pre
            data-testid="workbench-context-preview"
            className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-surface p-2 font-mono text-micro text-text-secondary custom-scrollbar"
          >
            {preview}
          </pre>
        )}
      </form>
    </div>
  );
}

function Transcript({ bound }: { bound: boolean }) {
  const { t } = useTranslation("openhands");
  const { renderableEvents, allConversationEvents } = useFilteredEvents();
  const { scrollRef, onChatBodyScroll } = useScrollContext();
  return (
    <div
      ref={scrollRef}
      data-testid="workbench-transcript"
      onScroll={(event) => onChatBodyScroll(event.currentTarget)}
      className="custom-scrollbar flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-border-subtle bg-surface p-2"
    >
      {!bound || renderableEvents.length === 0 ? (
        <p className="text-xs text-muted">
          {bound
            ? t(I18nKey.WORKBENCH$TRANSCRIPT_EMPTY)
            : t(I18nKey.WORKBENCH$TRANSCRIPT_UNBOUND)}
        </p>
      ) : (
        <Messages
          messages={renderableEvents}
          allEvents={allConversationEvents}
        />
      )}
      {bound && <PendingUserMessages />}
    </div>
  );
}
