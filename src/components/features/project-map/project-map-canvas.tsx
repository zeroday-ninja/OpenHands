/**
 * The drawing surface.
 *
 * Everything is one SVG under a single `translate … scale` group, so panning
 * and zooming are attribute changes rather than per-element layout, and
 * screen-to-diagram conversion is one subtraction and one division. Positions
 * ride on SVG `transform` attributes, which is also why the file needs no
 * inline styles at all.
 *
 * Pointer grammar, chosen to match what the shapes are: dragging a plate moves
 * it, dragging the paper moves the paper, shift-dragging the paper sweeps a
 * selection, and the wheel zooms about the pointer so the thing under the
 * cursor stays under the cursor.
 *
 * Keyboard grammar: every plate is a tab stop, the arrow keys step to the
 * nearest plate in that direction, Enter selects, shift+Enter adds to the
 * selection, Escape clears. A diagram that only works with a mouse excludes
 * people.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type {
  PlacedProjectMapDocument,
  PlacedProjectMapNode,
  ProjectMapNote,
} from "#/types/project-map";
import {
  PROJECT_MAP_GRID,
  projectMapGroupBounds,
  projectMapNodeSize,
} from "#/utils/project-map/project-map-layout";
import {
  PROJECT_MAP_GROUP_NODE_PREFIX,
  projectMapArrowTarget,
  projectMapFocusIds,
  projectMapRenderModel,
} from "#/utils/project-map/project-map-graph";
import {
  projectMapAccentToken,
  projectMapEdgeGeometry,
  projectMapEdgeHeadPath,
  projectMapEdgeStyle,
  resolveProjectMapAccent,
  type Rect,
} from "#/utils/project-map/project-map-visuals";
import {
  PROJECT_MAP_MAX_SCALE,
  PROJECT_MAP_MIN_SCALE,
  useProjectMapStore,
} from "#/stores/project-map-store";
import { ProjectMapNodePlate } from "./project-map-node-plate";
import { projectMapNodeDomId } from "./project-map-labels";

/** Height of a collapsed group's plate. */
const COLLAPSED_HEIGHT = 56;
/** Width of the gap left in a group boundary for its label. */
const GROUP_LABEL_PADDING = 12;
/** Below this zoom the grid and the path lines stop helping and start buzzing. */
const DETAIL_SCALE = 0.62;

/**
 * jsdom's SVG elements have no Pointer Capture API, and a drag that keeps
 * working without it is better than a page that throws in tests.
 */
function capturePointer(element: Element | null, pointerId: number) {
  if (typeof element?.setPointerCapture === "function") {
    element.setPointerCapture(pointerId);
  }
}

type Drag =
  | {
      kind: "pan";
      pointerId: number;
      from: { x: number; y: number };
      origin: { x: number; y: number };
    }
  | {
      kind: "marquee";
      pointerId: number;
      from: { x: number; y: number };
      to: { x: number; y: number };
    }
  | {
      kind: "node";
      pointerId: number;
      ids: string[];
      from: { x: number; y: number };
      to: { x: number; y: number };
    };

export interface ProjectMapCanvasProps {
  document: PlacedProjectMapDocument;
  frameRef: React.RefObject<SVGSVGElement | null>;
}

