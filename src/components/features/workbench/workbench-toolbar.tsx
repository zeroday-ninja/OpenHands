/**
 * The bar above the stage: which project, which view, which tool, what is
 * drawn over the map, and the undo history. It also carries the way back to
 * the classic conversation UI, which stays reachable until the workbench has
 * everything it has.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Highlighter,
  Layers,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { NavigationLink } from "#/components/shared/navigation-link";
import { useNavigation } from "#/context/navigation-context";
import {
  useWorkbenchStore,
  type WorkbenchOverlays,
} from "#/stores/workbench-store";
import {
  WORKBENCH_ROUTE_PATH,
  type WorkbenchDocument,
  type WorkbenchMode,
  type WorkbenchProject,
} from "#/types/workbench";
import { cn } from "#/utils/utils";
import {
  WORKBENCH_BUTTON_CLASS,
  WORKBENCH_ICON_BUTTON_CLASS,
} from "./workbench-controls";

const MODES: WorkbenchMode[] = ["design", "work"];
const OVERLAYS: (keyof WorkbenchOverlays)[] = [
  "agents",
  "changes",
  "tests",
  "drift",
];

const MODE_KEYS: Record<WorkbenchMode, I18nKey> = {
  design: I18nKey.WORKBENCH$MODE_DESIGN,
  work: I18nKey.WORKBENCH$MODE_WORK,
};

const OVERLAY_KEYS: Record<keyof WorkbenchOverlays, I18nKey> = {
  agents: I18nKey.WORKBENCH$OVERLAY_AGENTS,
  changes: I18nKey.WORKBENCH$OVERLAY_CHANGES,
  tests: I18nKey.WORKBENCH$OVERLAY_TESTS,
  drift: I18nKey.WORKBENCH$OVERLAY_DRIFT,
};

export interface WorkbenchToolbarProps {
  document: WorkbenchDocument;
  project: WorkbenchProject;
  saving: boolean;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onSaveNow: () => void;
}

export function WorkbenchToolbar({
  document: doc,
  project,
  saving,
  onZoom,
  onFit,
  onSaveNow,
}: WorkbenchToolbarProps) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const mode = useWorkbenchStore((s) => s.mode);
  const tool = useWorkbenchStore((s) => s.tool);
  const level = useWorkbenchStore((s) => s.level);
  const overlays = useWorkbenchStore((s) => s.overlays);
  const autopilot = useWorkbenchStore((s) => s.autopilot);
  const dirty = useWorkbenchStore((s) => s.dirty);
  const canUndo = useWorkbenchStore((s) => s.past.length > 0);
  const canRedo = useWorkbenchStore((s) => s.future.length > 0);
  const {
    setMode,
    setTool,
    setLevel,
    toggleOverlay,
    setAutopilot,
    undo,
    redo,
    clearHighlights,
  } = useWorkbenchStore.getState();
  const highlights = doc.highlights.length;

  return (
    <header
      data-testid="workbench-toolbar"
      className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-base-secondary px-3 py-2"
    >
      <div className="relative">
        <select
          data-testid="workbench-project-select"
          aria-label={t(I18nKey.WORKBENCH$PROJECT)}
          className="appearance-none rounded-md border border-border-subtle bg-surface py-1.5 pl-2.5 pr-7 text-sm font-semibold text-foreground outline-none focus-visible:outline-2 focus-visible:outline-focus"
          value={project.id}
          onChange={(event) =>
            navigate(`${WORKBENCH_ROUTE_PATH}/${event.target.value}`)
          }
        >
          {doc.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      <NavigationLink
        to={WORKBENCH_ROUTE_PATH}
        className="text-xs text-text-secondary hover:underline"
        data-testid="workbench-all-projects"
      >
        {t(I18nKey.WORKBENCH$ALL_PROJECTS)}
      </NavigationLink>

      <div
        role="group"
        aria-label={t(I18nKey.WORKBENCH$VIEW)}
        className="ml-2 flex rounded-md border border-border-subtle bg-surface p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`workbench-mode-${m}`}
            aria-pressed={mode === m}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium",
              mode === m
                ? "bg-interactive-selected text-foreground"
                : "text-text-secondary hover:bg-interactive-hover",
            )}
            onClick={() => setMode(m)}
          >
            {t(MODE_KEYS[m])}
          </button>
        ))}
      </div>

      {mode === "design" && (
        <>
          <div
            role="group"
            aria-label={t(I18nKey.WORKBENCH$TOOL)}
            className="flex items-center gap-1"
          >
            <button
              type="button"
              data-testid="workbench-tool-select"
              aria-pressed={tool === "select"}
              className={WORKBENCH_ICON_BUTTON_CLASS}
              aria-label={t(I18nKey.WORKBENCH$TOOL_SELECT)}
              data-tip={`${t(I18nKey.WORKBENCH$TOOL_SELECT)} (V)`}
              onClick={() => setTool("select")}
            >
              <MousePointer2 size={14} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="workbench-tool-highlight"
              aria-pressed={tool === "highlight"}
              className={WORKBENCH_ICON_BUTTON_CLASS}
              aria-label={t(I18nKey.WORKBENCH$TOOL_HIGHLIGHT)}
              data-tip={`${t(I18nKey.WORKBENCH$TOOL_HIGHLIGHT)} (H)`}
              onClick={() =>
                setTool(tool === "highlight" ? "select" : "highlight")
              }
            >
              <Highlighter size={14} aria-hidden />
            </button>
            {highlights > 0 && (
              <button
                type="button"
                data-testid="workbench-clear-highlights"
                className={WORKBENCH_BUTTON_CLASS}
                onClick={clearHighlights}
              >
                {t(I18nKey.WORKBENCH$CLEAR_HIGHLIGHTS)}
              </button>
            )}
            <button
              type="button"
              data-testid="workbench-level"
              aria-pressed={level === "repos"}
              className={WORKBENCH_ICON_BUTTON_CLASS}
              aria-label={t(I18nKey.WORKBENCH$MENU_SHOW_REPOS)}
              data-tip={
                level === "parts"
                  ? t(I18nKey.WORKBENCH$MENU_SHOW_REPOS)
                  : t(I18nKey.WORKBENCH$MENU_SHOW_PARTS)
              }
              onClick={() => setLevel(level === "parts" ? "repos" : "parts")}
            >
              <Layers size={14} aria-hidden />
            </button>
          </div>
          <div
            role="group"
            aria-label={t(I18nKey.WORKBENCH$OVERLAYS)}
            className="flex items-center gap-1"
          >
            {OVERLAYS.map((overlay) => (
              <button
                key={overlay}
                type="button"
                data-testid={`workbench-overlay-${overlay}`}
                aria-pressed={overlays[overlay]}
                className={cn(
                  WORKBENCH_BUTTON_CLASS,
                  "py-1",
                  overlays[overlay] && "border-primary bg-interactive-selected",
                )}
                onClick={() => toggleOverlay(overlay)}
              >
                {t(OVERLAY_KEYS[overlay])}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label={t(I18nKey.WORKBENCH$ZOOM)}
            className="flex items-center gap-1"
          >
            <button
              type="button"
              data-testid="workbench-zoom-in"
              className={WORKBENCH_ICON_BUTTON_CLASS}
              aria-label={t(I18nKey.WORKBENCH$ZOOM_IN)}
              onClick={() => onZoom(1.2)}
            >
              <Plus size={14} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="workbench-zoom-out"
              className={WORKBENCH_ICON_BUTTON_CLASS}
              aria-label={t(I18nKey.WORKBENCH$ZOOM_OUT)}
              onClick={() => onZoom(1 / 1.2)}
            >
              <Minus size={14} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="workbench-fit"
              className={WORKBENCH_ICON_BUTTON_CLASS}
              aria-label={t(I18nKey.WORKBENCH$FIT)}
              data-tip={`${t(I18nKey.WORKBENCH$FIT)} (0)`}
              onClick={onFit}
            >
              <Maximize size={14} aria-hidden />
            </button>
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          data-testid="workbench-autopilot"
          role="switch"
          aria-checked={autopilot}
          className={cn(WORKBENCH_BUTTON_CLASS, autopilot && "border-success")}
          data-tip={t(I18nKey.WORKBENCH$AUTOPILOT_TIP)}
          onClick={() => setAutopilot(!autopilot)}
        >
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              autopilot ? "bg-success" : "bg-muted",
            )}
          />
          {autopilot
            ? t(I18nKey.WORKBENCH$AUTOPILOT_ON)
            : t(I18nKey.WORKBENCH$AUTOPILOT_OFF)}
        </button>
        <button
          type="button"
          data-testid="workbench-undo"
          className={WORKBENCH_ICON_BUTTON_CLASS}
          aria-label={t(I18nKey.WORKBENCH$UNDO)}
          data-tip={`${t(I18nKey.WORKBENCH$UNDO)} (Ctrl+Z)`}
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 size={14} aria-hidden />
        </button>
        <button
          type="button"
          data-testid="workbench-redo"
          className={WORKBENCH_ICON_BUTTON_CLASS}
          aria-label={t(I18nKey.WORKBENCH$REDO)}
          data-tip={`${t(I18nKey.WORKBENCH$REDO)} (Ctrl+Y)`}
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 size={14} aria-hidden />
        </button>
        <button
          type="button"
          data-testid="workbench-save"
          className={WORKBENCH_BUTTON_CLASS}
          disabled={!dirty || saving}
          onClick={onSaveNow}
          data-tip={t(I18nKey.WORKBENCH$SAVE_TIP)}
        >
          <Save size={12} aria-hidden />
          {saving
            ? t(I18nKey.WORKBENCH$SAVING)
            : dirty
              ? t(I18nKey.WORKBENCH$SAVE)
              : t(I18nKey.WORKBENCH$SAVED)}
        </button>
        <NavigationLink
          to="/conversations"
          data-testid="workbench-classic-link"
          className={cn(WORKBENCH_BUTTON_CLASS, "ml-1")}
        >
          {t(I18nKey.WORKBENCH$CLASSIC_VIEW)}
        </NavigationLink>
      </div>
    </header>
  );
}
