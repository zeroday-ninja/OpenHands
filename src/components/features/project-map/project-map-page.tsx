/**
 * The `/map` page: canvas on the left, selection and chat on the right.
 *
 * Why a top-level route rather than a conversation tab: the map describes a
 * repository, not a conversation. It outlives every conversation about it, you
 * open it to decide what to work on *before* starting one, and it sits
 * alongside the other things in this app that are about the workspace as a
 * whole. The conversation tabs — Files, Terminal, Changes — are all views of
 * one running agent's sandbox, which the map is not.
 *
 * The chat beside the canvas is a real conversation, not a launcher. A live
 * transcript needs the conversation WebSocket, which used to be reachable only
 * from a route that names a conversation; this page binds one explicitly
 * instead, so the first send opens a conversation and the answer arrives here
 * rather than on another page. Asking what something is, being told, and
 * pointing at it on the drawing are then one activity instead of three.
 *
 * **Which workspace the page is looking at.** The bound conversation is also
 * the answer to that, and this component is its one owner and writer. A
 * conversation under `OH_CONVERSATION_RUNTIME=docker` runs in its own
 * container, so the repository it cloned — and the only copy of
 * `.openhands/project-map.json` that exists — is inside that sandbox and
 * invisible to the agent server's own filesystem. The map therefore follows
 * the conversation: reads, writes, the analysis prompt and the chat's context
 * block all name the workspace of the bound conversation, and only an unbound
 * page falls back to the backend's configured working directory. Either way
 * the workspace is named on screen, because the failure this feature actually
 * has is not an error message — it is a plausible-looking empty map of
 * somewhere else.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
  Crosshair,
  Eye,
  Maximize2,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import type { ProjectMapWorkspace } from "#/api/project-map-service/project-map-service.api";
import { useNavigation } from "#/context/navigation-context";
import { ScopedConversationIdProvider } from "#/context/scoped-conversation-id-context";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { WebSocketProviderWrapper } from "#/contexts/websocket-provider-wrapper";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { useSaveProjectMap } from "#/hooks/mutation/use-save-project-map";
import { useConversationWorkspace } from "#/hooks/query/use-conversation-workspace";
import { useProjectMap } from "#/hooks/query/use-project-map";
import { useRefreshProjectMapOnAgentEdit } from "#/hooks/use-refresh-project-map-on-agent-edit";
import { EventHandler } from "#/wrapper/event-handler";
import {
  PROJECT_MAP_MAX_SCALE,
  PROJECT_MAP_MIN_SCALE,
  useProjectMapStore,
} from "#/stores/project-map-store";
import {
  PROJECT_MAP_FILE_PATH,
  PROJECT_MAP_VERSION,
} from "#/types/project-map";
import {
  fitProjectMapViewBox,
  projectMapBounds,
} from "#/utils/project-map/project-map-layout";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { buildProjectMapAnalysisPrompt } from "./project-map-analysis-prompt";
import { ProjectMapCanvas } from "./project-map-canvas";
import { ProjectMapConversation } from "./project-map-conversation";
import { ProjectMapInspector } from "./project-map-inspector";
import { ProjectMapLegend } from "./project-map-legend";
import {
  PROJECT_MAP_BUTTON_CLASS,
  PROJECT_MAP_PRIMARY_BUTTON_CLASS,
  PROJECT_MAP_SECTION_LABEL_CLASS,
} from "./project-map-controls";
import { PROJECT_MAP_WARNING_LABELS } from "./project-map-labels";

const ICON_SIZE = 14;

export function ProjectMapPage() {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const { backend } = useActiveBackend();
  const frameRef = React.useRef<SVGSVGElement | null>(null);
  // The conversation this page is bound to, which is also the workspace the
  // map is read from and written to. One owner, one writer: every other piece
  // of the page receives it as a prop or as a hook argument.
  const [mapConversationId, setMapConversationId] = React.useState<
    string | null
  >(null);
  const {
    data,
    isLoading,
    error,
    unsupportedReason,
    workspace,
    unavailableRuntimeConversationId,
    attemptedPath,
    refetch,
  } = useProjectMap(mapConversationId);
  const saveProjectMap = useSaveProjectMap(mapConversationId);
  const createConversation = useCreateConversation();
  // Whether a conversation gets its own container. It decides what the
  // analysis can be told: a sandbox cannot see the directory this page reads
  // when it is unbound, so there is no absolute path worth naming.
  const { isolated } = useConversationWorkspace();
  // The pane's conversation can rewrite the file this page is reading, so the
  // page re-reads it when that happens. Nothing polls.
  useRefreshProjectMapOnAgentEdit();

  const document_ = useProjectMapStore((state) => state.document);
  const dirty = useProjectMapStore((state) => state.dirty);
  const showHidden = useProjectMapStore((state) => state.showHidden);
  const hydrate = useProjectMapStore((state) => state.hydrate);
  const markSaved = useProjectMapStore((state) => state.markSaved);
  const toggleShowHidden = useProjectMapStore(
    (state) => state.toggleShowHidden,
  );
  const setViewport = useProjectMapStore((state) => state.setViewport);

  // Synchronisation with an external system — the file on disk. The revision
  // fingerprints the bytes, so `hydrate` ignores a re-read that found no
  // change and never discards unsaved work, while a write by the agent is a
  // real revision even when it leaves the provenance fields alone.
  React.useEffect(() => {
    if (!data?.document) return;
    hydrate(data.revision, data.document);
  }, [data, hydrate]);

  // Frame the whole map the first time a document arrives. A map that opens
  // part-way off the canvas reads as broken before the user has touched it,
  // and the first thing anyone does is reach for Fit to view. Keyed by
  // revision so a *later* refetch never yanks the view away from someone who
  // has panned somewhere deliberately.
  const framedRevision = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (document_ === null) return;
    const revision = data?.absolutePath ?? "";
    if (framedRevision.current === revision) return;
    const frame = frameRef.current?.getBoundingClientRect();
    const bounds = projectMapBounds(document_.nodes);
    if (!frame || frame.width === 0 || bounds === null) return;
    framedRevision.current = revision;
    setViewport(
      fitProjectMapViewBox(bounds, frame, {
        min: PROJECT_MAP_MIN_SCALE,
        max: PROJECT_MAP_MAX_SCALE,
      }),
    );
  }, [document_, data?.absolutePath, setViewport]);

  // The map is named by its absolute path so what the agent is told and what
  // the page reads are the same file, even when the agent's own working
  // directory is somewhere else.
  const mapPath = attemptedPath ?? PROJECT_MAP_FILE_PATH;

  /**
   * Starts the analysis and binds it to the page.
   *
   * It does not navigate away any more. The map is written by this
   * conversation, in this conversation's workspace when that workspace is a
   * sandbox, so leaving the page is how the user ends up back here afterwards
   * looking at a different filesystem — the reported symptom. Staying also
   * means the page is watching the conversation that writes the file, so the
   * drawing appears on its own (`useRefreshProjectMapOnAgentEdit`).
   */
  const generate = async () => {
    try {
      const conversation = await createConversation.mutateAsync({
        // An isolated conversation owns its workspace and the page follows it,
        // so the only file it can write is the one in its own working
        // directory — there is no absolute path to name, and naming this
        // page's would send it somewhere its container does not have.
        // Otherwise the conversation joins the workspace the map is already
        // in and is told that file's absolute path. `attemptedPath` rather
        // than `mapPath`: a path the page never resolved is not an absolute
        // one, and claiming it is would be the same mistake again.
        query: buildProjectMapAnalysisPrompt(isolated ? null : attemptedPath),
        ...(isolated || !workspace ? {} : { workingDir: workspace.workingDir }),
      });
      setMapConversationId(conversation.conversation_id);
    } catch {
      // The mutation's own toast covers the request; this keeps a thrown
      // launch from leaving an unhandled rejection behind.
      displayErrorToast(t(I18nKey.PROJECT_MAP$LAUNCH_FAILED));
    }
  };

  const fitToView = () => {
    const frame = frameRef.current?.getBoundingClientRect();
    const bounds =
      document_ === null ? null : projectMapBounds(document_.nodes);
    if (!frame || bounds === null) return;
    setViewport(
      fitProjectMapViewBox(bounds, frame, {
        min: PROJECT_MAP_MIN_SCALE,
        max: PROJECT_MAP_MAX_SCALE,
      }),
    );
  };

  const save = async () => {
    if (document_ === null) return;
    await saveProjectMap.mutateAsync(document_);
    markSaved();
  };

  const page = (
    <div
      data-testid="project-map-page"
      className="flex h-full min-h-0 flex-col gap-3 p-4 lg:px-8"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col">
          <h2 className="text-xl font-medium text-contrast">
            {t(I18nKey.PROJECT_MAP$NAV_LABEL)}
          </h2>
          <p className="text-sm text-tertiary-light">
            {t(I18nKey.PROJECT_MAP$SUBTITLE)}
          </p>
          <WorkspaceLabel workspace={workspace} backendName={backend.name} />
        </div>
        {document_ !== null && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              data-testid="project-map-provenance"
              className="font-mono text-micro text-muted"
            >
              {document_.commit === null
                ? t(I18nKey.PROJECT_MAP$NO_COMMIT)
                : t(I18nKey.PROJECT_MAP$GENERATED_AGAINST, {
                    commit: document_.commit,
                  })}
            </span>
            <button
              type="button"
              className={PROJECT_MAP_BUTTON_CLASS}
              onClick={fitToView}
            >
              <Crosshair size={ICON_SIZE} aria-hidden />
              {t(I18nKey.PROJECT_MAP$FIT)}
            </button>
            <button
              type="button"
              data-testid="project-map-show-hidden"
              aria-pressed={showHidden}
              className={PROJECT_MAP_BUTTON_CLASS}
              onClick={toggleShowHidden}
            >
              <Eye size={ICON_SIZE} aria-hidden />
              {t(I18nKey.PROJECT_MAP$SHOW_HIDDEN)}
            </button>
            <button
              type="button"
              data-testid="project-map-refresh"
              className={PROJECT_MAP_BUTTON_CLASS}
              onClick={() => void refetch()}
            >
              <RefreshCw size={ICON_SIZE} aria-hidden />
              {t(I18nKey.PROJECT_MAP$REFRESH)}
            </button>
            <button
              type="button"
              data-testid="project-map-regenerate"
              className={PROJECT_MAP_BUTTON_CLASS}
              disabled={createConversation.isPending}
              onClick={() => void generate()}
            >
              <Sparkles size={ICON_SIZE} aria-hidden />
              {t(I18nKey.PROJECT_MAP$REGENERATE)}
            </button>
            <button
              type="button"
              data-testid="project-map-save"
              className={PROJECT_MAP_PRIMARY_BUTTON_CLASS}
              disabled={!dirty || saveProjectMap.isPending}
              onClick={() => void save()}
            >
              <Save size={ICON_SIZE} aria-hidden />
              {saveProjectMap.isPending
                ? t(I18nKey.PROJECT_MAP$SAVING)
                : dirty
                  ? t(I18nKey.PROJECT_MAP$SAVE)
                  : t(I18nKey.PROJECT_MAP$SAVED)}
            </button>
          </div>
        )}
      </header>

      {dirty && (
        <p
          data-testid="project-map-unsaved"
          className="text-xs text-feedback-warning"
        >
          {t(I18nKey.PROJECT_MAP$UNSAVED)}
        </p>
      )}
      {saveProjectMap.isError && (
        <p
          data-testid="project-map-save-error"
          className="text-xs text-feedback-error"
        >
          {t(I18nKey.PROJECT_MAP$SAVE_FAILED)}
        </p>
      )}
      {data?.warnings.map((warning) => (
        <p
          key={warning.kind}
          data-testid={`project-map-warning-${warning.kind}`}
          className="text-xs text-feedback-warning"
        >
          {t(PROJECT_MAP_WARNING_LABELS[warning.kind], {
            count: warning.count,
          })}
        </p>
      ))}

      {unsupportedReason !== null ? (
        <Notice testId="project-map-unsupported" reason={unsupportedReason}>
          {t(
            unsupportedReason === "cloud-backend"
              ? I18nKey.PROJECT_MAP$UNSUPPORTED_CLOUD
              : I18nKey.PROJECT_MAP$UNSUPPORTED_NO_BACKEND,
          )}
        </Notice>
      ) : isLoading ? (
        <Notice testId="project-map-loading">
          {t(I18nKey.PROJECT_MAP$LOADING)}
        </Notice>
      ) : unavailableRuntimeConversationId !== null ? (
        // A sandbox that has been archived, cannot start, or belongs to a
        // conversation that no longer exists. Saying so is the difference
        // between a map that is missing and a map that cannot be reached.
        <Notice testId="project-map-runtime-unavailable">
          {t(I18nKey.PROJECT_MAP$RUNTIME_UNAVAILABLE, {
            conversation: unavailableRuntimeConversationId,
          })}
        </Notice>
      ) : error ? (
        <Notice testId="project-map-read-error">
          {/* The path comes from the error, not from the data a failed query
              does not have. Without one — the home directory itself was
              unreachable — the sentence does not pretend to know it. */}
          {attemptedPath === null
            ? t(I18nKey.PROJECT_MAP$READ_FAILED_NO_PATH)
            : t(I18nKey.PROJECT_MAP$READ_FAILED, { path: attemptedPath })}
        </Notice>
      ) : data?.failure ? (
        <InvalidNotice failure={data.failure} />
      ) : data?.missing || document_ === null ? (
        <EmptyState
          pending={createConversation.isPending}
          conversationId={mapConversationId}
          workspace={workspace}
          backendName={backend.name}
          onGenerate={() => void generate()}
          onRefresh={() => void refetch()}
          onOpenConversation={(conversationId) =>
            navigate(`/conversations/${conversationId}`)
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="min-h-80 flex-1 overflow-hidden rounded-lg border border-border-subtle">
            <ProjectMapCanvas document={document_} frameRef={frameRef} />
          </div>
          <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto rounded-lg border border-border-subtle bg-base-secondary p-4 lg:w-88 custom-scrollbar">
            <div className="flex flex-col gap-2">
              <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
                {t(I18nKey.PROJECT_MAP$INSPECTOR_TITLE)}
              </span>
              <ProjectMapInspector document={document_} />
            </div>
            <ProjectMapConversation
              document={document_}
              mapPath={mapPath}
              conversationId={mapConversationId}
              launchWorkingDir={
                isolated ? null : (workspace?.workingDir ?? null)
              }
              onConversationStarted={setMapConversationId}
              onDetach={() => setMapConversationId(null)}
            />
            <ProjectMapLegend document={document_} />
          </aside>
        </div>
      )}
    </div>
  );

  if (mapConversationId === null) return page;

  // The transport for the bound conversation, mounted around the whole page
  // rather than around the chat pane: the pane only exists once there is a
  // drawing, and the page needs the socket before that — the conversation
  // generating the very first map is the one whose write makes it appear.
  return (
    <ScopedConversationIdProvider conversationId={mapConversationId}>
      <WebSocketProviderWrapper conversationId={mapConversationId}>
        <EventHandler>{page}</EventHandler>
      </WebSocketProviderWrapper>
    </ScopedConversationIdProvider>
  );
}

