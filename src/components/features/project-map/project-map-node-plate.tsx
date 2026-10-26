/**
 * One node, drawn as a plate.
 *
 * The plate is paper and ink: a surface-coloured fill, a hairline outline in
 * the group's accent, and a faint wash of the same accent so a group reads as
 * a region even when the labels are too small to read. No shadow and no
 * gradient — a drawing you can read at a glance is a drawing with one visual
 * variable per piece of meaning, and those are already spent on silhouette
 * (what it is) and accent (where it belongs).
 *
 * Colour never enters as a literal: `accent` is always a `var(--color-map-*)`
 * reference, so a committed map follows the theme.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { PlacedProjectMapNode } from "#/types/project-map";
import { projectMapNodeSize } from "#/utils/project-map/project-map-layout";
import { projectMapSilhouette } from "#/utils/project-map/project-map-visuals";
import {
  PROJECT_MAP_NODE_KIND_LABELS,
  projectMapNodeDomId,
} from "./project-map-labels";

/** Horizontal inset of the type from the plate's edge. */
const TEXT_INSET = 14;
/** Rough advance width of the label face at 12px, for truncation. */
const LABEL_ADVANCE = 6.6;
/** Rough advance width of the mono path face at 9.5px. */
const PATH_ADVANCE = 5.3;
/** Below this height the path line has nowhere to sit. */
const PATH_MIN_HEIGHT = 44;

/** Shoulder between the plate and its crop marks, and the arm length of one. */
const MARK_OFFSET = 5;
const MARK_ARM = 10;

/** Four corner brackets around the plate's box: the selection mark. */
function cropMarks(width: number, height: number): string {
  const x0 = -MARK_OFFSET;
  const y0 = -MARK_OFFSET;
  const x1 = width + MARK_OFFSET;
  const y1 = height + MARK_OFFSET;
  const a = MARK_ARM;
  return [
    `M${x0} ${y0 + a}V${y0}H${x0 + a}`,
    `M${x1 - a} ${y0}H${x1}V${y0 + a}`,
    `M${x1} ${y1 - a}V${y1}H${x1 - a}`,
    `M${x0 + a} ${y1}H${x0}V${y1 - a}`,
  ].join("");
}

function truncate(text: string, width: number, advance: number): string {
  const room = Math.floor((width - TEXT_INSET * 2) / advance);
  if (room <= 1) return "";
  if (text.length <= room) return text;
  return `${text.slice(0, Math.max(1, room - 1))}…`;
}

export interface ProjectMapNodePlateProps {
  node: PlacedProjectMapNode;
  /** A `var(--color-map-accent-N)` reference, never a colour. */
  accent: string;
  selected: boolean;
  focused: boolean;
  /** False while the selection's neighbourhood is elsewhere. */
  lit: boolean;
  /** False when the drawing is too small for the path line to be legible. */
  showPath: boolean;
  /** True when a change that stopped to ask a person names this part. */
  waiting: boolean;
  onFocus: (node: PlacedProjectMapNode) => void;
  onKeyDown: (
    event: React.KeyboardEvent<SVGGElement>,
    node: PlacedProjectMapNode,
  ) => void;
  onPointerDown: (
    event: React.PointerEvent<SVGGElement>,
    node: PlacedProjectMapNode,
  ) => void;
}

