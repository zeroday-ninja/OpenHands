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
 * Every one of those gestures is decided from the pointer events, never from a
 * `click`: the drag captures the pointer, and a captured pointer retargets its
 * events — including the `click` the browser synthesises — at the element
 * holding the capture. So a plate's own `onClick` never runs during a press
 * that started on it, which is why pressing and releasing without travelling
 * is what counts as a click here, on a plate and on the paper alike. The press
 * also moves focus, because nothing else can while the pointer is captured and
 * the keyboard grammar below is useless without it.
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
  ProjectMapDerivedLayer,
  ProjectMapEndpoint,
  ProjectMapNote,
  ProjectMapShape,
  ProjectMapShapeKind,
} from "#/types/project-map";
import {
  fitProjectMapViewBox,
  projectMapGroupBounds,
  projectMapNodeSize,
  PROJECT_MAP_GRID,
  PROJECT_MAP_GROUP_PADDING,
} from "#/utils/project-map/project-map-layout";
import {
  PROJECT_MAP_GROUP_NODE_PREFIX,
  type ProjectMapRenderEdge,
  projectMapArrowTarget,
  projectMapFocusIds,
  projectMapRenderModel,
} from "#/utils/project-map/project-map-graph";
import {
  projectMapAccentToken,
  projectMapBranchPath,
  projectMapEdgeGeometry,
  projectMapEdgeHeadPath,
  projectMapEdgeStyle,
  projectMapFacingSide,
  projectMapSidePoint,
  resolveProjectMapAccent,
  type Rect,
} from "#/utils/project-map/project-map-visuals";
import { PROJECT_MAP_SHAPE_MIN_SIZE } from "#/utils/project-map/project-map-authoring";
import {
  PROJECT_MAP_MAX_SCALE,
  PROJECT_MAP_MIN_SCALE,
  useProjectMapStore,
} from "#/stores/project-map-store";
import {
  projectMapOverview,
  type ProjectMapOverview,
} from "#/utils/project-map/project-map-overview";
import { ProjectMapOverviewLayer } from "./project-map-overview-layer";
import { projectMapWaitingLayers } from "#/utils/project-map/project-map-waiting-parts";
import { ProjectMapNodePlate } from "./project-map-node-plate";
import { projectMapNodeDomId } from "./project-map-labels";
import {
  ProjectMapShapeMark,
  type ProjectMapShapeHandle,
} from "./project-map-shape";
import {
  ProjectMapConnectorDraft,
  ProjectMapConnectorMark,
} from "./project-map-connector";

/** Height of a collapsed group's plate. */
const COLLAPSED_HEIGHT = 56;
/** Width of the gap left in a group boundary for its label. */
const GROUP_LABEL_PADDING = 12;
/** Below this zoom the grid and the path lines stop helping and start buzzing. */
/**
 * How many plates are drawn before only what is in view is drawn.
 *
 * The plan's own measure is one frame per pointer move at 200 shapes; this
 * leaves room above that for a code map, and catches the work graph.
 */
const PLATE_BUDGET = 400;
/** How far outside the view a plate is still drawn, in pixels. */
const OFFSCREEN_MARGIN = 600;

const DETAIL_SCALE = 0.62;
/** Opening a layer from the overview lands at least this close. */
/**
 * How far an opened layer may be shrunk to get its width in frame.
 *
 * `DETAIL_SCALE` exactly, not a hair under it: at 0.6 a layer floored by the
 * fit arrived with the dot grid and the plates' path lines switched off,
 * which is most of what opening a layer is for.
 */
const OPEN_LAYER_MIN_SCALE = DETAIL_SCALE;
const OPEN_LAYER_MAX_SCALE = 1.25;
/**
 * A press that travels no further than this, in screen pixels, was a click.
 * Hands shake; a plate that needs a perfectly still finger to select is a
 * plate you cannot select.
 */
const TAP_SLOP = 3;

/**
 * jsdom's SVG elements have no Pointer Capture API, and a drag that keeps
 * working without it is better than a page that throws in tests.
 */
function capturePointer(element: Element | null, pointerId: number) {
  if (typeof element?.setPointerCapture === "function") {
    element.setPointerCapture(pointerId);
  }
}

interface Point {
  x: number;
  y: number;
}

/**
 * A press in progress.
 *
 * `screen` is where the press landed in client coordinates and never changes,
 * which is the whole reason it is here. A pan has to be measured between two
 * fixed ends: against the *current* viewport it would be measured against a
 * viewport the previous move already shifted, and the paper would travel half
 * as far as the pointer. Diagram coordinates are still right for the gestures
 * that do not move the viewport — a node drag and a marquee sweep both happen
 * in the drawing's own space, and both leave the viewport alone.
 */
type Drag =
  | {
      kind: "pan";
      pointerId: number;
      screen: Point;
      /** The viewport at the moment of the press. */
      origin: Point;
    }
  | {
      kind: "marquee";
      pointerId: number;
      screen: Point;
      from: Point;
      to: Point;
    }
  | {
      kind: "node";
      pointerId: number;
      screen: Point;
      /** Everything the drag moves: the whole selection it started inside. */
      ids: string[];
      /** The plate under the pointer, which a click without travel selects. */
      target: string;
      additive: boolean;
      /** Whether the target was already selected when the press landed. */
      wasSelected: boolean;
      from: Point;
      to: Point;
    }
  /** The authored twin of `node`: the same gesture over drawn shapes. */
  | {
      kind: "shape";
      pointerId: number;
      screen: Point;
      ids: string[];
      target: string;
      additive: boolean;
      wasSelected: boolean;
      from: Point;
      to: Point;
    }
  /** Drawing a new shape out, or tapping one into place. */
  | {
      kind: "create";
      pointerId: number;
      screen: Point;
      shapeKind: ProjectMapShapeKind;
      from: Point;
      to: Point;
    }
  /** Pulling a line out of something, before it has anywhere to land. */
  | {
      kind: "connect";
      pointerId: number;
      screen: Point;
      origin: ProjectMapEndpoint;
      start: Point;
      to: Point;
    }
  | {
      kind: "resize";
      pointerId: number;
      screen: Point;
      id: string;
      handle: ProjectMapShapeHandle;
      /** The shape's box when the press landed. */
      box: Rect;
      from: Point;
      to: Point;
    };