export function ProjectMapCanvas({
  document: map,
  frameRef,
}: ProjectMapCanvasProps) {
  const { t } = useTranslation("openhands");
  const viewport = useProjectMapStore((state) => state.viewport);
  const selection = useProjectMapStore((state) => state.selection);
  const focused = useProjectMapStore((state) => state.focused);
  const showHidden = useProjectMapStore((state) => state.showHidden);
  const setViewport = useProjectMapStore((state) => state.setViewport);
  const setSelection = useProjectMapStore((state) => state.setSelection);
  const toggleInSelection = useProjectMapStore(
    (state) => state.toggleInSelection,
  );
  const clearSelection = useProjectMapStore((state) => state.clearSelection);
  const setFocused = useProjectMapStore((state) => state.setFocused);
  const moveSelection = useProjectMapStore((state) => state.moveSelection);
  const setGroupCollapsed = useProjectMapStore(
    (state) => state.setGroupCollapsed,
  );

  const [drag, setDrag] = React.useState<Drag | null>(null);

  const model = React.useMemo(() => projectMapRenderModel(map), [map]);
  const drawn = React.useMemo(
    () =>
      showHidden
        ? [...model.nodes, ...map.nodes.filter((node) => node.hidden)]
        : model.nodes,
    [model.nodes, map.nodes, showHidden],
  );
  const focusIds = React.useMemo(
    () => projectMapFocusIds(selection, map.edges),
    [selection, map.edges],
  );

  const accentOf = React.useCallback(
    (groupId: string | null) => {
      if (groupId === null) return "var(--color-border-subtle)";
      const group = map.groups.find((candidate) => candidate.id === groupId);
      return projectMapAccentToken(
        resolveProjectMapAccent(group?.accent ?? null, groupId),
      );
    },
    [map.groups],
  );

  /** Where a plate sits, including the live offset of a drag in progress. */
  const rectOf = React.useCallback(
    (nodeId: string): Rect | null => {
      if (nodeId.startsWith(PROJECT_MAP_GROUP_NODE_PREFIX)) {
        const groupId = nodeId.slice(PROJECT_MAP_GROUP_NODE_PREFIX.length);
        const bounds = projectMapGroupBounds(map.nodes, groupId);
        if (bounds === null) return null;
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: COLLAPSED_HEIGHT,
        };
      }
      const node = drawn.find((candidate) => candidate.id === nodeId);
      if (!node) return null;
      const { width, height } = projectMapNodeSize(node.size);
      const offset =
        drag?.kind === "node" && drag.ids.includes(nodeId)
          ? { x: drag.to.x - drag.from.x, y: drag.to.y - drag.from.y }
          : { x: 0, y: 0 };
      return { x: node.x + offset.x, y: node.y + offset.y, width, height };
    },
    [drawn, drag, map.nodes],
  );

  /** Pointer position in diagram coordinates. */
  const toDiagram = React.useCallback(
    (event: { clientX: number; clientY: number }) => {
      const frame = frameRef.current?.getBoundingClientRect();
      if (!frame) return { x: 0, y: 0 };
      return {
        x: viewport.x + (event.clientX - frame.left) / viewport.scale,
        y: viewport.y + (event.clientY - frame.top) / viewport.scale,
      };
    },
    [frameRef, viewport],
  );

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const anchor = toDiagram(event);
    const next = Math.min(
      PROJECT_MAP_MAX_SCALE,
      Math.max(
        PROJECT_MAP_MIN_SCALE,
        viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1),
      ),
    );
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    // Keep whatever is under the cursor under the cursor.
    setViewport({
      scale: next,
      x: anchor.x - (event.clientX - frame.left) / next,
      y: anchor.y - (event.clientY - frame.top) / next,
    });
  };

  const handleBackgroundPointerDown = (
    event: React.PointerEvent<SVGSVGElement>,
  ) => {
    if (event.button !== 0) return;
    const point = toDiagram(event);
    capturePointer(event.currentTarget, event.pointerId);
    setDrag(
      event.shiftKey
        ? {
            kind: "marquee",
            pointerId: event.pointerId,
            from: point,
            to: point,
          }
        : {
            kind: "pan",
            pointerId: event.pointerId,
            from: point,
            origin: { x: viewport.x, y: viewport.y },
          },
    );
  };

  const handleNodePointerDown = (
    event: React.PointerEvent<SVGGElement>,
    node: PlacedProjectMapNode,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const additive = event.shiftKey || event.metaKey;
    const ids = selection.includes(node.id)
      ? selection
      : additive
        ? [...selection, node.id]
        : [node.id];
    if (!selection.includes(node.id)) setSelection(ids);
    const point = toDiagram(event);
    capturePointer(frameRef.current, event.pointerId);
    setDrag({
      kind: "node",
      pointerId: event.pointerId,
      ids,
      from: point,
      to: point,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.pointerId !== event.pointerId) return;
    const point = toDiagram(event);
    if (drag.kind === "pan") {
      setViewport({
        scale: viewport.scale,
        x: drag.origin.x - (point.x - drag.from.x),
        y: drag.origin.y - (point.y - drag.from.y),
      });
      return;
    }
    setDrag({ ...drag, to: point });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.kind === "node") {
      const dx = drag.to.x - drag.from.x;
      const dy = drag.to.y - drag.from.y;
      if (dx !== 0 || dy !== 0) moveSelection(drag.ids, dx, dy);
    }
    if (drag.kind === "marquee") {
      const box = marqueeBox(drag);
      const swept = drawn
        .filter((node) => {
          const rect = rectOf(node.id);
          return (
            rect !== null &&
            rect.x + rect.width >= box.x &&
            rect.x <= box.x + box.width &&
            rect.y + rect.height >= box.y &&
            rect.y <= box.y + box.height
          );
        })
        .map((node) => node.id);
      if (swept.length > 0) setSelection(swept);
      else clearSelection();
    }
    setDrag(null);
  };

  const handleNodeKeyDown = (
    event: React.KeyboardEvent<SVGGElement>,
    node: PlacedProjectMapNode,
  ) => {
    const arrow = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    } as const;
    const direction = arrow[event.key as keyof typeof arrow];
    if (direction) {
      event.preventDefault();
      const target = projectMapArrowTarget(drawn, node.id, direction);
      if (target === null) return;
      setFocused(target);
      frameRef.current?.ownerDocument
        .getElementById(projectMapNodeDomId(target))
        ?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.shiftKey) toggleInSelection(node.id);
      else setSelection([node.id]);
    }
  };

  const transform = `translate(${-viewport.x * viewport.scale} ${-viewport.y * viewport.scale}) scale(${viewport.scale})`;
  const detailed = viewport.scale >= DETAIL_SCALE;

  return (
    <svg
      ref={frameRef}
      data-testid="project-map-canvas"
      role="application"
      aria-label={t(I18nKey.PROJECT_MAP$CANVAS_LABEL)}
      className="h-full w-full touch-none select-none bg-canvas-base"
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key === "Escape") clearSelection();
      }}
    >
      <desc>{t(I18nKey.PROJECT_MAP$CANVAS_HELP)}</desc>
      <defs>
        <pattern
          id="project-map-grid"
          width={PROJECT_MAP_GRID}
          height={PROJECT_MAP_GRID}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={0.5} cy={0.5} r={0.75} className="fill-map-grid" />
        </pattern>
      </defs>

      <g transform={transform}>
        {detailed && (
          <rect
            x={-10000}
            y={-10000}
            width={30000}
            height={30000}
            fill="url(#project-map-grid)"
          />
        )}

        {/* Group boundaries, drawn first so the plates sit on them. */}
        {map.groups.map((group) => {
          const bounds = projectMapGroupBounds(
            group.collapsed ? map.nodes : drawn,
            group.id,
          );
          if (bounds === null) return null;
          const accent = accentOf(group.id);
          const labelWidth = group.label.length * 6 + GROUP_LABEL_PADDING * 2;
          return (
            <g key={group.id} data-testid={`project-map-group-${group.id}`}>
              {group.collapsed ? (
                <rect
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={COLLAPSED_HEIGHT}
                  fill={accent}
                  fillOpacity={0.1}
                  stroke={accent}
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                // The boundary breaks for its own label, the way a section
                // callout does on a plate. That break is the group's signature.
                <path
                  d={groupBoundary(bounds, labelWidth)}
                  fill="none"
                  stroke={accent}
                  strokeOpacity={0.6}
                  strokeWidth={1}
                  strokeDasharray="7 5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <text
                x={bounds.x + GROUP_LABEL_PADDING}
                y={bounds.y + (group.collapsed ? 22 : 4)}
                fill={accent}
                fontSize={10}
                fontWeight={600}
                letterSpacing={1.4}
                className="uppercase"
              >
                {group.label}
              </text>
              {group.collapsed && (
                <text
                  x={bounds.x + GROUP_LABEL_PADDING}
                  y={bounds.y + 40}
                  fontSize={9.5}
                  className="fill-muted font-mono"
                >
                  {map.nodes.filter((node) => node.group === group.id).length}
                </text>
              )}
            </g>
          );
        })}

        {/* Edges under the plates: a line should pass behind what it joins. */}
        <g>
          {model.edges.map((edge) => {
            const from = rectOf(edge.from);
            const to = rectOf(edge.to);
            if (from === null || to === null) return null;
            const geometry = projectMapEdgeGeometry(from, to);
            const style = projectMapEdgeStyle(edge.kind);
            const head = projectMapEdgeHeadPath(
              style.head,
              geometry.tip,
              geometry.direction,
            );
            const lit =
              focusIds.size === 0 ||
              focusIds.has(edge.from) ||
              focusIds.has(edge.to);
            const accent = accentOf(
              drawn.find((node) => node.id === edge.from)?.group ?? null,
            );
            return (
              <g
                key={edge.key}
                opacity={lit ? 0.85 : 0.1}
                data-testid={`project-map-edge-${edge.key}`}
              >
                <path
                  d={geometry.d}
                  fill="none"
                  stroke={accent}
                  strokeWidth={style.weight}
                  strokeDasharray={style.dash ?? undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {head !== null && (
                  <path
                    d={head}
                    fill={
                      style.head === "open"
                        ? "var(--color-canvas-base)"
                        : accent
                    }
                    stroke={accent}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          })}
        </g>

        {drawn.map((node) => (
          <ProjectMapNodePlate
            key={node.id}
            node={
              drag?.kind === "node" && drag.ids.includes(node.id)
                ? {
                    ...node,
                    x: node.x + drag.to.x - drag.from.x,
                    y: node.y + drag.to.y - drag.from.y,
                  }
                : node
            }
            accent={accentOf(node.group)}
            selected={selection.includes(node.id)}
            focused={focused === node.id}
            lit={focusIds.size === 0 || focusIds.has(node.id)}
            showPath={detailed}
            onSelect={(target, additive) =>
              additive
                ? toggleInSelection(target.id)
                : setSelection([target.id])
            }
            onFocus={(target) => setFocused(target.id)}
            onKeyDown={handleNodeKeyDown}
            onPointerDown={handleNodePointerDown}
          />
        ))}

        {map.notes.map((note) => (
          <ProjectMapNoteMark
            key={note.id}
            note={note}
            anchorRect={note.anchor === null ? null : rectOf(note.anchor)}
          />
        ))}

        {/* Group controls come last in document order so tabbing reaches the
            plates first, while the boundaries above still paint underneath
            them. Paint order and tab order are different questions. */}
        {map.groups.map((group) => {
          const bounds = projectMapGroupBounds(
            group.collapsed ? map.nodes : drawn,
            group.id,
          );
          if (bounds === null) return null;
          const accent = accentOf(group.id);
          return (
            <g
              key={group.id}
              role="button"
              tabIndex={0}
              data-testid={`project-map-group-toggle-${group.id}`}
              aria-label={t(
                group.collapsed
                  ? I18nKey.PROJECT_MAP$EXPAND_GROUP
                  : I18nKey.PROJECT_MAP$COLLAPSE_GROUP,
              )}
              aria-expanded={!group.collapsed}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                setGroupCollapsed(group.id, !group.collapsed);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setGroupCollapsed(group.id, !group.collapsed);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <rect
                x={bounds.x + bounds.width - 26}
                y={bounds.y - 8}
                width={18}
                height={16}
                fill="var(--color-surface)"
                stroke={accent}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={
                  group.collapsed
                    ? `M${bounds.x + bounds.width - 21} ${bounds.y}h8M${bounds.x + bounds.width - 17} ${bounds.y - 4}v8`
                    : `M${bounds.x + bounds.width - 21} ${bounds.y}h8`
                }
                stroke={accent}
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {drag?.kind === "marquee" && (
          <rect
            {...marqueeBox(drag)}
            data-testid="project-map-marquee"
            fill="var(--color-focus)"
            fillOpacity={0.12}
            stroke="var(--color-focus)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
    </svg>
  );
}

function marqueeBox(drag: Extract<Drag, { kind: "marquee" }>) {
  return {
    x: Math.min(drag.from.x, drag.to.x),
    y: Math.min(drag.from.y, drag.to.y),
    width: Math.abs(drag.to.x - drag.from.x),
    height: Math.abs(drag.to.y - drag.from.y),
  };
}

/**
 * A group's boundary with a gap in the top edge for its label. Drawn as one
 * path so the gap is part of the line rather than a rectangle painted over it,
 * which would need to know the paper colour.
 */
function groupBoundary(
  bounds: { x: number; y: number; width: number; height: number },
  labelWidth: number,
): string {
  const { x, y, width, height } = bounds;
  const gapStart = x + GROUP_LABEL_PADDING - 4;
  const gapEnd = Math.min(x + width - 32, gapStart + labelWidth);
  return [
    `M${gapStart} ${y}H${x}V${y + height}H${x + width}V${y}H${gapEnd}`,
  ].join("");
}

/**
 * A remark on the drawing: a boxed note on a leader line to its subject, which
 * is how an annotation appears on a plate. Not a yellow sticky — the map is
 * ink on paper and a skeuomorphic note would be the one object in it pretending
 * to be something else.
 */
function ProjectMapNoteMark({
  note,
  anchorRect,
}: {
  note: ProjectMapNote;
  anchorRect: Rect | null;
}) {
  const lines = note.text.split("\n").slice(0, 3);
  const width = Math.max(120, Math.min(220, note.text.length * 5.6));
  const height = 16 + lines.length * 13;
  return (
    <g data-testid={`project-map-note-${note.id}`}>
      {anchorRect !== null && (
        <path
          d={`M${note.x} ${note.y}L${anchorRect.x + anchorRect.width / 2} ${anchorRect.y + anchorRect.height / 2}`}
          className="stroke-border-subtle"
          strokeWidth={1}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <rect
        x={note.x}
        y={note.y}
        width={width}
        height={height}
        className="fill-surface-raised stroke-border-subtle"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {lines.map((line, index) => (
        <text
          key={index}
          x={note.x + 9}
          y={note.y + 20 + index * 13}
          fontSize={10.5}
          className="fill-text-secondary"
        >
          {line.slice(0, 40)}
        </text>
      ))}
    </g>
  );
}