/**
 * Which workspace the drawing on screen belongs to.
 *
 * Rendered as soon as a read resolves one, including the read that found no
 * file: an empty map of a named directory is a fact the user can act on, and
 * an empty map of nowhere in particular is the bug report "it doesn't work".
 */
function WorkspaceLabel({
  workspace,
  backendName,
  testId = "project-map-workspace",
}: {
  workspace: ProjectMapWorkspace | null;
  backendName: string;
  /** Distinct per place it is rendered, so an assertion names one of them. */
  testId?: string;
}) {
  const { t } = useTranslation("openhands");
  if (workspace === null) return null;
  return (
    <p
      data-testid={testId}
      data-conversation-id={workspace.conversationId ?? undefined}
      className="font-mono text-micro text-muted"
    >
      {workspace.conversationId === null
        ? t(I18nKey.PROJECT_MAP$WORKSPACE_ON_BACKEND, {
            backend: backendName,
            path: workspace.workingDir,
          })
        : t(I18nKey.PROJECT_MAP$WORKSPACE_IN_CONVERSATION, {
            conversation: workspace.conversationId,
            path: workspace.workingDir,
          })}
    </p>
  );
}

function Notice({
  children,
  testId,
  reason,
}: {
  children: React.ReactNode;
  testId: string;
  /** Which of several reasons this notice is showing, for the harness. */
  reason?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-reason={reason}
      className="rounded-lg border border-border-subtle bg-base-secondary p-6 text-sm text-text-secondary"
    >
      {children}
    </div>
  );
}

