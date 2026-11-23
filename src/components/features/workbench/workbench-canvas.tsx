/**
 * The Design view: every repo in the project as a group, its parts inside,
 * wires between parts within and across repos, hand-drawn highlights, and
 * where the autonomous work currently is.
 *
 * Direct manipulation is the primary interface here, so this component is
 * mostly gestures: drag a part (or several) to move it, drag it into another
 * group to move it there, drag a group's title bar to move the whole group,
 * drag from a part's port to draw a planned wire, shift-drag to lasso, draw
 * with the highlight tool to circle anything, drop a library part, a repo chip
 * or a team member from the side panel, and right-click anything for its
 * actions. Every edit is one undo step in the store.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  WORKBENCH_KIND_BADGES,
  WORKBENCH_PART_HEIGHT,
  WORKBENCH_PART_KINDS,
  WORKBENCH_PART_STATUSES,
  WORKBENCH_PART_WIDTH,
  WORKBENCH_WIRE_LABELS,
  type WorkbenchAgent,
  type WorkbenchDocument,
  type WorkbenchPart,
  type WorkbenchPoint,
  type WorkbenchProject,
  type WorkbenchRepo,
} from "#/types/workbench";
import { useWorkbenchStore } from "#/stores/workbench-store";
import {
  GROUP_TITLE_HEIGHT,
  fitViewport,
  groupBox,
  highlightPath,
  partBox,
  partOrigin,
  partsInBox,
  partsInsidePolygon,
  repoAtPoint,
  repoById,
  toCanvasPoint,
  visibleBounds,
  wireAnchor,
  wirePath,
  zoomViewport,
  type WorkbenchBox,
} from "#/utils/workbench/workbench-geometry";
import { cn } from "#/utils/utils";
import {
  WORKBENCH_DRAG_TYPES,
  accentVar,
  focusOnMount,
} from "./workbench-controls";
import type { WorkbenchMenuItem } from "./workbench-context-menu";
import {
  KIND_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  WIRE_LABEL_KEYS,
} from "./workbench-labels";

const PORT_RADIUS = 5;
const WHEEL_ZOOM = 0.0015;
const LASSO_MIN = 6;

type Gesture =
  | {
      type: "pan";
      startX: number;
      startY: number;
      viewX: number;
      viewY: number;
    }
  | {
      type: "part";
      ids: string[];
      start: WorkbenchPoint;
      at?: WorkbenchPoint;
      origins: Map<string, WorkbenchPoint>;
      moved: boolean;
    }
  | {
      type: "group";
      repoId: string;
      start: WorkbenchPoint;
      at?: WorkbenchPoint;
      origin: WorkbenchPoint;
      moved: boolean;
    }
  | { type: "wire"; from: string; at: WorkbenchPoint }
  | { type: "lasso"; start: WorkbenchPoint; at: WorkbenchPoint }
  | { type: "highlight"; points: WorkbenchPoint[] };

export interface WorkbenchCanvasProps {
  document: WorkbenchDocument;
  project: WorkbenchProject;
  openMenu: (
    event: React.MouseEvent,
    items: WorkbenchMenuItem[],
    title?: string,
  ) => void;
  showToast: (text: string, canUndo?: boolean) => void;
  /** Focus the chat on these parts (and open it). */
  onAsk: (partIds: string[]) => void;
  /** Start a crawl of a repo that has no map yet. */
  onCrawl: (repo: WorkbenchRepo) => void;
  /** Put a team member or agent onto a part. */
  onAgentDrop: (agentId: string, partId: string) => void;
  /** Ask the PM for a story about a part. */
  onStoryFor: (part: WorkbenchPart) => void;
}

