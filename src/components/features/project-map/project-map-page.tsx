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
 * The consequence is that the chat here is a launcher: a live transcript needs
 * the conversation WebSocket, which is scoped to a conversation route. Sending
 * from the map opens a conversation with the selection already in its first
 * message, which keeps the one property the feature cannot do without — the
 * agent and the user editing the same artifact — without pretending the page
 * hosts an event stream it does not.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Eye, RefreshCw, Save, Sparkles } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useNavigation } from "#/context/navigation-context";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { useSaveProjectMap } from "#/hooks/mutation/use-save-project-map";
import { useProjectMap } from "#/hooks/query/use-project-map";
import {
  PROJECT_MAP_MAX_SCALE,
  PROJECT_MAP_MIN_SCALE,
  useProjectMapStore,
} from "#/stores/project-map-store";
import { PROJECT_MAP_VERSION } from "#/types/project-map";
import {
  fitProjectMapViewBox,
  projectMapBounds,
} from "#/utils/project-map/project-map-layout";
import { PROJECT_MAP_ANALYSIS_PROMPT } from "./project-map-analysis-prompt";
import { ProjectMapCanvas } from "./project-map-canvas";
import { ProjectMapChat } from "./project-map-chat";
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
  const { data, isLoading, error, unsupportedReason, refetch } =
    useProjectMap();
  const saveProjectMap = useSaveProjectMap();
  const createConversation = useCreateConversation();

  const document_ = useProjectMapStore((state) => state.document);
  const dirty = useProjectMapStore((state) => state.dirty);
  const showHidden = useProjectMapStore((state) => state.showHidden);
  const hydrate = useProjectMapStore((state) => state.hydrate);
  const markSaved = useProjectMapStore((state) => state.markSaved);
  const toggleShowHidden = useProjectMapStore(
    (state) => state.toggleShowHidden,
  );
  const setViewport = useProjectMapStore((state) => state.setViewport);

  // Synchronisation with an external system — the file on disk. `hydrate`
  // ignores a repeat of the same revision, so a refetch that found no change
  // never discards unsaved work.
  React.useEffect(() => {
    if (!data?.document) return;
    hydrate(
      `${data.absolutePath}@${data.document.generated_at ?? ""}@${data.document.commit ?? ""}`,
      data.document,
    );
  }, [data, hydrate]);

  const generate = async () => {
    const conversation = await createConversation.mutateAsync({
      query: PROJECT_MAP_ANALYSIS_PROMPT,
    });
    navigate(`/conversations/${conversation.conversation_id}`);
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
        <Notice testId="project-map-unsupported">
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
          {t(I18nKey.PROJECT_MAP$READ_FAILED, {
            path: data?.absolutePath ?? "",
          })}
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
              <ProjectMapInspector
                document={document_}
                onOpenInFiles={(node) =>
                  navigate(
                    `/conversations?path=${encodeURIComponent(node.path ?? "")}`,
                  )
                }
              />
            </div>
            <ProjectMapChat document={document_} />
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
}: {
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
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