/** The box a create drag has swept out, normalised so width is never negative. */
function dragBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** A resize applied to a box, by the handle that is being pulled. */
function resizedBox(
  box: Rect,
  handle: ProjectMapShapeHandle,
  dx: number,
  dy: number,
): Rect {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.startsWith("n");
  const south = handle.startsWith("s");
  const x = west ? box.x + dx : box.x;
  const y = north ? box.y + dy : box.y;
  const width = east ? box.width + dx : west ? box.width - dx : box.width;
  const height = south ? box.height + dy : north ? box.height - dy : box.height;
  return {
    x,
    y,
    width: Math.max(width, PROJECT_MAP_SHAPE_MIN_SIZE),
    height: Math.max(height, PROJECT_MAP_SHAPE_MIN_SIZE),
  };
}

/**
 * True when a key event came from somewhere text is being typed.
 *
 * The fields live inside the SVG, so their keys bubble through the shapes and
 * the paper. Without this, space pans while writing, Backspace deletes the
 * selection instead of a character, and Ctrl+Z undoes the drawing rather than
 * the sentence.
 */
function fromTextField(event: { target: EventTarget | null }): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("input, textarea, [contenteditable='true']") !== null
  );
}

/** True while a press has not travelled far enough to mean a drag. */
function isTap(drag: Drag, event: { clientX: number; clientY: number }) {
  return (
    Math.abs(event.clientX - drag.screen.x) <= TAP_SLOP &&
    Math.abs(event.clientY - drag.screen.y) <= TAP_SLOP
  );
}

export interface ProjectMapCanvasProps {
  document: PlacedProjectMapDocument;
  frameRef: React.RefObject<SVGSVGElement | null>;
  /**
   * A derived layer to draw instead of the committed analysis.
   *
   * The work graph is assembled live and never serialized, so it arrives as a
   * prop rather than through the document. Everything else — selection,
   * panning, annotating, the drawn layer over the top — works the same way on
   * whichever layer is on the paper.
   */
  derivedLayer?: ProjectMapDerivedLayer | null;
  /**
   * Node id to the parked change that names it. The rail says a change is
   * waiting; this is what puts it where the work is, on the drawing.
   */
  waitingParts?: ReadonlyMap<string, string>;
}

const NOTHING_WAITING: ReadonlyMap<string, string> = new Map();