export function WorkbenchCanvas({
  document: doc,
  project,
  openMenu,
  showToast,
  onAsk,
  onCrawl,
  onAgentDrop,
  onStoryFor,
}: WorkbenchCanvasProps) {
  const { t } = useTranslation("openhands");
  const svgRef = React.useRef<SVGSVGElement>(null);
  const gesture = React.useRef<Gesture | null>(null);
  const [live, setLive] = React.useState<Gesture | null>(null);
  const [renaming, setRenaming] = React.useState<{
    id: string;
    value: string;
  } | null>(null);

  const selection = useWorkbenchStore((s) => s.selection);
  const tool = useWorkbenchStore((s) => s.tool);
  const level = useWorkbenchStore((s) => s.level);
  const viewport = useWorkbenchStore((s) => s.viewport);
  const overlays = useWorkbenchStore((s) => s.overlays);
  const dropRepoId = useWorkbenchStore((s) => s.dropRepoId);
  const hoverAgentId = useWorkbenchStore((s) => s.hoverAgentId);
  const {
    setSelection,
    togglePart,
    clearSelection,
    setViewport,
    setTool,
    setLevel,
    setDropRepo,
    moveParts,
    moveRepo,
    addPart,
    renamePart,
    setPartStatus,
    movePartToRepo,
    deleteParts,
    addWire,
    setWireLabel,
    deleteWire,
    addHighlight,
    deleteHighlight,
    clearHighlights,
    addRepoToProject,
    removeRepoFromProject,
    renameRepo,
  } = useWorkbenchStore.getState();

  const repoIds = project.repoIds;
  const repos = doc.repos.filter((repo) => repoIds.includes(repo.id));
  const parts = doc.parts.filter((part) => repoIds.includes(part.repoId));
  const partIds = new Set(parts.map((part) => part.id));
  const wires = doc.wires.filter(
    (wire) => partIds.has(wire.from) && partIds.has(wire.to),
  );
  const partMap = new Map(parts.map((part) => [part.id, part]));

  const screenToCanvas = (event: {
    clientX: number;
    clientY: number;
  }): WorkbenchPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    return toCanvasPoint(viewport, {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    });
  };

  // A drag in flight is drawn as an offset from the committed positions; the
  // document only changes when the pointer is released.
  const d: WorkbenchPoint =
    (live?.type === "part" || live?.type === "group") && live.at
      ? { x: live.at.x - live.start.x, y: live.at.y - live.start.y }
      : { x: 0, y: 0 };
  const movingParts = live?.type === "part" ? new Set(live.ids) : null;
  const movingRepo = live?.type === "group" ? live.repoId : null;

  const boxOf = (part: WorkbenchPart): WorkbenchBox => {
    const repo = repoById(doc, part.repoId);
    const box = partBox(part, repo);
    const shift =
      movingParts?.has(part.id) || movingRepo === part.repoId
        ? d
        : { x: 0, y: 0 };
    return {
      x0: box.x0 + shift.x,
      y0: box.y0 + shift.y,
      x1: box.x1 + shift.x,
      y1: box.y1 + shift.y,
    };
  };

  const fit = React.useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    setViewport(
      fitViewport(
        visibleBounds(doc, repoIds),
        rect?.width ?? 0,
        rect?.height ?? 0,
      ),
    );
  }, [doc, repoIds, setViewport]);

  // Frame the project the first time it is drawn, and whenever the project changes.
  const framedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (framedFor.current === project.id) return;
    framedFor.current = project.id;
    fit();
  }, [project.id, fit]);

  // ---- pointer gestures ----
  const begin = (event: React.PointerEvent, next: Gesture) => {
    gesture.current = next;
    setLive(next);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onEmptyPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    if (
      event.target !== event.currentTarget &&
      !(event.target as Element).hasAttribute("data-paper")
    )
      return;
    const at = screenToCanvas(event);
    if (tool === "highlight") {
      begin(event, { type: "highlight", points: [at] });
      return;
    }
    if (event.shiftKey) {
      begin(event, { type: "lasso", start: at, at });
      return;
    }
    if (!event.ctrlKey && !event.metaKey) clearSelection();
    begin(event, {
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      viewX: viewport.x,
      viewY: viewport.y,
    });
  };

  const onPartPointerDown = (
    event: React.PointerEvent,
    part: WorkbenchPart,
  ) => {
    if (event.button === 2 || tool === "highlight") return;
    event.stopPropagation();
    let ids: string[];
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      togglePart(part.id);
      ids = useWorkbenchStore.getState().selection.partIds;
    } else if (selection.partIds.includes(part.id)) {
      ids = selection.partIds;
    } else {
      setSelection({ partIds: [part.id] });
      ids = [part.id];
    }
    const at = screenToCanvas(event);
    const origins = new Map(
      ids.map((id) => {
        const p = partMap.get(id);
        return [id, p ? { x: p.x, y: p.y } : { x: 0, y: 0 }];
      }),
    );
    begin(event, { type: "part", ids, start: at, origins, moved: false });
  };

  const onGroupPointerDown = (
    event: React.PointerEvent,
    repo: WorkbenchRepo,
  ) => {
    if (event.button === 2 || tool === "highlight") return;
    event.stopPropagation();
    const at = screenToCanvas(event);
    begin(event, {
      type: "group",
      repoId: repo.id,
      start: at,
      origin: { x: repo.x, y: repo.y },
      moved: false,
    });
  };

  const onPortPointerDown = (
    event: React.PointerEvent,
    part: WorkbenchPart,
  ) => {
    if (event.button === 2) return;
    event.stopPropagation();
    begin(event, { type: "wire", from: part.id, at: screenToCanvas(event) });
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const at = screenToCanvas(event);
    switch (g.type) {
      case "pan":
        setViewport({
          ...viewport,
          x: g.viewX + (event.clientX - g.startX),
          y: g.viewY + (event.clientY - g.startY),
        });
        return;
      case "part":
      case "group": {
        const next: Gesture = { ...g, at, moved: true };
        gesture.current = next;
        setLive(next);
        if (g.type === "part") {
          const over = repoAtPoint(doc, repoIds, at);
          setDropRepo(
            over && g.ids.some((id) => partMap.get(id)?.repoId !== over.id)
              ? over.id
              : null,
          );
        }
        return;
      }
      case "wire":
      case "lasso": {
        const next = { ...g, at };
        gesture.current = next;
        setLive(next);
        return;
      }
      case "highlight": {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(at.x - last.x, at.y - last.y) < 4) return;
        const next = { ...g, points: [...g.points, at] };
        gesture.current = next;
        setLive(next);
        return;
      }
      default:
    }
  };

  const partAt = (
    point: WorkbenchPoint,
    except?: string,
  ): WorkbenchPart | null =>
    parts.find(
      (part) =>
        part.id !== except &&
        (() => {
          const box = partBox(part, repoById(doc, part.repoId));
          return (
            point.x >= box.x0 &&
            point.x <= box.x1 &&
            point.y >= box.y0 &&
            point.y <= box.y1
          );
        })(),
    ) ?? null;

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setLive(null);
    setDropRepo(null);
    if (!g) return;
    const at = screenToCanvas(event);
    switch (g.type) {
      case "part": {
        if (!g.moved) return;
        const dx = at.x - g.start.x;
        const dy = at.y - g.start.y;
        const over = repoAtPoint(doc, repoIds, at);
        const foreign =
          over &&
          g.ids.length === 1 &&
          partMap.get(g.ids[0])?.repoId !== over.id;
        if (foreign && over) {
          const part = partMap.get(g.ids[0]);
          if (!part) return;
          const origin = partOrigin(part, repoById(doc, part.repoId));
          movePartToRepo(part.id, over.id, {
            x: origin.x + dx - over.x,
            y: origin.y + dy - over.y,
          });
          showToast(
            t(I18nKey.WORKBENCH$TOAST_MOVED_TO_REPO, {
              name: part.name,
              repo: over.name,
            }),
            true,
          );
          return;
        }
        moveParts(
          g.ids.map((id) => {
            const from = g.origins.get(id) ?? { x: 0, y: 0 };
            return { id, x: from.x + dx, y: from.y + dy };
          }),
        );
        return;
      }
      case "group": {
        if (!g.moved) {
          const repoParts = parts
            .filter((part) => part.repoId === g.repoId)
            .map((part) => part.id);
          setSelection({ partIds: repoParts });
          return;
        }
        moveRepo(
          g.repoId,
          g.origin.x + (at.x - g.start.x),
          g.origin.y + (at.y - g.start.y),
        );
        return;
      }
      case "wire": {
        const target = partAt(at, g.from);
        if (target) {
          addWire(g.from, target.id, "planned");
          showToast(t(I18nKey.WORKBENCH$TOAST_WIRE_ADDED), true);
        }
        return;
      }
      case "lasso": {
        if (
          Math.abs(at.x - g.start.x) < LASSO_MIN &&
          Math.abs(at.y - g.start.y) < LASSO_MIN
        )
          return;
        const hit = partsInBox(doc, repoIds, {
          x0: g.start.x,
          y0: g.start.y,
          x1: at.x,
          y1: at.y,
        });
        setSelection({ partIds: hit.map((part) => part.id) });
        return;
      }
      case "highlight": {
        if (g.points.length < 3) return;
        addHighlight(g.points);
        const inside = partsInsidePolygon(doc, repoIds, g.points);
        if (inside.length > 0)
          setSelection({ partIds: inside.map((part) => part.id) });
        showToast(
          t(I18nKey.WORKBENCH$TOAST_HIGHLIGHT_ADDED, { count: inside.length }),
          true,
        );
        return;
      }
      default:
    }
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const around = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
    setViewport(
      zoomViewport(viewport, Math.exp(-event.deltaY * WHEEL_ZOOM), around),
    );
  };

  // ---- HTML5 drops from the side panel ----
  const dragKind = (event: React.DragEvent) =>
    Object.values(WORKBENCH_DRAG_TYPES).find((type) =>
      event.dataTransfer.types.includes(type),
    ) ?? null;

  const onDragOver = (event: React.DragEvent<SVGSVGElement>) => {
    const kind = dragKind(event);
    if (!kind) return;
    event.preventDefault();
    const { dataTransfer } = event;
    dataTransfer.dropEffect =
      kind === WORKBENCH_DRAG_TYPES.repo ? "copy" : "move";
    const over = repoAtPoint(doc, repoIds, screenToCanvas(event));
    setDropRepo(
      kind === WORKBENCH_DRAG_TYPES.libraryPart ? (over?.id ?? null) : null,
    );
  };

  const onDrop = (event: React.DragEvent<SVGSVGElement>) => {
    const kind = dragKind(event);
    setDropRepo(null);
    if (!kind) return;
    event.preventDefault();
    const at = screenToCanvas(event);
    const payload = event.dataTransfer.getData(kind);
    if (kind === WORKBENCH_DRAG_TYPES.libraryPart) {
      const partKind = WORKBENCH_PART_KINDS.find((k) => k === payload);
      if (!partKind) return;
      const target = partAt(at);
      const repo = target
        ? repoById(doc, target.repoId)
        : repoAtPoint(doc, repoIds, at);
      if (!repo) {
        showToast(t(I18nKey.WORKBENCH$TOAST_DROP_INTO_REPO));
        return;
      }
      const name = t(I18nKey.WORKBENCH$NEW_PART_NAME, {
        kind: t(KIND_LABEL_KEYS[partKind]),
      });
      const slot = target
        ? { x: target.x + WORKBENCH_PART_WIDTH + 40, y: target.y }
        : {
            x: at.x - repo.x - WORKBENCH_PART_WIDTH / 2,
            y: at.y - repo.y - WORKBENCH_PART_HEIGHT / 2,
          };
      const id = addPart(repo.id, partKind, name, slot);
      if (target) addWire(target.id, id, "planned");
      setSelection({ partIds: [id] });
      setRenaming({ id, value: name });
      return;
    }
    if (kind === WORKBENCH_DRAG_TYPES.repo) {
      const repo = repoById(doc, payload);
      if (!repo) return;
      addRepoToProject(project.id, repo.id);
      moveRepo(repo.id, at.x, at.y + GROUP_TITLE_HEIGHT);
      showToast(
        t(I18nKey.WORKBENCH$TOAST_REPO_ADDED, { name: repo.name }),
        true,
      );
      if (!repo.hasMap && !doc.parts.some((part) => part.repoId === repo.id))
        onCrawl(repo);
      return;
    }
    if (kind === WORKBENCH_DRAG_TYPES.agent) {
      const target = partAt(at);
      if (target) onAgentDrop(payload, target.id);
    }
  };

  // ---- context menus ----
  const statusItems = (part: WorkbenchPart): WorkbenchMenuItem[] =>
    WORKBENCH_PART_STATUSES.map((status) => ({
      id: `status-${status}`,
      label: t(STATUS_LABEL_KEYS[status]),
      checked: part.status === status,
      onSelect: () => setPartStatus(part.id, status),
    }));

  const moveItems = (part: WorkbenchPart): WorkbenchMenuItem[] =>
    repos
      .filter((repo) => repo.id !== part.repoId)
      .map((repo) => ({
        id: `move-${repo.id}`,
        label: repo.name,
        onSelect: () => {
          movePartToRepo(part.id, repo.id);
          showToast(
            t(I18nKey.WORKBENCH$TOAST_MOVED_TO_REPO, {
              name: part.name,
              repo: repo.name,
            }),
            true,
          );
        },
      }));

  const addPartItems = (
    repo: WorkbenchRepo,
    at?: WorkbenchPoint,
  ): WorkbenchMenuItem[] =>
    WORKBENCH_PART_KINDS.map((kind) => ({
      id: `add-${kind}`,
      label: t(KIND_LABEL_KEYS[kind]),
      onSelect: () => {
        const name = t(I18nKey.WORKBENCH$NEW_PART_NAME, {
          kind: t(KIND_LABEL_KEYS[kind]),
        });
        const id = addPart(
          repo.id,
          kind,
          name,
          at ? { x: at.x - repo.x, y: at.y - repo.y } : undefined,
        );
        setSelection({ partIds: [id] });
        setRenaming({ id, value: name });
      },
    }));

  const partMenu = (event: React.MouseEvent, part: WorkbenchPart) => {
    const ids = selection.partIds.includes(part.id)
      ? selection.partIds
      : [part.id];
    if (!selection.partIds.includes(part.id))
      setSelection({ partIds: [part.id] });
    const many = ids.length > 1;
    openMenu(
      event,
      [
        {
          id: "ask",
          label: t(I18nKey.WORKBENCH$MENU_ASK_ARCHITECT),
          onSelect: () => onAsk(ids),
        },
        {
          id: "story",
          label: t(I18nKey.WORKBENCH$MENU_NEW_STORY),
          onSelect: () => onStoryFor(part),
        },
        {
          id: "rename",
          label: t(I18nKey.WORKBENCH$MENU_RENAME),
          hint: "F2",
          disabled: many,
          onSelect: () => setRenaming({ id: part.id, value: part.name }),
        },
        {
          id: "status",
          label: t(I18nKey.WORKBENCH$MENU_STATUS),
          disabled: many,
          children: statusItems(part),
        },
        {
          id: "move",
          label: t(I18nKey.WORKBENCH$MENU_MOVE_TO_REPO),
          disabled: many || repos.length < 2,
          children: moveItems(part),
        },
        {
          id: "delete",
          label: many
            ? t(I18nKey.WORKBENCH$MENU_DELETE_COUNT, { count: ids.length })
            : t(I18nKey.WORKBENCH$MENU_DELETE),
          hint: "Del",
          danger: true,
          onSelect: () => {
            deleteParts(ids);
            showToast(
              t(I18nKey.WORKBENCH$TOAST_DELETED, { count: ids.length }),
              true,
            );
          },
        },
      ],
      many
        ? t(I18nKey.WORKBENCH$SELECTED_COUNT, { count: ids.length })
        : part.name,
    );
  };

  const wireMenu = (event: React.MouseEvent, wireId: string) => {
    const wire = wires.find((w) => w.id === wireId);
    if (!wire) return;
    setSelection({ wireId });
    openMenu(
      event,
      [
        {
          id: "label",
          label: t(I18nKey.WORKBENCH$MENU_WIRE_LABEL),
          children: WORKBENCH_WIRE_LABELS.map((label) => ({
            id: `label-${label}`,
            label: t(WIRE_LABEL_KEYS[label]),
            checked: wire.label === label,
            onSelect: () => setWireLabel(wireId, label),
          })),
        },
        {
          id: "ask",
          label: t(I18nKey.WORKBENCH$MENU_ASK_ARCHITECT),
          onSelect: () => onAsk([wire.from, wire.to]),
        },
        {
          id: "delete",
          label: t(I18nKey.WORKBENCH$MENU_DELETE),
          hint: "Del",
          danger: true,
          onSelect: () => {
            deleteWire(wireId);
            showToast(t(I18nKey.WORKBENCH$TOAST_WIRE_DELETED), true);
          },
        },
      ],
      `${partMap.get(wire.from)?.name ?? ""} → ${partMap.get(wire.to)?.name ?? ""}`,
    );
  };

  const groupMenu = (event: React.MouseEvent, repo: WorkbenchRepo) => {
    const repoParts = parts.filter((part) => part.repoId === repo.id);
    openMenu(
      event,
      [
        {
          id: "select",
          label: t(I18nKey.WORKBENCH$MENU_SELECT_PARTS, {
            count: repoParts.length,
          }),
          disabled: repoParts.length === 0,
          onSelect: () => setSelection({ partIds: repoParts.map((p) => p.id) }),
        },
        {
          id: "ask",
          label: t(I18nKey.WORKBENCH$MENU_ASK_ARCHITECT),
          onSelect: () => onAsk(repoParts.map((p) => p.id)),
        },
        {
          id: "crawl",
          label:
            repoParts.length === 0
              ? t(I18nKey.WORKBENCH$MENU_CRAWL)
              : t(I18nKey.WORKBENCH$MENU_RECRAWL),
          onSelect: () => onCrawl(repo),
        },
        {
          id: "add",
          label: t(I18nKey.WORKBENCH$MENU_ADD_PART),
          children: addPartItems(repo),
        },
        {
          id: "rename",
          label: t(I18nKey.WORKBENCH$MENU_RENAME),
          onSelect: () =>
            setRenaming({ id: `repo:${repo.id}`, value: repo.name }),
        },
        {
          id: "remove",
          label: t(I18nKey.WORKBENCH$MENU_REMOVE_FROM_PROJECT),
          danger: true,
          onSelect: () => {
            removeRepoFromProject(project.id, repo.id);
            showToast(
              t(I18nKey.WORKBENCH$TOAST_REPO_REMOVED, { name: repo.name }),
              true,
            );
          },
        },
      ],
      repo.name,
    );
  };

  const highlightMenu = (event: React.MouseEvent, highlightId: string) => {
    const mark = doc.highlights.find((h) => h.id === highlightId);
    if (!mark) return;
    setSelection({ highlightId });
    const inside = partsInsidePolygon(doc, repoIds, mark.points);
    openMenu(
      event,
      [
        {
          id: "ask",
          label: t(I18nKey.WORKBENCH$MENU_ASK_ABOUT_HIGHLIGHT),
          onSelect: () => onAsk(inside.map((p) => p.id)),
        },
        {
          id: "delete",
          label: t(I18nKey.WORKBENCH$MENU_DELETE),
          hint: "Del",
          danger: true,
          onSelect: () => deleteHighlight(highlightId),
        },
      ],
      t(I18nKey.WORKBENCH$HIGHLIGHT_TITLE, { count: inside.length }),
    );
  };

  const paperMenu = (event: React.MouseEvent) => {
    const at = screenToCanvas(event);
    const over = repoAtPoint(doc, repoIds, at);
    const { undo, redo, past, future } = useWorkbenchStore.getState();
    openMenu(event, [
      ...(over
        ? [
            {
              id: "add",
              label: t(I18nKey.WORKBENCH$MENU_ADD_PART_HERE, {
                repo: over.name,
              }),
              children: addPartItems(over, at),
            },
          ]
        : []),
      { id: "fit", label: t(I18nKey.WORKBENCH$FIT), hint: "0", onSelect: fit },
      {
        id: "level",
        label:
          level === "parts"
            ? t(I18nKey.WORKBENCH$MENU_SHOW_REPOS)
            : t(I18nKey.WORKBENCH$MENU_SHOW_PARTS),
        onSelect: () => setLevel(level === "parts" ? "repos" : "parts"),
      },
      {
        id: "highlight",
        label: t(I18nKey.WORKBENCH$TOOL_HIGHLIGHT),
        hint: "H",
        checked: tool === "highlight",
        onSelect: () => setTool(tool === "highlight" ? "select" : "highlight"),
      },
      {
        id: "clear",
        label: t(I18nKey.WORKBENCH$CLEAR_HIGHLIGHTS),
        disabled: doc.highlights.length === 0,
        onSelect: clearHighlights,
      },
      {
        id: "undo",
        label: t(I18nKey.WORKBENCH$UNDO),
        hint: "Ctrl+Z",
        disabled: past.length === 0,
        onSelect: undo,
      },
      {
        id: "redo",
        label: t(I18nKey.WORKBENCH$REDO),
        hint: "Ctrl+Y",
        disabled: future.length === 0,
        onSelect: redo,
      },
    ]);
  };

  // ---- rename ----
  const commitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (value !== "") {
      if (renaming.id.startsWith("repo:"))
        renameRepo(renaming.id.slice(5), value);
      else renamePart(renaming.id, value);
    }
    setRenaming(null);
  };

  // ---- derived drawing data ----
  const focus = new Set(selection.partIds);
  if (selection.wireId) {
    const wire = wires.find((w) => w.id === selection.wireId);
    if (wire) {
      focus.add(wire.from);
      focus.add(wire.to);
    }
  }
  const neighbourhood = new Set(focus);
  if (focus.size === 1)
    wires.forEach((wire) => {
      if (focus.has(wire.from)) neighbourhood.add(wire.to);
      if (focus.has(wire.to)) neighbourhood.add(wire.from);
    });
  const dimOthers = neighbourhood.size > 0;

  const visibleAgents = doc.agents.filter((agent) =>
    agent.focus
      ? partIds.has(agent.focus)
      : agent.targets.some((id) => partIds.has(id)),
  );
  const agentsOn = (partId: string) =>
    visibleAgents.filter((agent) => agent.focus === partId);
  const hoveredAgent = hoverAgentId
    ? (visibleAgents.find((agent) => agent.id === hoverAgentId) ?? null)
    : null;

  const center = (part: WorkbenchPart) => {
    const box = boxOf(part);
    return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  };

  const transform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`;

  return (
    <svg
      ref={svgRef}
      data-testid="workbench-canvas"
      role="application"
      aria-label={t(I18nKey.WORKBENCH$CANVAS_LABEL)}
      className={cn(
        "h-full w-full touch-none select-none bg-canvas-base outline-none",
        tool === "highlight"
          ? "cursor-crosshair"
          : live?.type === "pan"
            ? "cursor-grabbing"
            : "cursor-default",
      )}
      onPointerDown={onEmptyPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={paperMenu}
      onDragOver={onDragOver}
      onDragLeave={() => setDropRepo(null)}
      onDrop={onDrop}
    >
      <defs>
        <marker
          id="wb-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" className="fill-muted" />
        </marker>
        <marker
          id="wb-arrow-planned"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" className="fill-accent" />
        </marker>
        <pattern
          id="wb-grid"
          width={20}
          height={20}
          patternUnits="userSpaceOnUse"
          patternTransform={transform}
        >
          <circle cx={1} cy={1} r={0.8} className="fill-map-grid" />
        </pattern>
      </defs>
      <rect data-paper width="100%" height="100%" fill="url(#wb-grid)" />
      <g transform={transform}>
        {level === "repos" ? (
          <RepoLevel
            document={doc}
            repos={repos}
            wires={wires}
            partMap={partMap}
            onOpen={(repo) => {
              setLevel("parts");
              const rect = svgRef.current?.getBoundingClientRect();
              setViewport(
                fitViewport(
                  groupBox(doc, repo),
                  rect?.width ?? 0,
                  rect?.height ?? 0,
                ),
              );
            }}
            onMenu={groupMenu}
          />
        ) : (
          <>
            {repos.map((repo) => {
              const box = groupBox(doc, repo);
              const shift = movingRepo === repo.id ? d : { x: 0, y: 0 };
              const x = box.x0 + shift.x;
              const y = box.y0 + shift.y;
              const w = box.x1 - box.x0;
              const h = box.y1 - box.y0;
              const empty = !parts.some((part) => part.repoId === repo.id);
              const isDrop = dropRepoId === repo.id;
              const isRenaming = renaming?.id === `repo:${repo.id}`;
              return (
                <g
                  key={repo.id}
                  data-testid={`workbench-group-${repo.id}`}
                  onContextMenu={(event) => groupMenu(event, repo)}
                >
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    rx={14}
                    fill={accentVar(repo.accent)}
                    stroke={accentVar(repo.accent)}
                    fillOpacity={isDrop ? 0.16 : 0.06}
                    strokeOpacity={isDrop ? 0.9 : 0.35}
                    strokeWidth={isDrop ? 2 : 1}
                    strokeDasharray={repo.external ? "6 4" : undefined}
                    className="transition-[fill-opacity,stroke-opacity]"
                  />
                  {/* The title bar is the group's handle: drag it to move the whole group, click it to select the repo. */}
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={GROUP_TITLE_HEIGHT}
                    rx={14}
                    data-testid={`workbench-group-grip-${repo.id}`}
                    data-tip={t(I18nKey.WORKBENCH$TIP_GROUP_GRIP, {
                      name: repo.name,
                    })}
                    className={cn(
                      "fill-transparent",
                      movingRepo === repo.id
                        ? "cursor-grabbing"
                        : "cursor-grab",
                    )}
                    onPointerDown={(event) => onGroupPointerDown(event, repo)}
                  />
                  {isRenaming ? (
                    <foreignObject
                      x={x + 10}
                      y={y + 6}
                      width={Math.max(120, w - 20)}
                      height={24}
                    >
                      <input
                        ref={focusOnMount}
                        aria-label={t(I18nKey.WORKBENCH$MENU_RENAME)}
                        className="h-6 w-full rounded border border-border-input bg-surface px-1.5 text-xs text-foreground outline-none"
                        value={renaming.value}
                        onChange={(event) =>
                          setRenaming({
                            ...renaming,
                            value: event.target.value,
                          })
                        }
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setRenaming(null);
                        }}
                      />
                    </foreignObject>
                  ) : (
                    <text
                      x={x + 14}
                      y={y + 22}
                      fill={accentVar(repo.accent)}
                      className="pointer-events-none select-none text-xs font-semibold"
                    >
                      {repo.name}
                    </text>
                  )}
                  {empty && (
                    <foreignObject
                      x={x + 16}
                      y={y + GROUP_TITLE_HEIGHT + 12}
                      width={w - 32}
                      height={h - GROUP_TITLE_HEIGHT - 24}
                    >
                      <div className="flex h-full flex-col items-start justify-center gap-2 text-xs text-muted">
                        <span>
                          {repo.hasMap
                            ? t(I18nKey.WORKBENCH$GROUP_EMPTY)
                            : t(I18nKey.WORKBENCH$GROUP_NO_MAP)}
                        </span>
                        <button
                          type="button"
                          data-testid={`workbench-crawl-${repo.id}`}
                          className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs font-medium text-foreground hover:bg-interactive-hover"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => onCrawl(repo)}
                        >
                          {t(I18nKey.WORKBENCH$MENU_CRAWL)}
                        </button>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}

            {doc.highlights.map((mark, index) => (
              <g
                key={mark.id}
                data-testid={`workbench-highlight-${mark.id}`}
                onContextMenu={(event) => highlightMenu(event, mark.id)}
              >
                <path
                  d={highlightPath(mark.points)}
                  className={cn(
                    "cursor-pointer fill-warning/10 stroke-warning",
                    selection.highlightId === mark.id && "stroke-[4]",
                  )}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelection({ highlightId: mark.id });
                  }}
                />
                <text
                  x={mark.points[0].x - 6}
                  y={mark.points[0].y - 6}
                  className="fill-warning text-[11px] font-bold"
                >
                  {index + 1}
                </text>
              </g>
            ))}

            {overlays.agents &&
              visibleAgents.map((agent) => {
                if (!agent.focus || agent.trail.length < 2) return null;
                if (hoveredAgent && hoveredAgent.id !== agent.id) return null;
                const pts = agent.trail
                  .map((id) => partMap.get(id))
                  .filter((p): p is WorkbenchPart => !!p)
                  .map(center);
                if (pts.length < 2) return null;
                return (
                  <path
                    key={agent.id}
                    d={`M${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
                    fill="none"
                    stroke={accentVar(agent.accent)}
                    strokeOpacity={0.45}
                    strokeWidth={3}
                    strokeDasharray="2 6"
                    strokeLinecap="round"
                  />
                );
              })}

            {wires.map((wire) => {
              const from = partMap.get(wire.from);
              const to = partMap.get(wire.to);
              if (!from || !to) return null;
              const a = wireAnchor(boxOf(from), boxOf(to));
              const b = wireAnchor(boxOf(to), boxOf(from));
              const path = wirePath(a, b);
              const selected = selection.wireId === wire.id;
              const lit =
                !dimOthers ||
                (neighbourhood.has(wire.from) && neighbourhood.has(wire.to));
              const planned = wire.label === "planned";
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              return (
                <g
                  key={wire.id}
                  data-testid={`workbench-wire-${wire.id}`}
                  className={cn(!lit && "opacity-20")}
                  onContextMenu={(event) => wireMenu(event, wire.id)}
                >
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelection({ wireId: wire.id });
                    }}
                  />
                  <path
                    d={path}
                    fill="none"
                    className={cn(
                      planned ? "stroke-accent" : "stroke-muted",
                      selected && "stroke-primary",
                    )}
                    strokeWidth={selected ? 2.5 : 1.5}
                    strokeDasharray={planned ? "5 4" : undefined}
                    markerEnd={
                      planned ? "url(#wb-arrow-planned)" : "url(#wb-arrow)"
                    }
                  />
                  {(selected || focus.has(wire.from) || focus.has(wire.to)) && (
                    <text
                      x={mid.x}
                      y={mid.y - 6}
                      textAnchor="middle"
                      className="pointer-events-none fill-text-secondary text-[10px]"
                    >
                      {t(WIRE_LABEL_KEYS[wire.label])}
                    </text>
                  )}
                </g>
              );
            })}

            {live?.type === "wire" &&
              (() => {
                const from = partMap.get(live.from);
                if (!from) return null;
                const a = wireAnchor(boxOf(from), {
                  x0: live.at.x,
                  y0: live.at.y,
                  x1: live.at.x,
                  y1: live.at.y,
                });
                return (
                  <path
                    d={wirePath(a, {
                      x: live.at.x,
                      y: live.at.y,
                      horizontal: a.horizontal,
                      sign: -a.sign,
                    })}
                    fill="none"
                    className="stroke-accent"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                  />
                );
              })()}

            {parts.map((part) => {
              const repo = repoById(doc, part.repoId);
              const box = boxOf(part);
              const selected = focus.has(part.id);
              const lit = !dimOthers || neighbourhood.has(part.id);
              const here = agentsOn(part.id);
              const isRenaming = renaming?.id === part.id;
              const accent = accentVar(repo?.accent ?? 1);
              const tip = [
                `${t(KIND_LABEL_KEYS[part.kind])} · ${t(STATUS_LABEL_KEYS[part.status])}`,
                part.files[0] ?? "",
                part.tests !== null
                  ? t(I18nKey.WORKBENCH$TIP_TESTS, { percent: part.tests })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <g
                  key={part.id}
                  data-testid={`workbench-part-${part.id}`}
                  data-tip={tip}
                  tabIndex={0}
                  role="button"
                  aria-label={part.name}
                  aria-pressed={selected}
                  className={cn(
                    "outline-none",
                    !lit && "opacity-30",
                    movingParts?.has(part.id)
                      ? "cursor-grabbing"
                      : "cursor-grab",
                  )}
                  transform={`translate(${box.x0} ${box.y0})`}
                  onPointerDown={(event) => onPartPointerDown(event, part)}
                  onDoubleClick={() =>
                    setRenaming({ id: part.id, value: part.name })
                  }
                  onContextMenu={(event) => partMenu(event, part)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelection({ partIds: [part.id] });
                    }
                    if (event.key === "F2") {
                      event.preventDefault();
                      setRenaming({ id: part.id, value: part.name });
                    }
                  }}
                >
                  {part.status === "live" && (
                    <rect
                      x={-4}
                      y={-4}
                      width={WORKBENCH_PART_WIDTH + 8}
                      height={WORKBENCH_PART_HEIGHT + 8}
                      rx={12}
                      fill="none"
                      stroke={accent}
                      strokeOpacity={0.35}
                      strokeWidth={6}
                      className="animate-pulse"
                    />
                  )}
                  <rect
                    width={WORKBENCH_PART_WIDTH}
                    height={WORKBENCH_PART_HEIGHT}
                    rx={9}
                    className={cn(
                      "fill-surface-raised",
                      selected ? "stroke-primary" : "",
                    )}
                    stroke={selected ? undefined : accent}
                    strokeWidth={selected ? 2.5 : 1.25}
                    strokeDasharray={
                      part.status === "planned" ? "4 3" : undefined
                    }
                  />
                  <rect
                    x={10}
                    y={13}
                    width={26}
                    height={24}
                    rx={6}
                    fill={accent}
                    fillOpacity={0.9}
                  />
                  <text
                    x={23}
                    y={30}
                    textAnchor="middle"
                    className="pointer-events-none fill-on-primary text-[10px] font-bold"
                  >
                    {WORKBENCH_KIND_BADGES[part.kind]}
                  </text>
                  {isRenaming ? (
                    <foreignObject
                      x={42}
                      y={12}
                      width={WORKBENCH_PART_WIDTH - 54}
                      height={26}
                    >
                      <input
                        ref={focusOnMount}
                        data-testid={`workbench-rename-${part.id}`}
                        aria-label={t(I18nKey.WORKBENCH$MENU_RENAME)}
                        className="h-6 w-full rounded border border-border-input bg-surface px-1.5 text-xs text-foreground outline-none"
                        value={renaming.value}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          setRenaming({
                            ...renaming,
                            value: event.target.value,
                          })
                        }
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setRenaming(null);
                        }}
                      />
                    </foreignObject>
                  ) : (
                    <>
                      <text
                        x={44}
                        y={23}
                        className="pointer-events-none fill-foreground text-xs font-semibold"
                      >
                        {truncate(part.name, 17)}
                      </text>
                      <text
                        x={44}
                        y={38}
                        className="pointer-events-none fill-muted text-[10px]"
                      >
                        {overlays.tests && part.tests !== null
                          ? t(I18nKey.WORKBENCH$TIP_TESTS, {
                              percent: part.tests,
                            })
                          : overlays.changes && part.changes > 0
                            ? t(I18nKey.WORKBENCH$CHANGES_COUNT, {
                                count: part.changes,
                              })
                            : t(STATUS_LABEL_KEYS[part.status])}
                      </text>
                    </>
                  )}
                  {overlays.changes && part.changes > 0 && (
                    <rect
                      x={0}
                      y={WORKBENCH_PART_HEIGHT - 3}
                      width={Math.min(
                        WORKBENCH_PART_WIDTH,
                        (part.changes / 100) * WORKBENCH_PART_WIDTH,
                      )}
                      height={3}
                      rx={1.5}
                      className="fill-warning"
                    />
                  )}
                  {overlays.drift && part.drift && (
                    <g data-tip={part.drift}>
                      <circle
                        cx={WORKBENCH_PART_WIDTH - 12}
                        cy={10}
                        r={7}
                        className="fill-danger"
                      />
                      <text
                        x={WORKBENCH_PART_WIDTH - 12}
                        y={13.5}
                        textAnchor="middle"
                        className="fill-on-primary text-[9px] font-bold"
                      >
                        !
                      </text>
                    </g>
                  )}
                  {part.gate && (
                    <g data-tip={part.gate}>
                      <rect
                        x={WORKBENCH_PART_WIDTH - 54}
                        y={-8}
                        width={44}
                        height={16}
                        rx={8}
                        className="fill-warning"
                      />
                      <text
                        x={WORKBENCH_PART_WIDTH - 32}
                        y={3.5}
                        textAnchor="middle"
                        className="fill-on-primary text-[9px] font-bold"
                      >
                        {t(I18nKey.WORKBENCH$GATE_BADGE)}
                      </text>
                    </g>
                  )}
                  {part.unsure && (
                    <text
                      x={WORKBENCH_PART_WIDTH - 10}
                      y={WORKBENCH_PART_HEIGHT - 8}
                      textAnchor="end"
                      className="fill-muted text-[11px]"
                      data-tip={part.unsure}
                    >
                      ?
                    </text>
                  )}
                  {/* The port: drag from here to draw a planned wire. */}
                  <circle
                    cx={WORKBENCH_PART_WIDTH}
                    cy={WORKBENCH_PART_HEIGHT / 2}
                    r={PORT_RADIUS}
                    data-testid={`workbench-port-${part.id}`}
                    data-tip={t(I18nKey.WORKBENCH$TIP_PORT)}
                    className="cursor-crosshair fill-surface stroke-muted hover:fill-accent"
                    strokeWidth={1.5}
                    onPointerDown={(event) => onPortPointerDown(event, part)}
                  />
                  {overlays.agents &&
                    here.map((agent, index) => (
                      <AgentBadge
                        key={agent.id}
                        agent={agent}
                        x={-10 + index * 18}
                        y={-10}
                      />
                    ))}
                </g>
              );
            })}

            {overlays.agents &&
              visibleAgents
                .filter((agent) => !agent.focus)
                .flatMap((agent) =>
                  (hoveredAgent && hoveredAgent.id !== agent.id
                    ? []
                    : agent.targets
                  ).map((id) => {
                    const part = partMap.get(id);
                    if (!part) return null;
                    const box = boxOf(part);
                    return (
                      <rect
                        key={`${agent.id}-${id}`}
                        x={box.x0 - 3}
                        y={box.y0 - 3}
                        width={WORKBENCH_PART_WIDTH + 6}
                        height={WORKBENCH_PART_HEIGHT + 6}
                        rx={11}
                        fill="none"
                        stroke={accentVar(agent.accent)}
                        strokeOpacity={hoveredAgent ? 0.9 : 0.35}
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                        className="pointer-events-none"
                      />
                    );
                  }),
                )}

            {live?.type === "lasso" && (
              <rect
                x={Math.min(live.start.x, live.at.x)}
                y={Math.min(live.start.y, live.at.y)}
                width={Math.abs(live.at.x - live.start.x)}
                height={Math.abs(live.at.y - live.start.y)}
                className="fill-primary/10 stroke-primary"
                strokeDasharray="4 3"
              />
            )}
            {live?.type === "highlight" && (
              <path
                d={highlightPath(live.points)}
                className="fill-warning/10 stroke-warning"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            )}
          </>
        )}
      </g>
    </svg>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function AgentBadge({
  agent,
  x,
  y,
}: {
  agent: WorkbenchAgent;
  x: number;
  y: number;
}) {
  const setHoverAgent = useWorkbenchStore((s) => s.setHoverAgent);
  return (
    <g
      data-testid={`workbench-agent-badge-${agent.id}`}
      data-tip={`${agent.name} · ${agent.doing}`}
      transform={`translate(${x} ${y})`}
      onPointerEnter={() => setHoverAgent(agent.id)}
      onPointerLeave={() => setHoverAgent(null)}
    >
      <circle
        r={10}
        fill={accentVar(agent.accent)}
        className={cn(
          "stroke-surface-raised",
          agent.state === "running" && "animate-pulse",
        )}
        strokeWidth={2}
      />
      <text
        y={3.5}
        textAnchor="middle"
        className="pointer-events-none fill-on-primary text-[8px] font-bold"
      >
        {agent.initials}
      </text>
      {agent.state === "waiting" && (
        <circle
          cx={8}
          cy={-7}
          r={3.5}
          className="fill-warning stroke-surface-raised"
          strokeWidth={1}
        />
      )}
    </g>
  );
}