function ProjectMapNodePlateMark({
  node,
  accent,
  selected,
  focused,
  lit,
  showPath,
  waiting,
  onFocus,
  onKeyDown,
  onPointerDown,
}: ProjectMapNodePlateProps) {
  const { t } = useTranslation("openhands");
  const { width, height } = projectMapNodeSize(node.size);
  const silhouette = projectMapSilhouette(node.kind, width, height);
  const kind = t(PROJECT_MAP_NODE_KIND_LABELS[node.kind]);
  const centred = height < PATH_MIN_HEIGHT || !showPath || node.path === null;

  return (
    <g
      id={projectMapNodeDomId(node.id)}
      data-testid={`project-map-node-${node.id}`}
      data-selected={selected ? "true" : undefined}
      data-waiting={waiting ? "true" : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${kind} ${node.label}`}
      transform={`translate(${node.x} ${node.y})`}
      opacity={lit ? 1 : 0.18}
      className="cursor-pointer outline-none"
      onFocus={() => onFocus(node)}
      onKeyDown={(event) => onKeyDown(event, node)}
      // Selection is decided on release, in the canvas: a press that captures
      // the pointer retargets the `click` that follows, so a handler here
      // would never run for a press that started on this plate.
      onPointerDown={(event) => onPointerDown(event, node)}
    >
      {/* Crop marks rather than a glow. A drawing points at something by
          bracketing it, and four corners work for every silhouette without
          having to grow an arbitrary path. */}
      {(selected || focused) && (
        <path
          d={cropMarks(width, height)}
          vectorEffect="non-scaling-stroke"
          fill="none"
          stroke={accent}
          strokeWidth={selected ? 1.5 : 1}
          strokeDasharray={focused && !selected ? "3 2" : undefined}
        />
      )}
      <path
        d={silhouette.outline}
        fill="var(--color-surface)"
        stroke={accent}
        strokeWidth={node.hidden ? 1 : 1.25}
        strokeDasharray={silhouette.dashed || node.hidden ? "5 4" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={silhouette.outline}
        fill={accent}
        fillOpacity={0.07}
        stroke="none"
      />
      {silhouette.detail !== null && (
        <path
          d={silhouette.detail}
          fill="none"
          stroke={accent}
          strokeOpacity={0.55}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text
        x={TEXT_INSET}
        y={centred ? height / 2 + 4 : height / 2 - 2}
        fontSize={12}
        fontWeight={500}
        className="pointer-events-none fill-foreground"
      >
        {truncate(node.label, width, LABEL_ADVANCE)}
      </text>
      {!centred && node.path !== null && (
        <text
          x={TEXT_INSET}
          y={height / 2 + 12}
          fontSize={9.5}
          className="pointer-events-none fill-muted font-mono"
        >
          {truncate(node.path, width, PATH_ADVANCE)}
        </text>
      )}
      {node.pinned && (
        // A drafting tick in the corner: this one was placed by hand.
        <path
          d={`M${width - 9} 4V11M${width - 12.5} 7.5H${width - 5.5}`}
          stroke={accent}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {node.hidden && <title>{t(I18nKey.PROJECT_MAP$SHOW_HIDDEN)}</title>}
      {/* Last, so it is on top: a silhouette whose shape reaches its own
          top-right corner — a route's tag, a component's notch — painted
          over a mark drawn before it, and three of the five kinds hid it
          completely. The rail promises to answer what waits "on the map",
          which a dot under the drawing does not. */}
      {waiting && (
        <circle
          data-testid="project-map-waiting-mark"
          cx={width - 6}
          cy={6}
          r={5}
          className="fill-warning stroke-canvas-base"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        >
          <title>{t(I18nKey.PROJECT_MAP$WAITING_PART)}</title>
        </circle>
      )}
    </g>
  );
}

/**
 * A plate re-renders when something about *it* changes, not when the paper
 * moves under it.
 *
 * Panning sets the viewport on every pointer move, which re-renders the
 * canvas; without this, each of those re-rendered every plate on the paper.
 * Measured on a 113-plate map: 28.8 ms median per pointer move against a
 * 16.7 ms frame. The handlers are stable by construction on the canvas side,
 * so they can be compared by identity like everything else.
 */
export const ProjectMapNodePlate = React.memo(
  ProjectMapNodePlateMark,
  (before, after) =>
    before.node === after.node &&
    before.accent === after.accent &&
    before.selected === after.selected &&
    before.focused === after.focused &&
    before.lit === after.lit &&
    before.showPath === after.showPath &&
    before.waiting === after.waiting &&
    before.onFocus === after.onFocus &&
    before.onKeyDown === after.onKeyDown &&
    before.onPointerDown === after.onPointerDown,
);