function InvalidNotice({
  failure,
}: {
  failure: NonNullable<ReturnType<typeof useProjectMap>["data"]>["failure"];
}) {
  const { t } = useTranslation("openhands");
  if (failure === null) return null;
  const detail =
    failure.reason === "not-json"
      ? t(I18nKey.PROJECT_MAP$INVALID_NOT_JSON)
      : failure.reason === "not-an-object"
        ? t(I18nKey.PROJECT_MAP$INVALID_NOT_OBJECT)
        : failure.reason === "unsupported-version"
          ? t(I18nKey.PROJECT_MAP$INVALID_VERSION, {
              version: failure.foundVersion ?? "",
              supported: PROJECT_MAP_VERSION,
            })
          : t(I18nKey.PROJECT_MAP$INVALID_FIELD, {
              pointer: failure.pointer ?? "",
            });
  return (
    <div
      data-testid="project-map-invalid"
      className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-base-secondary p-6"
    >
      <h3 className="text-sm font-medium text-foreground">
        {t(I18nKey.PROJECT_MAP$INVALID_TITLE)}
      </h3>
      <p className="text-sm text-text-secondary">{detail}</p>
      <p className="text-xs text-muted">
        {t(I18nKey.PROJECT_MAP$INVALID_HINT)}
      </p>
    </div>
  );
}

