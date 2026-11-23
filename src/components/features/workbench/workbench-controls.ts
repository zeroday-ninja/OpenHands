/**
 * The small vocabulary of control recipes and accent lookups the workbench
 * shares between its panels, so a chip in the chat and a chip on the board
 * stay identical rather than drifting a pixel at a time.
 *
 * Accents are theme tokens (`map-accent-1..6`), never colours. The SVG side
 * takes a `var()` reference for `stroke`/`fill` attributes; the HTML side takes
 * a static class, because Tailwind cannot see a class it has to compute.
 */

import type { WorkbenchAccent } from "#/types/workbench";

export const WORKBENCH_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50";

export const WORKBENCH_PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50";

export const WORKBENCH_ICON_BUTTON_CLASS =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle bg-surface text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-interactive-selected";

export const WORKBENCH_CHIP_CLASS =
  "inline-flex max-w-52 items-center gap-1.5 rounded-md border border-border-subtle bg-interactive-hover px-2 py-1 text-xs text-foreground";

export const WORKBENCH_SECTION_LABEL_CLASS =
  "flex items-center justify-between text-micro font-semibold uppercase tracking-widest text-muted";

export const WORKBENCH_PANEL_CLASS =
  "flex flex-col gap-4 overflow-y-auto border-border-subtle bg-base-secondary p-3 custom-scrollbar";

export const WORKBENCH_INPUT_CLASS =
  "w-full rounded-md border border-border-input bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** For SVG paint attributes. */
export function accentVar(accent: WorkbenchAccent): string {
  return `var(--color-map-accent-${accent})`;
}

const ACCENT_BG: Record<WorkbenchAccent, string> = {
  1: "bg-map-accent-1",
  2: "bg-map-accent-2",
  3: "bg-map-accent-3",
  4: "bg-map-accent-4",
  5: "bg-map-accent-5",
  6: "bg-map-accent-6",
};

const ACCENT_TEXT: Record<WorkbenchAccent, string> = {
  1: "text-map-accent-1",
  2: "text-map-accent-2",
  3: "text-map-accent-3",
  4: "text-map-accent-4",
  5: "text-map-accent-5",
  6: "text-map-accent-6",
};

const ACCENT_BORDER: Record<WorkbenchAccent, string> = {
  1: "border-map-accent-1",
  2: "border-map-accent-2",
  3: "border-map-accent-3",
  4: "border-map-accent-4",
  5: "border-map-accent-5",
  6: "border-map-accent-6",
};

export function accentBgClass(accent: WorkbenchAccent) {
  return ACCENT_BG[accent];
}
export function accentTextClass(accent: WorkbenchAccent) {
  return ACCENT_TEXT[accent];
}
export function accentBorderClass(accent: WorkbenchAccent) {
  return ACCENT_BORDER[accent];
}

/** A round avatar with initials, used for roles and agents everywhere. */
export const WORKBENCH_AVATAR_CLASS =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-on-primary";

/** MIME-ish types for the HTML5 drags the workbench understands. */
export const WORKBENCH_DRAG_TYPES = {
  /** A new part from the library: payload is the kind. */
  libraryPart: "application/x-openhands-workbench-part-kind",
  /** A repo chip: payload is the repo id. */
  repo: "application/x-openhands-workbench-repo",
  /** A team member or agent: payload is the agent id. */
  agent: "application/x-openhands-workbench-agent",
  /** A canvas part dragged out of the canvas (to chat or bin): the part id. */
  part: "application/x-openhands-workbench-part",
  /** A board card: the work item id. */
  item: "application/x-openhands-workbench-item",
} as const;

/**
 * Focus (and select) a field that appeared because the user asked for it, such
 * as an inline rename. A module-level callback ref keeps a stable identity, so
 * it runs once on mount and not again on an unrelated re-render.
 */
export function focusOnMount(element: HTMLInputElement | null) {
  element?.focus();
  element?.select();
}
