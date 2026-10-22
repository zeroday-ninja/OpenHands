/**
 * The small set of control recipes the map's side panel uses.
 *
 * The panel is deliberately plain: all of the map's visual personality lives
 * on the canvas, and a side panel competing with it would make both harder to
 * read. These are collected here so the inspector, the actions and the
 * composer stay identical rather than drifting a pixel at a time.
 */

/** A quiet control: text and a hairline, used for everything secondary. */
export const PROJECT_MAP_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50";

/** The one emphasised control in a group of them. */
export const PROJECT_MAP_PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50";

/** A row in a list of edges, which is also a link to the node at its far end. */
export const PROJECT_MAP_EDGE_ROW_CLASS =
  "flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** A removable chip naming one selected node above the composer. */
export const PROJECT_MAP_CHIP_CLASS =
  "group flex max-w-52 items-center gap-1.5 rounded-md border border-border-subtle bg-interactive-hover px-2 py-1 text-xs text-foreground";

/** A section heading inside the panel. */
export const PROJECT_MAP_SECTION_LABEL_CLASS =
  "text-micro font-semibold uppercase tracking-widest text-muted";