function EmptyState({
  pending,
  conversationId,
  workspace,
  backendName,
  onGenerate,
  onRefresh,
  onOpenConversation,
}: {
  pending: boolean;
  /** The conversation the page is bound to, which is writing the map. */
  conversationId: string | null;
  workspace: ProjectMapWorkspace | null;
  backendName: string;
  onGenerate: () => void;
  onRefresh: () => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t } = useTranslation("openhands");
  return (
    <div
      data-testid="project-map-empty"
      className="flex max-w-xl flex-col items-start gap-4 rounded-lg border border-border-subtle bg-base-secondary p-6"
    >
      <h3 className="text-base font-medium text-foreground">
        {t(I18nKey.PROJECT_MAP$EMPTY_TITLE)}
      </h3>
      <p className="text-sm leading-relaxed text-text-secondary">
        {t(I18nKey.PROJECT_MAP$EMPTY_BODY)}
      </p>
      {/* Which empty workspace this is. The same sentence as the header's,
          repeated here because this is the state in which it matters: nothing
          else on screen says where the page just looked. */}
      <WorkspaceLabel
        workspace={workspace}
        backendName={backendName}
        testId="project-map-empty-workspace"
      />
      {conversationId !== null && workspace !== null && (
        <p
          data-testid="project-map-analysis-running"
          className="text-sm leading-relaxed text-text-secondary"
        >
          {t(I18nKey.PROJECT_MAP$ANALYSIS_RUNNING, {
            conversation: conversationId,
            path: workspace.workingDir,
          })}
        </p>
      )}
      {conversationId !== null && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The drawing arrives on its own when the agent reports the write,
              but a write it does not report — a shell redirect, say — would
              otherwise leave this state with no way out but a reload, which
              also drops the conversation this page is bound to. */}
          <button
            type="button"
            data-testid="project-map-empty-refresh"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={onRefresh}
          >
            <RefreshCw size={ICON_SIZE} aria-hidden />
            {t(I18nKey.PROJECT_MAP$REFRESH)}
          </button>
          <button
            type="button"
            data-testid="project-map-empty-open-conversation"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() => onOpenConversation(conversationId)}
          >
            <Maximize2 size={ICON_SIZE} aria-hidden />
            {t(I18nKey.PROJECT_MAP$OPEN_CONVERSATION)}
          </button>
        </div>
      )}
      <button
        type="button"
        data-testid="project-map-generate"
        className={PROJECT_MAP_PRIMARY_BUTTON_CLASS}
        disabled={pending}
        onClick={onGenerate}
      >
        <Sparkles size={ICON_SIZE} aria-hidden />
        {pending
          ? t(I18nKey.PROJECT_MAP$STARTING_CONVERSATION)
          : t(I18nKey.PROJECT_MAP$GENERATE)}
      </button>
    </div>
  );
}
