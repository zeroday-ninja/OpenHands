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
 * from a route that names a conversation; `ProjectMapConversation` binds one to
 * the pane explicitly instead, so the first send opens a conversation and the
 * answer arrives here rather than on another page. Asking what something is,
 * being told, and pointing at it on the drawing are then one activity instead
 * of three.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Eye, RefreshCw, Save, Sparkles } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useNavigation } from "#/context/navigation-context";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { useSaveProjectMap } from "#/hooks/mutation/use-save-project-map";
import { useProjectMap } from "#/hooks/query/use-project-map";
import { useRefreshProjectMapOnAgentEdit } from "#/hooks/use-refresh-project-map-on-agent-edit";
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
  const frameRef = React.useRef<SVGSVGElement | null>(null);
  const { data, isLoading, error, unsupportedReason, attemptedPath, refetch } =
    useProjectMap();
  const saveProjectMap = useSaveProjectMap();
  const createConversation = useCreateConversation();
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

  // The map is named by its absolute path so the analysis writes the file the
  // page reads: a conversation's working directory is a subdirectory of the
  // one this page looks in.
  const mapPath = attemptedPath ?? PROJECT_MAP_FILE_PATH;

  const generate = async () => {
    try {
      const conversation = await createConversation.mutateAsync({
        query: buildProjectMapAnalysisPrompt(mapPath),
      });
      navigate(`/conversations/${conversation.conversation_id}`);
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

  return (
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
          onGenerate={() => void generate()}
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
            <ProjectMapConversation document={document_} mapPath={mapPath} />
            <ProjectMapLegend document={document_} />
          </aside>
        </div>
      )}
    </div>
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
  onGenerate,
}: {
  pending: boolean;
  onGenerate: () => void;
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