/** The zoomed-out level: one box per repo, with the wires between repos. */
function RepoLevel({
  document: doc,
  repos,
  wires,
  partMap,
  onOpen,
  onMenu,
}: {
  document: WorkbenchDocument;
  repos: WorkbenchRepo[];
  wires: WorkbenchDocument["wires"];
  partMap: Map<string, WorkbenchPart>;
  onOpen: (repo: WorkbenchRepo) => void;
  onMenu: (event: React.MouseEvent, repo: WorkbenchRepo) => void;
}) {
  const { t } = useTranslation("openhands");
  const boxes = new Map(repos.map((repo) => [repo.id, groupBox(doc, repo)]));
  const links = new Map<string, number>();
  wires.forEach((wire) => {
    const a = partMap.get(wire.from)?.repoId;
    const b = partMap.get(wire.to)?.repoId;
    if (!a || !b || a === b) return;
    const key = `${a}->${b}`;
    links.set(key, (links.get(key) ?? 0) + 1);
  });
  return (
    <>
      {Array.from(links.entries()).map(([key, count]) => {
        const [a, b] = key.split("->");
        const from = boxes.get(a);
        const to = boxes.get(b);
        if (!from || !to) return null;
        const p = wireAnchor(from, to);
        const q = wireAnchor(to, from);
        return (
          <g key={key}>
            <path
              d={wirePath(p, q)}
              fill="none"
              className="stroke-muted"
              strokeWidth={Math.min(6, 1 + count)}
              markerEnd="url(#wb-arrow)"
            />
            <text
              x={(p.x + q.x) / 2}
              y={(p.y + q.y) / 2 - 6}
              textAnchor="middle"
              className="fill-text-secondary text-[11px]"
            >
              {count}
            </text>
          </g>
        );
      })}
      {repos.map((repo) => {
        const box = boxes.get(repo.id);
        if (!box) return null;
        const count = doc.parts.filter(
          (part) => part.repoId === repo.id,
        ).length;
        return (
          <g
            key={repo.id}
            data-testid={`workbench-repo-box-${repo.id}`}
            role="button"
            tabIndex={0}
            aria-label={repo.name}
            className="cursor-pointer outline-none"
            onClick={() => onOpen(repo)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(repo);
            }}
            onContextMenu={(event) => onMenu(event, repo)}
          >
            <rect
              x={box.x0}
              y={box.y0}
              width={box.x1 - box.x0}
              height={box.y1 - box.y0}
              rx={16}
              fill={accentVar(repo.accent)}
              fillOpacity={0.12}
              stroke={accentVar(repo.accent)}
              strokeWidth={2}
            />
            <text
              x={(box.x0 + box.x1) / 2}
              y={(box.y0 + box.y1) / 2 - 6}
              textAnchor="middle"
              fill={accentVar(repo.accent)}
              className="text-lg font-bold"
            >
              {repo.name}
            </text>
            <text
              x={(box.x0 + box.x1) / 2}
              y={(box.y0 + box.y1) / 2 + 16}
              textAnchor="middle"
              className="fill-muted text-xs"
            >
              {t(I18nKey.WORKBENCH$PARTS_COUNT, { count })}
            </text>
          </g>
        );
      })}
    </>
  );
}
