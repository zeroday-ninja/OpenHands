/**
 * The workbench route for one project: toolbar, left drawer, stage (Design or
 * Work), right drawer, and the things that span them — the context menu, the
 * tooltip, the toast, keyboard shortcuts, autosave, and the conversation that
 * binds the chat to this workspace.
 *
 * The page leans towards doing things without being asked: edits save a moment
 * after they happen, a dropped repo with no map starts a crawl, "start this
 * story" hands it to the team. Everything it does without asking can be undone
 * from the toast or with Ctrl+Z.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { ScopedConversationIdProvider } from "#/context/scoped-conversation-id-context";
import { WebSocketProviderWrapper } from "#/contexts/websocket-provider-wrapper";
import { useSaveWorkbench } from "#/hooks/mutation/use-save-workbench";
import { useConversationWorkspace } from "#/hooks/query/use-conversation-workspace";
import { useWorkbench } from "#/hooks/query/use-workbench";
import { useRefreshWorkbenchOnAgentEdit } from "#/hooks/use-refresh-workbench-on-agent-edit";
import { useWorkbenchStore } from "#/stores/workbench-store";
import { useWorkbenchLayoutStore } from "#/stores/workbench-layout-store";
import {
  WORKBENCH_ROLES,
  type WorkbenchAgent,
  type WorkbenchPart,
  type WorkbenchPersona,
  type WorkbenchRepo,
  type WorkbenchRole,
  type WorkbenchWorkItem,
} from "#/types/workbench";
import { buildCrawlMessage } from "#/utils/workbench/workbench-prompts";
import {
  fitViewport,
  groupBox,
  visibleBounds,
  zoomViewport,
} from "#/utils/workbench/workbench-geometry";
import { EventHandler } from "#/wrapper/event-handler";
import { WorkbenchBoard } from "./workbench-board";
import { WorkbenchCanvas } from "./workbench-canvas";
import { WorkbenchChatPanel } from "./workbench-chat-panel";
import {
  WorkbenchContextMenu,
  useWorkbenchContextMenu,
} from "./workbench-context-menu";
import { WorkbenchSidePanel } from "./workbench-side-panel";
import { WorkbenchToast, useWorkbenchToast } from "./workbench-toast";
import { WorkbenchToolbar } from "./workbench-toolbar";
import { WorkbenchTooltip } from "./workbench-tooltip";
import { WorkbenchEmptyState } from "./workbench-home";

const AUTOSAVE_MS = 1200;

export interface WorkbenchPageProps {
  projectId: string;
}

export function WorkbenchPage({ projectId }: WorkbenchPageProps) {
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const page = (
    <WorkbenchPageBody
      projectId={projectId}
      conversationId={conversationId}
      onConversationStarted={setConversationId}
      onDetach={() => setConversationId(null)}
    />
  );
  if (conversationId === null) return page;
  return (
    <ScopedConversationIdProvider conversationId={conversationId}>
      <WebSocketProviderWrapper conversationId={conversationId}>
        <EventHandler>{page}</EventHandler>
      </WebSocketProviderWrapper>
    </ScopedConversationIdProvider>
  );
}

function WorkbenchPageBody({
  projectId,
  conversationId,
  onConversationStarted,
  onDetach,
}: WorkbenchPageProps & {
  conversationId: string | null;
  onConversationStarted: (id: string) => void;
  onDetach: () => void;
}) {
  const { t } = useTranslation("openhands");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const { data, isLoading, unsupportedReason, error } =
    useWorkbench(conversationId);
  const save = useSaveWorkbench(conversationId);
  const { isolated } = useConversationWorkspace();
  useRefreshWorkbenchOnAgentEdit();

  const doc = useWorkbenchStore((s) => s.document);
  const dirty = useWorkbenchStore((s) => s.dirty);
  const mode = useWorkbenchStore((s) => s.mode);
  const viewport = useWorkbenchStore((s) => s.viewport);
  const {
    hydrate,
    markSaved,
    setViewport,
    setSelection,
    setMode,
    setPersona,
    setTool,
    undo,
    redo,
    deleteSelection,
    clearSelection,
    commit,
    addItem,
  } = useWorkbenchStore.getState();
  const toggleLeft = useWorkbenchLayoutStore((s) => s.toggleLeft);
  const toggleRight = useWorkbenchLayoutStore((s) => s.toggleRight);
  const setRightOpen = useWorkbenchLayoutStore((s) => s.setRightOpen);

  const { menu, open: openMenu, close: closeMenu } = useWorkbenchContextMenu();
  const { toast, show: showToast, dismiss } = useWorkbenchToast();
  const [queued, setQueued] = React.useState<{
    id: number;
    text: string;
    persona: WorkbenchPersona;
  } | null>(null);

  // Synchronisation with the file on disk.
  React.useEffect(() => {
    if (!data?.document) return;
    hydrate(data.revision, data.document);
  }, [data, hydrate]);

  // Autosave: a moment after the last edit, write the document. The toast
  // already offers Undo for anything that happened without being asked.
  React.useEffect(() => {
    if (!dirty || !doc) return undefined;
    const timer = setTimeout(() => {
      save.mutate(doc, { onSuccess: () => markSaved() });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, doc]);

  const project = doc?.projects.find((p) => p.id === projectId) ?? null;

  const ask = React.useCallback(
    (persona: WorkbenchPersona, text?: string) => {
      setPersona(persona);
      setRightOpen(true);
      if (text) setQueued({ id: Date.now(), text, persona });
    },
    [setPersona, setRightOpen],
  );

  const fit = React.useCallback(() => {
    if (!doc || !project) return;
    const rect = stageRef.current?.getBoundingClientRect();
    setViewport(
      fitViewport(
        visibleBounds(doc, project.repoIds),
        rect?.width ?? 0,
        rect?.height ?? 0,
      ),
    );
  }, [doc, project, setViewport]);

  const zoom = (factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    setViewport(
      zoomViewport(viewport, factor, {
        x: (rect?.width ?? 0) / 2,
        y: (rect?.height ?? 0) / 2,
      }),
    );
  };

  // Keyboard: Delete removes the selection, Ctrl+Z/Y undo and redo, V/H pick a
  // tool, 0 fits, [ and ] open the drawers, Escape clears. Typing in a field is
  // left alone.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        if (typing) return;
        event.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      switch (event.key) {
        case "Delete":
        case "Backspace": {
          const { selection } = useWorkbenchStore.getState();
          const count =
            selection.partIds.length +
            (selection.wireId ? 1 : 0) +
            (selection.highlightId ? 1 : 0) +
            (selection.itemId ? 1 : 0);
          if (count === 0) return;
          event.preventDefault();
          deleteSelection();
          showToast(t(I18nKey.WORKBENCH$TOAST_DELETED, { count }), true);
          return;
        }
        case "Escape":
          clearSelection();
          setTool("select");
          closeMenu();
          return;
        case "v":
        case "V":
          setTool("select");
          return;
        case "h":
        case "H":
          setTool(
            useWorkbenchStore.getState().tool === "highlight"
              ? "select"
              : "highlight",
          );
          return;
        case "0":
          fit();
          return;
        case "[":
          toggleLeft();
          return;
        case "]":
          toggleRight();
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    deleteSelection,
    clearSelection,
    setTool,
    fit,
    toggleLeft,
    toggleRight,
    closeMenu,
    showToast,
    t,
  ]);

  if (unsupportedReason !== null) {
    return <WorkbenchEmptyState kind={unsupportedReason} />;
  }
  if (isLoading && !doc) {
    return (
      <div
        data-testid="workbench-loading"
        className="flex h-full items-center justify-center text-sm text-muted"
      >
        {t(I18nKey.WORKBENCH$LOADING)}
      </div>
    );
  }
  if (error) {
    return (
      <WorkbenchEmptyState
        kind="error"
        detail={error instanceof Error ? error.message : String(error)}
      />
    );
  }
  if (data?.failure) {
    return <WorkbenchEmptyState kind="error" detail={data.failure} />;
  }
  if (!doc || !project) {
    return (
      <WorkbenchEmptyState
        kind={data?.missing ? "missing" : "no-project"}
        conversationId={conversationId}
      />
    );
  }

  const documentPath = data?.absolutePath ?? null;
  const launchWorkingDir = isolated
    ? null
    : (data?.workspace.workingDir ?? null);

  const crawl = (repo: WorkbenchRepo) => {
    ask("arch", buildCrawlMessage(repo.name, documentPath));
    showToast(t(I18nKey.WORKBENCH$TOAST_CRAWL_STARTED, { name: repo.name }));
  };

  const agentDrop = (agentId: string, partId: string) => {
    const part = doc.parts.find((p) => p.id === partId);
    if (!part) return;
    if (agentId.startsWith("role:")) {
      const role = WORKBENCH_ROLES.find((r) => r.id === agentId.slice(5));
      if (!role) return;
      setSelection({ partIds: [partId] });
      ask(
        role.id === "pm" ? "pm" : "arch",
        t(I18nKey.WORKBENCH$PROMPT_SEND_ROLE, {
          role: t(roleKey(role)),
          part: part.name,
        }),
      );
      return;
    }
    commit((document) => ({
      ...document,
      agents: document.agents.map(
        (agent): WorkbenchAgent =>
          agent.id === agentId
            ? {
                ...agent,
                focus: partId,
                trail: agent.trail.includes(partId)
                  ? agent.trail
                  : [...agent.trail, partId],
              }
            : agent,
      ),
    }));
    showToast(t(I18nKey.WORKBENCH$TOAST_AGENT_SENT, { part: part.name }), true);
  };

  const storyFor = (part: WorkbenchPart) => {
    const id = addItem({
      title: part.name,
      partId: part.id,
      note: t(I18nKey.WORKBENCH$STORY_FROM_PART),
    });
    if (!id) return;
    setMode("work");
    setSelection({ itemId: id });
    showToast(
      t(I18nKey.WORKBENCH$TOAST_STORY_ADDED, { title: part.name }),
      true,
    );
    if (useWorkbenchStore.getState().autopilot) {
      ask("pm", t(I18nKey.WORKBENCH$PROMPT_PLAN_STORY, { part: part.name }));
    }
  };

  const startStory = (item: WorkbenchWorkItem) => {
    useWorkbenchStore.getState().moveItemToStage(item.id, "build");
    ask(
      "pm",
      t(I18nKey.WORKBENCH$PROMPT_START_STORY, {
        key: item.key,
        title: item.title,
      }),
    );
    showToast(
      t(I18nKey.WORKBENCH$TOAST_STORY_STARTED, { key: item.key }),
      true,
    );
  };

  const talkTo = (role: WorkbenchRole, agent: WorkbenchAgent | null) => {
    if (agent?.focus) setSelection({ partIds: [agent.focus] });
    ask(role.id === "pm" ? "pm" : "arch");
  };

  const showPart = (partId: string) => {
    const part = doc.parts.find((p) => p.id === partId);
    if (!part) return;
    const repo = doc.repos.find((r) => r.id === part.repoId);
    setMode("design");
    setSelection({ partIds: [partId] });
    if (repo) {
      const rect = stageRef.current?.getBoundingClientRect();
      setViewport(
        fitViewport(groupBox(doc, repo), rect?.width ?? 0, rect?.height ?? 0),
      );
    }
  };

  const addRepo = (repo: WorkbenchRepo) => {
    useWorkbenchStore.getState().addRepoToProject(project.id, repo.id);
    showToast(t(I18nKey.WORKBENCH$TOAST_REPO_ADDED, { name: repo.name }), true);
    if (!repo.hasMap && !doc.parts.some((p) => p.repoId === repo.id))
      crawl(repo);
  };

  return (
    <div
      ref={rootRef}
      data-testid="workbench-page"
      className="flex h-full flex-col overflow-hidden bg-canvas-base text-canvas-base"
    >
      <WorkbenchToolbar
        document={doc}
        project={project}
        saving={save.isPending}
        onZoom={zoom}
        onFit={fit}
        onSaveNow={() => save.mutate(doc, { onSuccess: () => markSaved() })}
      />
      <div className="flex min-h-0 flex-1">
        <WorkbenchSidePanel
          document={doc}
          project={project}
          openMenu={openMenu}
          onTalkTo={talkTo}
          onAddRepo={addRepo}
          onCrawl={crawl}
        />
        <div
          ref={stageRef}
          data-testid="workbench-stage"
          className="relative min-w-0 flex-1 overflow-hidden"
        >
          {mode === "design" ? (
            <WorkbenchCanvas
              document={doc}
              project={project}
              openMenu={openMenu}
              showToast={showToast}
              onAsk={(ids) => {
                setSelection({ partIds: ids });
                ask("arch");
              }}
              onCrawl={crawl}
              onAgentDrop={agentDrop}
              onStoryFor={storyFor}
            />
          ) : (
            <WorkbenchBoard
              document={doc}
              openMenu={openMenu}
              showToast={showToast}
              onAsk={(itemId) => {
                setSelection({ itemId });
                ask("pm");
              }}
              onShowPart={showPart}
              onStart={startStory}
            />
          )}
          <WorkbenchToast toast={toast} onUndo={undo} onDismiss={dismiss} />
        </div>
        <WorkbenchChatPanel
          document={doc}
          project={project}
          documentPath={documentPath}
          conversationId={conversationId}
          launchWorkingDir={launchWorkingDir}
          onConversationStarted={onConversationStarted}
          onDetach={onDetach}
          queued={queued}
          onQueuedSent={() => setQueued(null)}
        />
      </div>
      <WorkbenchContextMenu menu={menu} onClose={closeMenu} />
      <WorkbenchTooltip rootRef={rootRef} />
    </div>
  );
}

function roleKey(role: WorkbenchRole): I18nKey {
  switch (role.id) {
    case "pm":
      return I18nKey.WORKBENCH$ROLE_PM;
    case "arch":
      return I18nKey.WORKBENCH$ROLE_ARCHITECT;
    case "fe":
      return I18nKey.WORKBENCH$ROLE_FRONTEND;
    case "be":
      return I18nKey.WORKBENCH$ROLE_BACKEND;
    case "qa":
      return I18nKey.WORKBENCH$ROLE_QA;
    case "rev":
      return I18nKey.WORKBENCH$ROLE_REVIEWER;
    case "ops":
      return I18nKey.WORKBENCH$ROLE_DEVOPS;
    default:
      return I18nKey.WORKBENCH$ROLE_ARCHITECT;
  }
}
