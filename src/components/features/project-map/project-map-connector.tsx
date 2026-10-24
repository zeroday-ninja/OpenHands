/**
 * One line the user drew, and the line being drawn right now.
 *
 * Separate from the analysed edge renderer for the same reason the shape is
 * separate from the plate: an analysed edge is routed orthogonally because it
 * is a claim the reader follows, while a drawn line goes where it was drawn.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { ProjectMapConnector } from "#/types/project-map";
import {
  projectMapAccentToken,
  projectMapConnectorPath,
  projectMapEdgeHeadPath,
  resolveProjectMapAccent,
} from "#/utils/project-map/project-map-visuals";
import { useProjectMapStore } from "#/stores/project-map-store";

interface Point {
  x: number;
  y: number;
}

/** Dash pattern per style, in diagram units. */
const DASH: Record<ProjectMapConnector["dash"], string | undefined> = {
  solid: undefined,
  dashed: "7 5",
  dotted: "1 4",
};

/** Which way the head points, from the last run of the line. */
function directionOf(from: Point, to: Point): "right" | "left" | "down" | "up" {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

export interface ProjectMapConnectorMarkProps {
  connector: ProjectMapConnector;
  from: Point;
  to: Point;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
}

export function ProjectMapConnectorMark({
  connector,
  from,
  to,
  selected,
  onPointerDown,
}: ProjectMapConnectorMarkProps) {
  const { t } = useTranslation("openhands");
  const editingConnectorLabel = useProjectMapStore(
    (state) => state.editingConnectorLabel,
  );
  const setEditingConnectorLabel = useProjectMapStore(
    (state) => state.setEditingConnectorLabel,
  );
  const updateConnector = useProjectMapStore((state) => state.updateConnector);

  const accent = projectMapAccentToken(
    resolveProjectMapAccent(connector.accent, connector.id),
  );
  const points = [from, ...connector.waypoints, to];
  const last = points[points.length - 2] ?? from;
  const head = projectMapEdgeHeadPath(
    connector.head,
    to,
    directionOf(last, to),
  );
  const middle = points[Math.floor(points.length / 2)] ?? to;
  const editing = editingConnectorLabel === connector.id;
  const placeholder = t(I18nKey.PROJECT_MAP$CONNECTOR_LABEL_PLACEHOLDER);

  return (
    <g
      data-testid={`project-map-connector-${connector.id}`}
      data-selected={selected ? "true" : "false"}
      onPointerDown={onPointerDown}
    >
      {/* A wide transparent line under the visible one: a 1px stroke is
          almost impossible to hit with a pointer, and a line you cannot
          select is a line you cannot delete. */}
      <path
        d={projectMapConnectorPath(from, to, connector.waypoints)}
        className="fill-none stroke-transparent"
        strokeWidth={12}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={projectMapConnectorPath(from, to, connector.waypoints)}
        className="fill-none"
        stroke={accent}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={DASH[connector.dash]}
        vectorEffect="non-scaling-stroke"
      />
      {head !== null && (
        <path d={head} fill={accent} stroke={accent} strokeWidth={1} />
      )}
      {editing ? (
        <foreignObject
          x={middle.x - 60}
          y={middle.y - 12}
          width={120}
          height={24}
        >
          <input
            ref={(element) => element?.focus()}
            aria-label={placeholder}
            placeholder={placeholder}
            defaultValue={connector.label ?? ""}
            data-testid={`project-map-connector-label-${connector.id}`}
            className="h-full w-full bg-surface-raised px-1 text-micro text-foreground outline-none placeholder:text-muted"
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              updateConnector(connector.id, {
                label: value === "" ? null : value,
              });
              setEditingConnectorLabel(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && event.key !== "Enter") return;
              event.stopPropagation();
              event.currentTarget.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </foreignObject>
      ) : (
        connector.label !== null && (
          <text
            x={middle.x}
            y={middle.y - 4}
            textAnchor="middle"
            className="fill-muted"
            fontSize={11}
          >
            {connector.label}
          </text>
        )
      )}
    </g>
  );
}

/** The line being dragged out, before it attaches to anything. */
export function ProjectMapConnectorDraft({
  from,
  to,
}: {
  from: Point;
  to: Point;
}) {
  return (
    <path
      data-testid="project-map-connector-draft"
      d={projectMapConnectorPath(from, to, [])}
      className="fill-none stroke-border-strong"
      strokeWidth={1.5}
      strokeDasharray="4 4"
      vectorEffect="non-scaling-stroke"
    />
  );
}