export function ProjectMapCanvas({
  document: map,
  frameRef,
  derivedLayer = null,
  waitingParts = NOTHING_WAITING,
}: ProjectMapCanvasProps) {
  const { t } = useTranslation("openhands");
  const viewport = useProjectMapStore((state) => state.viewport);
  const selection = useProjectMapStore((state) => state.selection);
  const focused = useProjectMapStore((state) => state.focused);
  const showHidden = useProjectMapStore((state) => state.showHidden);
  const overview = useProjectMapStore((state) => state.overview);
  const setOverview = useProjectMapStore((state) => state.setOverview);
  const openedGroup = useProjectMapStore((state) => state.openedGroup);
  const setOpenedGroup = useProjectMapStore((state) => state.setOpenedGroup);
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
  const tool = useProjectMapStore((state) => state.tool);
  const setTool = useProjectMapStore((state) => state.setTool);
  const addShape = useProjectMapStore((state) => state.addShape);
  const moveShapes = useProjectMapStore((state) => state.moveShapes);
  const resizeShape = useProjectMapStore((state) => state.resizeShape);
  const addConnector = useProjectMapStore((state) => state.addConnector);
  const removeSelected = useProjectMapStore((state) => state.removeSelected);
  const setEditingShape = useProjectMapStore((state) => state.setEditingShape);
  const addBranchChild = useProjectMapStore((state) => state.addBranchChild);
  const addBranchSibling = useProjectMapStore(
    (state) => state.addBranchSibling,
  );
  const groupSelection = useProjectMapStore((state) => state.groupSelection);
  const undo = useProjectMapStore((state) => state.undo);
  const redo = useProjectMapStore((state) => state.redo);

  const [drag, setDrag] = React.useState<Drag | null>(null);
  /** Held space pans in every tool, so the paper is never out of reach. */
  const [spaceHeld, setSpaceHeld] = React.useState(false);

  const { mode } = map.canvas.view;
  const showsDerived = mode !== "freeform";
  const showsAuthored = mode !== "derived";
  const shapes = React.useMemo(
    () => (showsAuthored ? map.canvas.shapes : []),
    [map.canvas.shapes, showsAuthored],
  );
  const connectors = React.useMemo(
    () => (showsAuthored ? map.canvas.connectors : []),
    [map.canvas.connectors, showsAuthored],
  );

  const model = React.useMemo(() => projectMapRenderModel(map), [map]);
  const drawn = React.useMemo(() => {
    if (!showsDerived) return [];
    if (derivedLayer !== null) return derivedLayer.nodes;
    return showHidden
      ? [...model.nodes, ...map.nodes.filter((node) => node.hidden)]
      : model.nodes;
  }, [model.nodes, map.nodes, showHidden, showsDerived, derivedLayer]);

  /**
   * The lines between whatever the current layer draws.
   *
   * A rendered edge needs a stable key, which the committed analysis gets
   * from the render model's own folding of collapsed groups. A live layer has
   * no groups, so its key is simply what it joins.
   */
  const layerEdges = React.useMemo((): ProjectMapRenderEdge[] => {
    if (derivedLayer === null) return model.edges;
    return derivedLayer.edges.map((edge) => ({
      ...edge,
      key: `${edge.from}|${edge.kind}|${edge.to}`,
    }));
  }, [derivedLayer, model.edges]);
  /**
   * Dimming applies only to a selection that contains an analysed node.
   * Selecting a drawn box has no edges to be adjacent to, so dimming on it
   * would fade the entire analysis for no reason a reader could work out.
   */
  /**
   * The paper's size in pixels, for deciding what is in view.
   *
   * Read through a ResizeObserver rather than during render: a layout read
   * in the render path on a drawing this size is exactly the cost this
   * whole mechanism exists to avoid.
   */
  const [frameSize, setFrameSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);
  React.useEffect(() => {
    const element = frameRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const read = () => {
      const rect = element.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frameRef]);

  /**
   * What is actually drawn: everything, until there is too much of it.
   *
   * The live work graph brings about 1,800 plates, nine times what this
   * canvas was measured at, and at that size a drag across the paper took
   * five seconds and a click on the toolbar more than one. Above the
   * threshold only the plates within a screen of the view are rendered; the
   * model keeps every node, so selection, framing, the fold and the edges'
   * geometry are unchanged. Below it nothing is filtered, because a hundred
   * plates cost nothing and a half-drawn small map would be a regression.
   */
  const visibleNodes = React.useMemo(() => {
    if (
      drawn.length <= PLATE_BUDGET ||
      frameSize === null ||
      frameSize.width === 0
    )
      return drawn;
    const margin = OFFSCREEN_MARGIN / viewport.scale;
    const left = viewport.x - margin;
    const top = viewport.y - margin;
    const right = viewport.x + frameSize.width / viewport.scale + margin;
    const bottom = viewport.y + frameSize.height / viewport.scale + margin;
    return drawn.filter((node) => {
      const { width, height } = projectMapNodeSize(node.size);
      return (
        node.x < right &&
        node.x + width > left &&
        node.y < bottom &&
        node.y + height > top
      );
    });
  }, [drawn, frameSize, viewport]);

  const visibleIds = React.useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );

  const focusIds = React.useMemo(() => {
    const derivedSelection = selection.filter((id) =>
      drawn.some((node) => node.id === id),
    );
    if (derivedSelection.length > 0)
      return projectMapFocusIds(derivedSelection, layerEdges);
    // Nothing selected, but a layer was opened from the overview: that layer
    // is what the reader asked for, and everything else is context.
    if (openedGroup !== null)
      return new Set(
        drawn
          .filter((node) => node.group === openedGroup)
          .map((node) => node.id),
      );
    return new Set<string>();
  }, [selection, layerEdges, drawn, openedGroup]);

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

  /**
   * Where everything sits this render, including the live offset of a drag.
   *
   * Built once per render rather than searched per lookup: the edge pass asks
   * twice per edge, every render, and during a drag that is every pointer
   * move. With two layers on the paper a linear search would be felt.
   */
  const rects = React.useMemo(() => {
    const index = new Map<string, Rect>();
    const nodeOffset =
      drag?.kind === "node"
        ? { x: drag.to.x - drag.from.x, y: drag.to.y - drag.from.y }
        : { x: 0, y: 0 };
    for (const node of drawn) {
      const { width, height } = projectMapNodeSize(node.size);
      const moving = drag?.kind === "node" && drag.ids.includes(node.id);
      index.set(node.id, {
        x: node.x + (moving ? nodeOffset.x : 0),
        y: node.y + (moving ? nodeOffset.y : 0),
        width,
        height,
      });
    }
    const shapeOffset =
      drag?.kind === "shape"
        ? { x: drag.to.x - drag.from.x, y: drag.to.y - drag.from.y }
        : { x: 0, y: 0 };
    for (const shape of shapes) {
      const moving = drag?.kind === "shape" && drag.ids.includes(shape.id);
      const resizing = drag?.kind === "resize" && drag.id === shape.id;
      if (resizing) {
        index.set(
          shape.id,
          resizedBox(
            drag.box,
            drag.handle,
            drag.to.x - drag.from.x,
            drag.to.y - drag.from.y,
          ),
        );
        continue;
      }
      index.set(shape.id, {
        x: shape.x + (moving ? shapeOffset.x : 0),
        y: shape.y + (moving ? shapeOffset.y : 0),
        width: shape.width,
        height: shape.height,
      });
    }
    return index;
  }, [drawn, shapes, drag]);

  /** Where a plate or a shape sits, by id. */
  const rectOf = React.useCallback(
    (id: string): Rect | null => {
      if (id.startsWith(PROJECT_MAP_GROUP_NODE_PREFIX)) {
        const groupId = id.slice(PROJECT_MAP_GROUP_NODE_PREFIX.length);
        const bounds = projectMapGroupBounds(map.nodes, groupId);
        if (bounds === null) return null;
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: COLLAPSED_HEIGHT,
        };
      }
      return rects.get(id) ?? null;
    },
    [rects, map.nodes],
  );

  /**
   * Where a connector end lands, or null when its subject is not on the paper.
   *
   * Null rather than a fallback point: a line drawn to the origin because the
   * thing it joins is hidden looks exactly like a line someone drew to the
   * origin, and a reader has no way to tell them apart. The caller leaves
   * those lines out and says how many, which is the honest version of the
   * same thing.
   */
  const endpointPoint = React.useCallback(
    (endpoint: ProjectMapEndpoint, towards: Point): Point | null => {
      if (endpoint.attach === "free") return { x: endpoint.x, y: endpoint.y };
      const id = endpoint.attach === "shape" ? endpoint.shape : endpoint.node;
      const rect = rectOf(id);
      if (rect === null) return null;
      const side = endpoint.side ?? projectMapFacingSide(rect, towards);
      return projectMapSidePoint(rect, side);
    },
    [rectOf],
  );

  /** Lines this view cannot draw, because what they join is not on screen. */
  const hiddenConnectors = React.useMemo(
    () =>
      connectors.filter(
        (connector) =>
          endpointPoint(connector.from, { x: 0, y: 0 }) === null ||
          endpointPoint(connector.to, { x: 0, y: 0 }) === null,
      ).length,
    [connectors, endpointPoint],
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

  /**
   * Whichever drawing is on the paper, as a document the fold understands.
   *
   * The work layer carries its own layers now — machines, programs, runs,
   * agents — so it folds the same way the committed analysis does, which it
   * needs more: it arrives with every run and every source on it.
   */
  const paper = React.useMemo<PlacedProjectMapDocument>(
    () =>
      derivedLayer === null
        ? map
        : {
            ...map,
            nodes: derivedLayer.nodes,
            edges: derivedLayer.edges,
            groups: derivedLayer.groups,
          },
    [map, derivedLayer],
  );

  /**
   * The layers as blocks, when that is what the paper shows. A freeform
   * drawing has nothing to fold, and neither has a drawing with no layers.
   * Whether folding is offered at all is the page's call; null here means
   * draw the detail.
   */
  const overviewModel = React.useMemo<ProjectMapOverview | null>(
    () =>
      overview && showsDerived && paper.groups.length > 0
        ? projectMapOverview(paper)
        : null,
    [overview, showsDerived, paper],
  );

  /**
   * From a block to its layer: leave the overview, unfold the group, put the
   * viewport on it, and say that this is the layer you opened.
   *
   * Without that last part a click on one block arrived at four layers' worth
   * of plates — "I clicked one block and I am looking at four group headers",
   * in the words of someone seeing it for the first time. The rest of the
   * drawing stays on the paper, because a relation leaving the layer is half
   * of what a layer means, but it is faded the way a selection's surroundings
   * already fade.
   */
  const openGroup = (groupId: string) => {
    setOverview(false);
    setOpenedGroup(groupId);
    const group = paper.groups.find((candidate) => candidate.id === groupId);
    // Only the committed analysis has groups a person can fold; the work
    // layer's are assembled on every fetch, and unfolding one there would
    // write a view into the repository's file.
    if (group?.collapsed && derivedLayer === null)
      setGroupCollapsed(groupId, false);
    const bounds = projectMapGroupBounds(
      paper.nodes.filter((node) => !node.hidden),
      groupId,
    );
    const frame = frameRef.current?.getBoundingClientRect();
    if (bounds === null || !frame || frame.width === 0) return;
    // Floored, not fitted outright: a layer fifteen plates tall shrank to
    // unreadable when the whole of it had to be in frame. The width fits,
    // the height is panned through, and the fade says which layer this is.
    const fitted = fitProjectMapViewBox(bounds, frame, {
      min: OPEN_LAYER_MIN_SCALE,
      max: OPEN_LAYER_MAX_SCALE,
    });
    const pad = PROJECT_MAP_GROUP_PADDING / fitted.scale;
    setViewport({
      scale: fitted.scale,
      x: bounds.x - pad,
      y: bounds.y - pad,
    });
  };

  /**
   * A press on the overview's paper only ever pans. The drawing tools act on
   * the detail's coordinates, which are not the ones under the pointer here,
   * so a box drawn now would land somewhere else later.
   */
  const handleOverviewPointerDown = (
    event: React.PointerEvent<SVGSVGElement>,
  ) => {
    if (event.button !== 0 && event.button !== 1) return;
    capturePointer(event.currentTarget, event.pointerId);
    event.currentTarget.focus();
    setDrag({
      kind: "pan",
      pointerId: event.pointerId,
      screen: { x: event.clientX, y: event.clientY },
      origin: { x: viewport.x, y: viewport.y },
    });
  };

  /**
   * A press on the paper.
   *
   * The one rule that keeps the original grammar true: the active tool decides
   * what this means, and with the Select tool nothing has changed. Pan is
   * never out of reach — held space and the middle button pan in every tool.
   */
  const handleBackgroundPointerDown = (
    event: React.PointerEvent<SVGSVGElement>,
  ) => {
    const panning = event.button === 1 || spaceHeld;
    if (event.button !== 0 && !panning) return;
    const screen = { x: event.clientX, y: event.clientY };
    capturePointer(event.currentTarget, event.pointerId);
    // The paper takes focus so Escape reaches this element's key handler. With
    // the pointer captured nothing inside the drawing can take it, and focus
    // left on the document body is focus the canvas cannot hear.
    event.currentTarget.focus();
    const point = toDiagram(event);

    if (!panning && tool !== "select") {
      if (tool === "connect") {
        setDrag({
          kind: "connect",
          pointerId: event.pointerId,
          screen,
          origin: { attach: "free", x: point.x, y: point.y },
          start: point,
          to: point,
        });
        return;
      }
      setDrag({
        kind: "create",
        pointerId: event.pointerId,
        screen,
        shapeKind: tool,
        from: point,
        to: point,
      });
      return;
    }

    if (!panning && event.shiftKey) {
      setDrag({
        kind: "marquee",
        pointerId: event.pointerId,
        screen,
        from: point,
        to: point,
      });
      return;
    }
    setDrag({
      kind: "pan",
      pointerId: event.pointerId,
      screen,
      origin: { x: viewport.x, y: viewport.y },
    });
  };

  /** A press on a drawn shape: the authored twin of pressing a plate. */
  const handleShapePointerDown = (
    event: React.PointerEvent<SVGGElement>,
    shape: ProjectMapShape,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const point = toDiagram(event);
    capturePointer(frameRef.current, event.pointerId);
    event.currentTarget.focus();

    if (tool === "connect") {
      setDrag({
        kind: "connect",
        pointerId: event.pointerId,
        screen: { x: event.clientX, y: event.clientY },
        origin: { attach: "shape", shape: shape.id, side: null },
        start: point,
        to: point,
      });
      return;
    }

    const additive = event.shiftKey || event.metaKey;
    const wasSelected = selection.includes(shape.id);
    const ids = wasSelected
      ? selection.filter((id) =>
          shapes.some((candidate) => candidate.id === id),
        )
      : additive
        ? [...selection, shape.id]
        : [shape.id];
    if (!wasSelected) setSelection(ids);
    setDrag({
      kind: "shape",
      pointerId: event.pointerId,
      screen: { x: event.clientX, y: event.clientY },
      ids,
      target: shape.id,
      additive,
      wasSelected,
      from: point,
      to: point,
    });
  };

  const handleHandlePointerDown = (
    event: React.PointerEvent<SVGRectElement>,
    shape: ProjectMapShape,
    handle: ProjectMapShapeHandle,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const point = toDiagram(event);
    capturePointer(frameRef.current, event.pointerId);
    setDrag({
      kind: "resize",
      pointerId: event.pointerId,
      screen: { x: event.clientX, y: event.clientY },
      id: shape.id,
      handle,
      box: {
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      },
      from: point,
      to: point,
    });
  };

  /** What a line being dragged would attach to if it were released here. */
  const endpointAt = React.useCallback(
    (point: Point): ProjectMapEndpoint => {
      const shape = [...shapes].reverse().find((candidate) => {
        const rect = rects.get(candidate.id);
        return (
          rect !== undefined &&
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
        );
      });
      if (shape !== undefined) {
        return { attach: "shape", shape: shape.id, side: null };
      }
      const node = drawn.find((candidate) => {
        const rect = rects.get(candidate.id);
        return (
          rect !== undefined &&
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
        );
      });
      if (node !== undefined) {
        return { attach: "derived", layer: "code", node: node.id, side: null };
      }
      return { attach: "free", x: point.x, y: point.y };
    },
    [shapes, drawn, rects],
  );

  const handleNodePointerDown = (
    event: React.PointerEvent<SVGGElement>,
    node: PlacedProjectMapNode,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (tool === "connect") {
      // A line from the analysis to a drawn note is the whole point of the
      // two layers sharing a canvas, so a plate is a valid place to start one.
      const point = toDiagram(event);
      capturePointer(frameRef.current, event.pointerId);
      setDrag({
        kind: "connect",
        pointerId: event.pointerId,
        screen: { x: event.clientX, y: event.clientY },
        origin: { attach: "derived", layer: "code", node: node.id, side: null },
        start: point,
        to: point,
      });
      return;
    }
    const additive = event.shiftKey || event.metaKey;
    const wasSelected = selection.includes(node.id);
    // A drag moves whatever the press landed inside, so pressing a plate that
    // is already part of a multi-selection keeps that selection. Narrowing to
    // this one plate is what *releasing* without travel means.
    const ids = wasSelected
      ? selection
      : additive
        ? [...selection, node.id]
        : [node.id];
    if (!wasSelected) setSelection(ids);
    const point = toDiagram(event);
    capturePointer(frameRef.current, event.pointerId);
    event.currentTarget.focus();
    setDrag({
      kind: "node",
      pointerId: event.pointerId,
      screen: { x: event.clientX, y: event.clientY },
      ids,
      target: node.id,
      additive,
      wasSelected,
      from: point,
      to: point,
    });
  };

  /**
   * The plates' handlers, stable for the life of the canvas.
   *
   * `React.memo` on a plate is only worth anything if its props hold still,
   * and a handler defined in the render body is a new prop every time. These
   * forward to the current implementation through a ref, so a plate that
   * skipped a render still calls today's closure rather than yesterday's.
   */
  const latestNodePointerDown = React.useRef(handleNodePointerDown);
  latestNodePointerDown.current = handleNodePointerDown;
  const onNodePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGGElement>, node: PlacedProjectMapNode) =>
      latestNodePointerDown.current(event, node),
    [],
  );

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.kind === "pan") {
      // Both ends of the delta are fixed for the whole drag: the press, and
      // the viewport it started from.
      setViewport({
        scale: viewport.scale,
        x: drag.origin.x - (event.clientX - drag.screen.x) / viewport.scale,
        y: drag.origin.y - (event.clientY - drag.screen.y) / viewport.scale,
      });
      return;
    }
    setDrag({ ...drag, to: toDiagram(event) });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.pointerId !== event.pointerId) return;
    const tap = isTap(drag, event);
    if (drag.kind === "pan") {
      // A press on empty paper that went nowhere is a click on the paper, and
      // clicking the paper puts the selection down.
      if (tap) {
        clearSelection();
        setFocused(null);
      }
    } else if (drag.kind === "node") {
      if (tap) {
        // Shift narrows nothing: it adds, and takes back out what it added
        // last time. A plain click narrows to the plate under the pointer.
        if (!drag.additive) setSelection([drag.target]);
        else if (drag.wasSelected) toggleInSelection(drag.target);
      } else {
        const dx = drag.to.x - drag.from.x;
        const dy = drag.to.y - drag.from.y;
        if (dx !== 0 || dy !== 0) moveSelection(drag.ids, dx, dy);
      }
    } else if (drag.kind === "shape") {
      if (tap) {
        if (!drag.additive) setSelection([drag.target]);
        else if (drag.wasSelected) toggleInSelection(drag.target);
      } else {
        const dx = drag.to.x - drag.from.x;
        const dy = drag.to.y - drag.from.y;
        if (dx !== 0 || dy !== 0) moveShapes(drag.ids, dx, dy);
      }
    } else if (drag.kind === "create") {
      // A tap makes a shape at its default size; a sweep makes the box that
      // was swept. Both are the same gesture, which is why one tool does both.
      const box = dragBox(drag.from, drag.to);
      const swept = box.width > TAP_SLOP && box.height > TAP_SLOP;
      addShape({
        kind: drag.shapeKind,
        x: swept ? box.x : drag.from.x,
        y: swept ? box.y : drag.from.y,
        ...(swept ? { width: box.width, height: box.height } : {}),
      });
      // One shape per press: the tool returns to Select so the next press
      // does not silently make another.
      setTool("select");
    } else if (drag.kind === "connect") {
      const target = endpointAt(drag.to);
      const sameShape =
        drag.origin.attach === "shape" &&
        target.attach === "shape" &&
        drag.origin.shape === target.shape;
      // A line from a thing to itself is a slip, not a drawing.
      if (!tap && !sameShape) addConnector(drag.origin, target);
      setTool("select");
    } else if (drag.kind === "resize") {
      const box = resizedBox(
        drag.box,
        drag.handle,
        drag.to.x - drag.from.x,
        drag.to.y - drag.from.y,
      );
      if (!tap) resizeShape(drag.id, box);
    } else {
      const box = marqueeBox(drag);
      const hit = (rect: Rect | null) =>
        rect !== null &&
        rect.x + rect.width >= box.x &&
        rect.x <= box.x + box.width &&
        rect.y + rect.height >= box.y &&
        rect.y <= box.y + box.height;
      // The sweep covers whatever this mode actually draws, so a marquee in
      // freeform mode does not select plates nobody can see.
      const swept = [
        ...drawn.filter((node) => hit(rectOf(node.id))).map((node) => node.id),
        ...shapes.filter((shape) => hit(rectOf(shape.id))).map((s) => s.id),
      ];
      if (swept.length > 0) setSelection(swept);
      else clearSelection();
    }
    setDrag(null);
  };

  const handleNodeKeyDown = (
    event: React.KeyboardEvent<SVGGElement>,
    node: PlacedProjectMapNode,
  ) => {
    if (fromTextField(event)) return;
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

  const latestNodeKeyDown = React.useRef(handleNodeKeyDown);
  latestNodeKeyDown.current = handleNodeKeyDown;
  const onNodeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<SVGGElement>, node: PlacedProjectMapNode) =>
      latestNodeKeyDown.current(event, node),
    [],
  );
  const onNodeFocus = React.useCallback(
    (node: PlacedProjectMapNode) => setFocused(node.id),
    [setFocused],
  );

  /**
   * Keyboard on a drawn shape.
   *
   * Enter opens its text rather than selecting it, because a shape with no
   * words in it says nothing, and typing is the next thing anyone wants after
   * making one.
   */
  const handleShapeKeyDown = (
    event: React.KeyboardEvent<SVGGElement>,
    shape: ProjectMapShape,
  ) => {
    if (fromTextField(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      setSelection([shape.id]);
      setEditingShape(shape.id);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (event.shiftKey) toggleInSelection(shape.id);
      else setSelection([shape.id]);
    }
  };

  /**
   * The shape handlers, with one identity for the life of the canvas.
   *
   * A memoised shape only skips a re-render if its props are unchanged, and
   * an inline closure is a new prop every render — so without this the memo
   * on `ProjectMapShapeMark` would never fire during a drag, which is the
   * only time it matters. Each one reads the current implementation out of a
   * ref rather than capturing it, so nothing goes stale: a press after the
   * tool changed still runs what the new tool wants.
   */
  const handlers = React.useRef({
    handleShapePointerDown,
    handleHandlePointerDown,
    handleShapeKeyDown,
  });
  handlers.current = {
    handleShapePointerDown,
    handleHandlePointerDown,
    handleShapeKeyDown,
  };
  const onShapePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGGElement>, shape: ProjectMapShape) =>
      handlers.current.handleShapePointerDown(event, shape),
    [],
  );
  const onShapeHandlePointerDown = React.useCallback(
    (
      event: React.PointerEvent<SVGRectElement>,
      shape: ProjectMapShape,
      handle: ProjectMapShapeHandle,
    ) => handlers.current.handleHandlePointerDown(event, shape, handle),
    [],
  );
  const onShapeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<SVGGElement>, shape: ProjectMapShape) =>
      handlers.current.handleShapeKeyDown(event, shape),
    [],
  );

  const transform = `translate(${-viewport.x * viewport.scale} ${-viewport.y * viewport.scale}) scale(${viewport.scale})`;
  const detailed = viewport.scale >= DETAIL_SCALE;

  return (
    <svg
      ref={frameRef}
      data-testid="project-map-canvas"
      role="application"
      aria-label={t(I18nKey.PROJECT_MAP$CANVAS_LABEL)}
      // Focusable by pointer but not a tab stop: tabbing should reach the
      // plates, while a press on the paper still has somewhere to put focus.
      tabIndex={-1}
      className="h-full w-full touch-none select-none bg-canvas-base outline-none"
      onWheel={handleWheel}
      onPointerDown={
        overviewModel === null
          ? handleBackgroundPointerDown
          : handleOverviewPointerDown
      }
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      // A cancelled pointer is a gesture the system took away, not a release:
      // abandon it rather than committing a move the user never finished.
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(event) => {
        if (fromTextField(event)) return;
        if (event.key === " " && !spaceHeld) {
          // Held space pans; it must not also scroll the page.
          event.preventDefault();
          setSpaceHeld(true);
          return;
        }
        if (event.key === "Escape") {
          // Escape leaves the tool first, then puts the selection down: one
          // key, the shallowest thing it could mean each time.
          if (tool !== "select") setTool("select");
          else clearSelection();
          return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          // Drawn things only. An analysed node is a claim the next analysis
          // will make again, so it is hidden rather than deleted.
          event.preventDefault();
          removeSelected();
          return;
        }
        const accel = event.ctrlKey || event.metaKey;
        if (accel && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (accel && event.key.toLowerCase() === "g") {
          event.preventDefault();
          groupSelection();
          return;
        }
        if (event.key === "Tab" && selection.length === 1) {
          const [id] = selection;
          if (!shapes.some((shape) => shape.id === id)) return;
          event.preventDefault();
          addBranchChild(id);
          return;
        }
        if (event.key === "Enter" && selection.length === 1) {
          const [id] = selection;
          if (!shapes.some((shape) => shape.id === id)) return;
          event.preventDefault();
          addBranchSibling(id);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " ") setSpaceHeld(false);
      }}
    >
      <desc>{t(I18nKey.PROJECT_MAP$CANVAS_HELP)}</desc>
      {hiddenConnectors > 0 && (
        <text
          data-testid="project-map-hidden-connectors"
          x={12}
          y={20}
          className="fill-muted"
          fontSize={11}
        >
          {t(I18nKey.PROJECT_MAP$CONNECTORS_HIDDEN)}
        </text>
      )}
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
        {overviewModel !== null ? (
          <ProjectMapOverviewLayer
            overview={overviewModel}
            accentOf={accentOf}
            waitingLayers={projectMapWaitingLayers(map, waitingParts)}
            onOpen={openGroup}
          />
        ) : (
          <>
            {/* Frames first of all: a region is painted behind what it holds. */}
            {shapes
              .filter((shape) => shape.kind === "frame")
              .map((shape) => (
                <ProjectMapShapeMark
                  key={shape.id}
                  shape={shape}
                  rect={rects.get(shape.id) ?? shape}
                  selected={selection.includes(shape.id)}
                  focused={focused === shape.id}
                  resizable={
                    selection.length === 1 && selection[0] === shape.id
                  }
                  onPointerDown={onShapePointerDown}
                  onHandlePointerDown={onShapeHandlePointerDown}
                  onKeyDown={onShapeKeyDown}
                />
              ))}

            {/* Group boundaries, drawn first so the plates sit on them. */}
            {showsDerived &&
              map.groups.map((group) => {
                const bounds = projectMapGroupBounds(
                  group.collapsed ? map.nodes : drawn,
                  group.id,
                );
                if (bounds === null) return null;
                const accent = accentOf(group.id);
                const labelWidth =
                  group.label.length * 6 + GROUP_LABEL_PADDING * 2;
                return (
                  <g
                    key={group.id}
                    data-testid={`project-map-group-${group.id}`}
                  >
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
                        {
                          map.nodes.filter((node) => node.group === group.id)
                            .length
                        }
                      </text>
                    )}
                  </g>
                );
              })}

            {/* Edges under the plates: a line should pass behind what it joins. */}
            <g>
              {showsDerived &&
                layerEdges.map((edge) => {
                  // An edge with neither end on screen draws a line nobody
                  // can see, and there are two thousand of them.
                  if (
                    visibleNodes.length !== drawn.length &&
                    !visibleIds.has(edge.from) &&
                    !visibleIds.has(edge.to)
                  )
                    return null;
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

            {/* Branch lines are derived from the tree, never stored, so the mind
            map has one source of truth. */}
            <g>
              {shapes.map((shape) => {
                if (shape.parent === null) return null;
                const parent = rects.get(shape.parent);
                const child = rects.get(shape.id);
                if (parent === undefined || child === undefined) return null;
                return (
                  <path
                    key={`branch-${shape.id}`}
                    data-testid={`project-map-branch-${shape.id}`}
                    d={projectMapBranchPath(parent, child)}
                    className="fill-none stroke-border"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>

            {connectors.map((connector) => {
              const roughTo = endpointPoint(connector.to, { x: 0, y: 0 });
              const from = endpointPoint(
                connector.from,
                roughTo ?? { x: 0, y: 0 },
              );
              const to =
                from === null ? null : endpointPoint(connector.to, from);
              if (from === null || to === null) return null;
              return (
                <ProjectMapConnectorMark
                  key={connector.id}
                  connector={connector}
                  from={from}
                  to={to}
                  selected={selection.includes(connector.id)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelection([connector.id]);
                  }}
                />
              );
            })}

            {visibleNodes.map((node) => (
              <ProjectMapNodePlate
                key={node.id}
                waiting={waitingParts.has(node.id)}
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
                onFocus={onNodeFocus}
                onKeyDown={onNodeKeyDown}
                onPointerDown={onNodePointerDown}
              />
            ))}

            {/* Drawn shapes over the analysis: the drawing is what the user is
            working in, so it is never hidden behind a plate. */}
            {shapes
              .filter((shape) => shape.kind !== "frame")
              .map((shape) => (
                <ProjectMapShapeMark
                  key={shape.id}
                  shape={shape}
                  rect={rects.get(shape.id) ?? shape}
                  selected={selection.includes(shape.id)}
                  focused={focused === shape.id}
                  resizable={
                    selection.length === 1 && selection[0] === shape.id
                  }
                  onPointerDown={onShapePointerDown}
                  onHandlePointerDown={onShapeHandlePointerDown}
                  onKeyDown={onShapeKeyDown}
                />
              ))}

            {drag?.kind === "connect" && (
              <ProjectMapConnectorDraft from={drag.start} to={drag.to} />
            )}

            {drag?.kind === "create" && (
              <rect
                data-testid="project-map-create-preview"
                {...dragBox(drag.from, drag.to)}
                className="fill-transparent stroke-border"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {showsDerived &&
              map.notes.map((note) => (
                <ProjectMapNoteMark
                  key={note.id}
                  note={note}
                  anchorRect={note.anchor === null ? null : rectOf(note.anchor)}
                />
              ))}

            {/* Group controls come last in document order so tabbing reaches the
            plates first, while the boundaries above still paint underneath
            them. Paint order and tab order are different questions. */}
            {showsDerived &&
              map.groups.map((group) => {
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
                    {/* An SVG tooltip: the minus in a layer's corner was
                        "meaningful?" to a first visit, and the aria-label
                        is read by nobody hovering. */}
                    <title>
                      {t(
                        group.collapsed
                          ? I18nKey.PROJECT_MAP$EXPAND_GROUP
                          : I18nKey.PROJECT_MAP$COLLAPSE_GROUP,
                      )}
                    </title>
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
          </>
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

/** Smallest box a note is drawn in, and the most it grows to. */
const NOTE_MIN_WIDTH = 120;
const NOTE_MAX_WIDTH = 220;
/** The side of a note's remove control, and the inset of the × inside it. */
const NOTE_REMOVE_SIZE = 14;
const NOTE_REMOVE_INSET = 3.5;

/** The × on a note's remove control: two strokes across an inset square. */
function noteRemoveCross(left: number, top: number): string {
  const near = NOTE_REMOVE_INSET;
  const far = NOTE_REMOVE_SIZE - NOTE_REMOVE_INSET;
  return [
    `M${left + near} ${top + near}L${left + far} ${top + far}`,
    `M${left + far} ${top + near}L${left + near} ${top + far}`,
  ].join("");
}

/**
 * A remark on the drawing: a boxed note on a leader line to its subject, which
 * is how an annotation appears on a plate. Not a yellow sticky — the map is
 * ink on paper and a skeuomorphic note would be the one object in it pretending
 * to be something else.
 *
 * The box is also where the note is written and thrown away, because a remark
 * belongs next to what it remarks on: clicking it (or Enter on it, it is a tab
 * stop) opens a field in its own outline, and the × beside it removes it. The
 * text is typed in a `foreignObject` rather than an SVG `<text>` because a
 * caret, a selection and an IME are things a textarea has and SVG does not.
 */
function ProjectMapNoteMark({
  note,
  anchorRect,
}: {
  note: ProjectMapNote;
  anchorRect: Rect | null;
}) {
  const { t } = useTranslation("openhands");
  const editingNote = useProjectMapStore((state) => state.editingNote);
  const setEditingNote = useProjectMapStore((state) => state.setEditingNote);
  const updateNote = useProjectMapStore((state) => state.updateNote);
  const removeNote = useProjectMapStore((state) => state.removeNote);

  const editing = editingNote === note.id;
  const placeholder = t(I18nKey.PROJECT_MAP$NOTE_PLACEHOLDER);
  const empty = note.text.trim() === "";
  const lines = (empty ? placeholder : note.text).split("\n").slice(0, 3);
  const width = Math.max(
    NOTE_MIN_WIDTH,
    Math.min(NOTE_MAX_WIDTH, (empty ? placeholder : note.text).length * 5.6),
  );
  const height = 16 + lines.length * 13;
  // The control straddles the box's top-right corner, the way a drawing's own
  // revision marks sit on a boundary rather than inside it.
  const removeLeft = note.x + width - NOTE_REMOVE_SIZE / 2;
  const removeTop = note.y - NOTE_REMOVE_SIZE / 2;

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
      {editing ? (
        <foreignObject x={note.x} y={note.y} width={width} height={height}>
          <textarea
            // The field appears because the user asked for it, so it takes
            // focus; a callback ref does that without an autoFocus prop that
            // would also fire on an unrelated remount.
            ref={(element) => element?.focus()}
            aria-label={placeholder}
            placeholder={placeholder}
            defaultValue={note.text}
            className="h-full w-full resize-none bg-transparent px-2 py-1 text-micro text-foreground outline-none placeholder:text-muted"
            onBlur={(event) => {
              updateNote(note.id, event.currentTarget.value);
              setEditingNote(null);
            }}
            onKeyDown={(event) => {
              // Escape here means "done with this note", not "clear the
              // selection", so it must not reach the canvas.
              if (event.key !== "Escape") return;
              event.stopPropagation();
              event.currentTarget.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </foreignObject>
      ) : (
        <g
          role="button"
          tabIndex={0}
          aria-label={empty ? placeholder : note.text}
          data-testid={`project-map-edit-note-${note.id}`}
          className="cursor-text"
          onClick={() => setEditingNote(note.id)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setEditingNote(note.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {lines.map((line, index) => (
            <text
              key={index}
              x={note.x + 9}
              y={note.y + 20 + index * 13}
              fontSize={10.5}
              className={empty ? "fill-muted italic" : "fill-text-secondary"}
            >
              {line.slice(0, 40)}
            </text>
          ))}
        </g>
      )}
      <g
        role="button"
        tabIndex={0}
        aria-label={t(I18nKey.PROJECT_MAP$REMOVE_NOTE)}
        data-testid={`project-map-remove-note-${note.id}`}
        className="cursor-pointer"
        onClick={() => removeNote(note.id)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          removeNote(note.id);
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <rect
          x={removeLeft}
          y={removeTop}
          width={NOTE_REMOVE_SIZE}
          height={NOTE_REMOVE_SIZE}
          className="fill-surface-raised stroke-border-subtle"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={noteRemoveCross(removeLeft, removeTop)}
          className="stroke-muted"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </g>
  );
}
