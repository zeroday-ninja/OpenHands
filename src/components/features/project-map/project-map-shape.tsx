/**
 * One shape the user drew.
 *
 * Deliberately a sibling of the node plate rather than a variant of it: a
 * plate asserts something about the repository and is drawn from facts the
 * analysis reported, while a shape means whatever the person drawing it meant
 * and carries its own geometry. Giving them one component would make every
 * later change ask "is this the analysed one or the drawn one?".
 *
 * Text is laid out arithmetically, the way the plate's labels are, because the
 * only measurement APIs that would do better do not exist in jsdom — so a
 * measured layout would be a layout no test could see.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { ProjectMapShape } from "#/types/project-map";
import {
  projectMapAccentToken,
  projectMapShapeOutline,
  resolveProjectMapAccent,
  type Rect,
} from "#/utils/project-map/project-map-visuals";
import { useProjectMapStore } from "#/stores/project-map-store";

/** Rough advance width of the shape face at 12px, for wrapping. */
const TEXT_ADVANCE = 6.4;
const TEXT_INSET = 10;
const LINE_HEIGHT = 15;

/** Side of a resize handle, in diagram units. */
export const SHAPE_HANDLE_SIZE = 8;

export type ProjectMapShapeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export const PROJECT_MAP_SHAPE_HANDLES: ProjectMapShapeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** Where a handle sits on a shape's box. */
export function shapeHandlePoint(
  rect: Rect,
  handle: ProjectMapShapeHandle,
): { x: number; y: number } {
  const left = rect.x;
  const middle = rect.x + rect.width / 2;
  const right = rect.x + rect.width;
  const top = rect.y;
  const center = rect.y + rect.height / 2;
  const bottom = rect.y + rect.height;
  const byHandle: Record<ProjectMapShapeHandle, { x: number; y: number }> = {
    nw: { x: left, y: top },
    n: { x: middle, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: center },
    se: { x: right, y: bottom },
    s: { x: middle, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: center },
  };
  return byHandle[handle];
}

