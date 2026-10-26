/**
 * The drawing tools, and what to do with what is drawn.
 *
 * A strip of buttons rather than a menu: the tool in hand changes what a press
 * on the paper means, so which one is active has to be visible without
 * opening anything.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  PROJECT_MAP_LAYOUT_KINDS,
  type ProjectMapMode,
  ProjectMapLayoutKind,
} from "#/types/project-map";
import {
  PROJECT_MAP_TOOLS,
  useProjectMapStore,
  type ProjectMapTool,
} from "#/stores/project-map-store";

const TOOL_LABELS: Record<ProjectMapTool, I18nKey> = {
  select: I18nKey.PROJECT_MAP$TOOL_SELECT,
  box: I18nKey.PROJECT_MAP$TOOL_BOX,
  diamond: I18nKey.PROJECT_MAP$TOOL_DIAMOND,
  sticky: I18nKey.PROJECT_MAP$TOOL_STICKY,
  frame: I18nKey.PROJECT_MAP$TOOL_FRAME,
  branch: I18nKey.PROJECT_MAP$TOOL_BRANCH,
  connect: I18nKey.PROJECT_MAP$TOOL_CONNECT,
};

const LAYOUT_LABELS: Record<ProjectMapLayoutKind, I18nKey> = {
  tree: I18nKey.PROJECT_MAP$LAYOUT_TREE,
  radial: I18nKey.PROJECT_MAP$LAYOUT_RADIAL,
  layered: I18nKey.PROJECT_MAP$LAYOUT_LAYERED,
  free: I18nKey.PROJECT_MAP$LAYOUT_FREE,
};

const BUTTON_CLASS =
  "rounded-md border border-border-subtle px-2 py-1 text-micro text-muted hover:text-content disabled:opacity-40";
const ACTIVE_CLASS = "border-primary text-content";

export function ProjectMapToolPalette({ mode }: { mode: ProjectMapMode }) {
  const { t } = useTranslation("openhands");
  // The drawing tools and the layouts act on the drawn layer, which the
  // analysis mode does not show. Offering them there is a row of buttons that
  // do nothing visible — most of the chrome on a first visit, since a
  // generated map opens in that mode. Undo and redo apply to everything.
  const drawing = mode !== "derived";
  const tool = useProjectMapStore((state) => state.tool);
  const setTool = useProjectMapStore((state) => state.setTool);
  const runLayout = useProjectMapStore((state) => state.runLayout);
  const undo = useProjectMapStore((state) => state.undo);
  const redo = useProjectMapStore((state) => state.redo);
  const past = useProjectMapStore((state) => state.past);
  const future = useProjectMapStore((state) => state.future);

  return (
    <div
      data-testid="project-map-tool-palette"
      role="toolbar"
      aria-label={t(I18nKey.PROJECT_MAP$TOOLS_LABEL)}
      className="flex flex-wrap items-center gap-1.5"
    >
      {drawing &&
        PROJECT_MAP_TOOLS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            data-testid={`project-map-tool-${candidate}`}
            aria-pressed={tool === candidate}
            className={`${BUTTON_CLASS} ${tool === candidate ? ACTIVE_CLASS : ""}`}
            onClick={() => setTool(candidate)}
          >
            {t(TOOL_LABELS[candidate])}
          </button>
        ))}

      {drawing && (
        <span className="mx-1 text-micro text-muted">
          {t(I18nKey.PROJECT_MAP$ARRANGE)}
        </span>
      )}
      {drawing &&
        PROJECT_MAP_LAYOUT_KINDS.filter((kind) => kind !== "free").map(
          (kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`project-map-layout-${kind}`}
              className={BUTTON_CLASS}
              onClick={() => runLayout(kind)}
            >
              {t(LAYOUT_LABELS[kind])}
            </button>
          ),
        )}

      <button
        type="button"
        data-testid="project-map-undo"
        className={BUTTON_CLASS}
        disabled={past.length === 0}
        onClick={() => undo()}
      >
        {t(I18nKey.PROJECT_MAP$UNDO)}
      </button>
      <button
        type="button"
        data-testid="project-map-redo"
        className={BUTTON_CLASS}
        disabled={future.length === 0}
        onClick={() => redo()}
      >
        {t(I18nKey.PROJECT_MAP$REDO)}
      </button>
    </div>
  );
}