/** Wraps on whitespace into as many lines as the box has room for. */
function wrap(text: string, width: number, height: number): string[] {
  const room = Math.max(1, Math.floor((width - TEXT_INSET * 2) / TEXT_ADVANCE));
  const maxLines = Math.max(1, Math.floor((height - 8) / LINE_HEIGHT));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= room) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = word.length > room ? `${word.slice(0, room - 1)}…` : word;
    if (lines.length === maxLines) break;
  }
  if (current !== "" && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

export interface ProjectMapShapeMarkProps {
  shape: ProjectMapShape;
  /** Where it sits right now, including any drag in progress. */
  rect: Rect;
  selected: boolean;
  focused: boolean;
  /** Only the single selected shape offers handles. */
  resizable: boolean;
  /**
   * The three handlers take the shape back, rather than being closures over
   * it. A closure is a new function on every render of the canvas, and a new
   * function on every render is a prop change: it would re-render all two
   * hundred shapes on every move of a drag, which is what `React.memo` below
   * exists to stop.
   */
  onPointerDown: (
    event: React.PointerEvent<SVGGElement>,
    shape: ProjectMapShape,
  ) => void;
  onHandlePointerDown: (
    event: React.PointerEvent<SVGRectElement>,
    shape: ProjectMapShape,
    handle: ProjectMapShapeHandle,
  ) => void;
  onKeyDown: (
    event: React.KeyboardEvent<SVGGElement>,
    shape: ProjectMapShape,
  ) => void;
}

function ProjectMapShapeMarkMark({
  shape,
  rect,
  selected,
  focused,
  resizable,
  onPointerDown,
  onHandlePointerDown,
  onKeyDown,
}: ProjectMapShapeMarkProps) {
  const { t } = useTranslation("openhands");
  const editingShape = useProjectMapStore((state) => state.editingShape);
  const setEditingShape = useProjectMapStore((state) => state.setEditingShape);
  const updateShapeText = useProjectMapStore((state) => state.updateShapeText);

  const editing = editingShape === shape.id;
  const accent = projectMapAccentToken(
    resolveProjectMapAccent(shape.accent, shape.id),
  );
  const outline = projectMapShapeOutline(shape.kind, rect.width, rect.height);
  const placeholder = t(I18nKey.PROJECT_MAP$SHAPE_PLACEHOLDER);
  const empty = shape.text.trim() === "";
  const lines = wrap(empty ? placeholder : shape.text, rect.width, rect.height);
  const frame = shape.kind === "frame";
  const textTop =
    rect.y +
    (frame
      ? LINE_HEIGHT
      : Math.max(
          LINE_HEIGHT,
          rect.height / 2 - (lines.length - 1) * LINE_HEIGHT * 0.5,
        ));

  return (
    <g
      data-testid={`project-map-shape-${shape.id}`}
      data-shape-kind={shape.kind}
      data-selected={selected ? "true" : "false"}
      role="button"
      tabIndex={0}
      aria-label={empty ? placeholder : shape.text}
      id={`project-map-shape-${shape.id}`}
      className="cursor-move outline-none"
      onPointerDown={(event) => onPointerDown(event, shape)}
      // Double-click is how every drawing tool opens a label, and the press
      // that starts it is a drag that went nowhere, so it costs nothing.
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditingShape(shape.id);
      }}
      onKeyDown={(event) => onKeyDown(event, shape)}
    >
      <g transform={`translate(${rect.x} ${rect.y})`}>
        <path
          d={outline}
          // A frame is a region, so it is outlined and left see-through; a
          // shape is an object, so it is filled.
          className={frame ? "fill-transparent" : "fill-surface-raised"}
          stroke={accent}
          strokeWidth={selected || focused ? 2 : 1.5}
          strokeDasharray={frame ? "6 4" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </g>
      {editing ? (
        <foreignObject
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
        >
          <textarea
            ref={(element) => element?.focus()}
            aria-label={placeholder}
            placeholder={placeholder}
            defaultValue={shape.text}
            data-testid={`project-map-shape-text-${shape.id}`}
            className="h-full w-full resize-none bg-transparent px-2 py-1 text-micro text-foreground outline-none placeholder:text-muted"
            onBlur={(event) => {
              updateShapeText(shape.id, event.currentTarget.value);
              setEditingShape(null);
            }}
            onKeyDown={(event) => {
              // Escape here means "done with this text", not "clear the
              // selection", so it must not reach the canvas.
              if (event.key !== "Escape") return;
              event.stopPropagation();
              event.currentTarget.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </foreignObject>
      ) : (
        <text
          x={rect.x + TEXT_INSET}
          y={textTop}
          className={empty ? "fill-muted" : "fill-foreground"}
          fontSize={12}
        >
          {lines.map((line, index) => (
            <tspan
              key={`${shape.id}-line-${index.toString()}`}
              x={rect.x + TEXT_INSET}
              dy={index === 0 ? 0 : LINE_HEIGHT}
            >
              {line}
            </tspan>
          ))}
        </text>
      )}
      {resizable &&
        PROJECT_MAP_SHAPE_HANDLES.map((handle) => {
          const point = shapeHandlePoint(rect, handle);
          return (
            <rect
              key={handle}
              data-testid={`project-map-shape-handle-${shape.id}-${handle}`}
              x={point.x - SHAPE_HANDLE_SIZE / 2}
              y={point.y - SHAPE_HANDLE_SIZE / 2}
              width={SHAPE_HANDLE_SIZE}
              height={SHAPE_HANDLE_SIZE}
              className="fill-surface-raised stroke-border-subtle"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(event) =>
                onHandlePointerDown(event, shape, handle)
              }
            />
          );
        })}
    </g>
  );
}

/**
 * One drawn shape, re-rendered only when something about *it* changed.
 *
 * Milestone 1's metric is that pointer-move handling stays inside one frame
 * at two hundred shapes, and it did not: every move of a drag re-rendered
 * every shape, because the rectangle index is rebuilt each render and each
 * shape was handed a fresh `rect` object and three fresh closures. Measured
 * on a production build at two hundred shapes, a move cost 16.8 ms of a
 * 16.67 ms frame — and 41 ms on a dev build, which is what a developer sees.
 *
 * The rectangle is compared by value because that is the one prop that
 * legitimately changes identity every render; everything else is compared by
 * identity, and the handlers are stable by construction on the canvas side.
 */
export const ProjectMapShapeMark = React.memo(
  ProjectMapShapeMarkMark,
  (before, after) =>
    before.shape === after.shape &&
    before.selected === after.selected &&
    before.focused === after.focused &&
    before.resizable === after.resizable &&
    before.onPointerDown === after.onPointerDown &&
    before.onHandlePointerDown === after.onHandlePointerDown &&
    before.onKeyDown === after.onKeyDown &&
    before.rect.x === after.rect.x &&
    before.rect.y === after.rect.y &&
    before.rect.width === after.rect.width &&
    before.rect.height === after.rect.height,
);
