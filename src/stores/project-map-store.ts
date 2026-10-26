/**
 * The open project map: the working copy, the selection, and the viewport.
 *
 * The *file* is owned by `useProjectMap`; this store owns the **editor
 * buffer** over it, the way a text editor owns unsaved text. The distinction
 * matters because the canvas, the inspector and the composer all have to agree
 * on one selection and one set of pending moves, and because a save has to be
 * something the user asks for rather than a side effect of dragging.
 *
 * Hydration is keyed by `source`: a string identifying the file revision the
 * buffer came from. Re-reading the same unchanged file does not throw away
 * unsaved work, and re-reading a changed one replaces the buffer wholesale —
 * there is no three-way merge here, and pretending otherwise would be worse
 * than being explicit that the last writer wins.
 */

import { create } from "zustand";
import type {
  PlacedProjectMapDocument,
  PlacedProjectMapNode,
  ProjectMapAnchor,
  ProjectMapCanvasLayer,
  ProjectMapConnector,
  ProjectMapEndpoint,
  ProjectMapLayerId,
  ProjectMapLayoutKind,
  ProjectMapMode,
  ProjectMapNote,
  ProjectMapShape,
} from "#/types/project-map";
import {
  PROJECT_MAP_GRID,
  projectMapGroupAtPoint,
  projectMapNodeSize,
} from "#/utils/project-map/project-map-layout";
import {
  PROJECT_MAP_SHAPE_DEFAULT_SIZE,
  PROJECT_MAP_SHAPE_MIN_SIZE,
  createProjectMapConnector,
  createProjectMapShape,
  type CreateProjectMapShapeOptions,
} from "#/utils/project-map/project-map-authoring";
import { layoutProjectMapShapes } from "#/utils/project-map/project-map-autolayout";
import { mergeProjectMap } from "#/utils/project-map/merge-project-map";

/**
 * Which tool a press on the paper means.
 *
 * It lives in the store rather than the document: which tool is in hand is
 * about this moment of editing, not about the drawing, so it must never reach
 * the committed file.
 */
export const PROJECT_MAP_TOOLS = [
  "select",
  "box",
  "diamond",
  "sticky",
  "frame",
  "branch",
  "connect",
] as const;

export type ProjectMapTool = (typeof PROJECT_MAP_TOOLS)[number];

/** How many steps back the editor remembers. */
export const PROJECT_MAP_HISTORY_LIMIT = 50;

export interface ProjectMapViewport {
  /** Diagram coordinate shown at the top-left of the frame. */
  x: number;
  y: number;
  scale: number;
}

export const PROJECT_MAP_MIN_SCALE = 0.25;
export const PROJECT_MAP_MAX_SCALE = 2.5;

const INITIAL_VIEWPORT: ProjectMapViewport = { x: -40, y: -40, scale: 1 };

interface ProjectMapState {
  /** Identity of the file revision the buffer came from, or null when empty. */
  source: string | null;
  document: PlacedProjectMapDocument | null;
  /**
   * Shapes the newest revision cut loose, because the node they were anchored
   * to is gone. They keep their place and stop following anything, which is
   * worth saying out loud: the alternative is a sticky note that quietly
   * stopped tracking its subject.
   */
  releasedShapeIds: string[];
  dirty: boolean;
  selection: string[];
  /** The keyboard cursor, which may lead the selection. */
  focused: string | null;
  /**
   * The note whose text is open for editing, if any.
   *
   * It lives here rather than in the canvas because the two halves of the
   * gesture are in different components: the inspector's **Add a note** is
   * what makes a note, and the canvas is where it is typed. A new note opens
   * its own editor, so adding one is never a dead end.
   */
  editingNote: string | null;
  /** The drawn shape whose text is open, if any. */
  editingShape: string | null;
  /** The connector whose label is open, if any. */
  editingConnectorLabel: string | null;
  /** Which tool a press on the paper means right now. */
  tool: ProjectMapTool;
  /**
   * Whether the chat dock is expanded.
   *
   * Ephemeral UI, deliberately not in the document: where the canvas is the
   * work, chat is a panel you open when you want it.
   */
  chatOpen: boolean;
  /**
   * Buffers before and after the current one.
   *
   * The save is explicit, and Delete can remove drawn work that was never
   * saved, so without this an accident is unrecoverable.
   */
  past: PlacedProjectMapDocument[];
  future: PlacedProjectMapDocument[];
  viewport: ProjectMapViewport;
  /** Hidden nodes are drawn, faint, while this is on, so they can be restored. */
  showHidden: boolean;
  /**
   * Whether the paper shows the map's layers as blocks instead of its parts.
   *
   * A view, like `showHidden`, not a document field: a wall of a hundred
   * plates opens as its eight layers, and clicking one opens the detail.
   */
  overview: boolean;

  hydrate: (source: string, document: PlacedProjectMapDocument) => void;
  reset: () => void;
  markSaved: () => void;

  setSelection: (ids: string[]) => void;
  toggleInSelection: (id: string) => void;
  clearSelection: () => void;
  setFocused: (id: string | null) => void;

  moveSelection: (ids: string[], dx: number, dy: number) => void;
  setNodeGroup: (id: string, group: string | null) => void;
  renameNode: (id: string, label: string) => void;
  setNodeHidden: (id: string, hidden: boolean) => void;
  setNodePinned: (id: string, pinned: boolean) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  toggleShowHidden: () => void;
  setOverview: (overview: boolean) => void;

  addNote: (note: ProjectMapNote) => void;
  updateNote: (id: string, text: string) => void;
  removeNote: (id: string) => void;
  setEditingNote: (id: string | null) => void;

  setMode: (mode: ProjectMapMode) => void;
  setLayer: (layer: ProjectMapLayerId) => void;
  setTool: (tool: ProjectMapTool) => void;
  setChatOpen: (open: boolean) => void;
  setEditingShape: (id: string | null) => void;
  setEditingConnectorLabel: (id: string | null) => void;

  addShape: (options: CreateProjectMapShapeOptions) => void;
  updateShapeText: (id: string, text: string) => void;
  moveShapes: (ids: string[], dx: number, dy: number) => void;
  resizeShape: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  setShapeAccent: (id: string, accent: string | null) => void;
  setShapePinned: (id: string, pinned: boolean) => void;
  anchorShape: (id: string, anchor: ProjectMapAnchor | null) => void;
  removeSelected: () => void;

  addConnector: (from: ProjectMapEndpoint, to: ProjectMapEndpoint) => void;
  updateConnector: (
    id: string,
    change: Partial<Omit<ProjectMapConnector, "id">>,
  ) => void;

  groupSelection: () => void;
  ungroupFrame: (id: string) => void;
  addBranchChild: (parentId: string) => void;
  addBranchSibling: (siblingId: string) => void;

  runLayout: (kind: ProjectMapLayoutKind) => void;
  undo: () => void;
  redo: () => void;

  setViewport: (viewport: ProjectMapViewport) => void;
}

function snap(value: number): number {
  return Math.round(value / PROJECT_MAP_GRID) * PROJECT_MAP_GRID;
}

function center(node: PlacedProjectMapNode): { x: number; y: number } {
  const { width, height } = projectMapNodeSize(node.size);
  return { x: node.x + width / 2, y: node.y + height / 2 };
}

/**
 * Applies a change to the buffer, records that it differs from disk, and
 * remembers the buffer it replaced.
 *
 * Every edit goes through here, which is what makes one undo step mean one
 * thing the user did rather than one field that happened to change.
 */
function edit(
  state: ProjectMapState,
  change: (document: PlacedProjectMapDocument) => PlacedProjectMapDocument,
): Partial<ProjectMapState> {
  if (state.document === null) return {};
  return {
    document: change(state.document),
    dirty: true,
    past: [...state.past, state.document].slice(-PROJECT_MAP_HISTORY_LIMIT),
    // A new edit is a new branch of history: what was undone is no longer
    // reachable, and pretending otherwise would redo the wrong thing.
    future: [],
  };
}

/** Applies a change to the authored layer only. */
function editCanvas(
  state: ProjectMapState,
  change: (canvas: ProjectMapCanvasLayer) => ProjectMapCanvasLayer,
): Partial<ProjectMapState> {
  return edit(state, (document) => ({
    ...document,
    canvas: change(document.canvas),
  }));
}

/**
 * The view, with the drawn layer made visible.
 *
 * Anything that creates drawn content runs through this: making something the
 * user cannot see, in a mode that hides it, would read as the editor silently
 * dropping their work. The analysis stays on screen too, so nothing they were
 * looking at disappears either.
 */
function showingAuthored(canvas: ProjectMapCanvasLayer): ProjectMapCanvasLayer {
  if (canvas.view.mode !== "derived") return canvas;
  return { ...canvas, view: { ...canvas.view, mode: "both" } };
}

function mapShape(
  canvas: ProjectMapCanvasLayer,
  id: string,
  change: (shape: ProjectMapShape) => ProjectMapShape,
): ProjectMapCanvasLayer {
  return {
    ...canvas,
    shapes: canvas.shapes.map((shape) =>
      shape.id === id ? change(shape) : shape,
    ),
  };
}

/** Where a shape is drawn: its anchor's node if it has one, else its own x/y. */
export function shapeOrigin(
  document: PlacedProjectMapDocument,
  shape: ProjectMapShape,
): { x: number; y: number } {
  const anchor = shape.anchor?.layer === "code" ? shape.anchor : null;
  if (anchor === null) {
    return { x: shape.x, y: shape.y };
  }
  const node = document.nodes.find((candidate) => candidate.id === anchor.node);
  if (node === undefined) return { x: shape.x, y: shape.y };
  return { x: node.x + anchor.dx, y: node.y + anchor.dy };
}

/** True when `inner` sits entirely within `outer`'s bounds. */
function contains(outer: ProjectMapShape, inner: ProjectMapShape): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Where a line's end goes when the shape it was attached to is deleted.
 *
 * It lands on that shape's last position rather than vanishing, so a deletion
 * never silently removes a line the user can still see.
 */
function releaseEndpoint(
  endpoint: ProjectMapEndpoint,
  removed: Set<string>,
  before: ProjectMapShape[],
): ProjectMapEndpoint {
  if (endpoint.attach !== "shape" || !removed.has(endpoint.shape)) {
    return endpoint;
  }
  const gone = before.find((shape) => shape.id === endpoint.shape);
  return {
    attach: "free",
    x: gone ? gone.x + gone.width / 2 : 0,
    y: gone ? gone.y + gone.height / 2 : 0,
  };
}

/** The whole drawing's extent, used to place a new arrangement clear of it. */
function shapesBounds(shapes: ProjectMapShape[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (shapes.length === 0) return null;
  const minX = Math.min(...shapes.map((shape) => shape.x));
  const minY = Math.min(...shapes.map((shape) => shape.y));
  const maxX = Math.max(...shapes.map((shape) => shape.x + shape.width));
  const maxY = Math.max(...shapes.map((shape) => shape.y + shape.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function mapNode(
  document: PlacedProjectMapDocument,
  id: string,
  change: (node: PlacedProjectMapNode) => PlacedProjectMapNode,
): PlacedProjectMapDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => (node.id === id ? change(node) : node)),
  };
}

export const useProjectMapStore = create<ProjectMapState>((set) => ({
  source: null,
  document: null,
  releasedShapeIds: [],
  dirty: false,
  selection: [],
  focused: null,
  editingNote: null,
  editingShape: null,
  editingConnectorLabel: null,
  tool: "select",
  chatOpen: false,
  past: [],
  future: [],
  viewport: INITIAL_VIEWPORT,
  showHidden: false,
  overview: false,

  hydrate: (source, incoming) =>
    set((state) => {
      if (state.source === source) return {};
      // A new revision arriving on top of unsaved edits is the regeneration
      // case: the agent rewrote the file while the user still had moves in
      // hand. The merge replays those decisions onto the new analysis, so a
      // regeneration costs nobody their arrangement even when it was never
      // saved. The analysis prompt asks the agent to preserve the same
      // fields; this is the half of that contract Canvas can enforce itself.
      // The merge also says which shapes it had to cut loose: a shape
      // anchored to a node the regeneration dropped keeps its place but no
      // longer follows anything. That was computed and thrown away here, so
      // the shape silently stopped tracking and the person who anchored it
      // found out the next time they moved its subject and nothing came with
      // it. The plan asks for a visible warning; this is what carries it.
      const merged =
        state.document !== null && state.dirty
          ? mergeProjectMap(state.document, incoming)
          : null;
      const document = merged ? merged.document : incoming;
      const ids = new Set(document.nodes.map((node) => node.id));
      const noteIds = new Set(document.notes.map((note) => note.id));
      return {
        source,
        document,
        //: Shapes whose anchor the newest revision dropped, for the surface
        //: to name. Replaced rather than accumulated: it describes this
        //: revision, and a list that grew would keep reporting a release the
        //: reader has already seen.
        releasedShapeIds: merged ? merged.releasedShapeIds : [],
        dirty: state.document !== null && state.dirty,
        // A selection that survived a reload keeps the inspector pointing at
        // something that still exists.
        selection: state.selection.filter((id) => ids.has(id)),
        focused:
          state.focused !== null && ids.has(state.focused)
            ? state.focused
            : null,
        // An open editor whose note the new revision dropped has nothing left
        // to write to.
        editingNote:
          state.editingNote !== null && noteIds.has(state.editingNote)
            ? state.editingNote
            : null,
        // History belongs to the buffer it was recorded against. Keeping it
        // across a new revision would let undo paste a shape back into a
        // document that never had it.
        past: [],
        future: [],
        editingShape: null,
        editingConnectorLabel: null,
      };
    }),

  reset: () =>
    set({
      source: null,
      document: null,
      releasedShapeIds: [],
      dirty: false,
      selection: [],
      focused: null,
      editingNote: null,
      editingShape: null,
      editingConnectorLabel: null,
      tool: "select",
      chatOpen: false,
      past: [],
      future: [],
      viewport: INITIAL_VIEWPORT,
      showHidden: false,
      overview: false,
    }),

  markSaved: () => set({ dirty: false }),

  setSelection: (ids) =>
    set({ selection: ids, focused: ids[ids.length - 1] ?? null }),
  toggleInSelection: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((candidate) => candidate !== id)
        : [...state.selection, id],
      focused: id,
    })),
  clearSelection: () => set({ selection: [] }),
  setFocused: (id) => set({ focused: id }),

  /**
   * Moving a node pins it. The user just said where it goes, and a later
   * regeneration must not second-guess that.
   */
  moveSelection: (ids, dx, dy) =>
    set((state) =>
      edit(state, (document) => {
        const moving = new Set(ids);
        const moved = document.nodes.map((node) =>
          moving.has(node.id)
            ? {
                ...node,
                x: snap(node.x + dx),
                y: snap(node.y + dy),
                pinned: true,
              }
            : node,
        );
        // Dropping a node inside a group's boundary joins it, because the
        // boundary is where that group's members already are.
        const groupIds = document.groups.map((group) => group.id);
        return {
          ...document,
          nodes: moved.map((node) => {
            if (!moving.has(node.id)) return node;
            const landedIn = projectMapGroupAtPoint(
              moved.filter((candidate) => !moving.has(candidate.id)),
              groupIds,
              center(node),
            );
            return landedIn === null ? node : { ...node, group: landedIn };
          }),
        };
      }),
    ),

  setNodeGroup: (id, group) =>
    set((state) =>
      edit(state, (document) =>
        mapNode(document, id, (node) => ({ ...node, group })),
      ),
    ),

  /**
   * A rename records who did it. That provenance is the only thing that lets
   * regeneration keep this label and replace the ones it guessed itself.
   */
  renameNode: (id, label) =>
    set((state) =>
      edit(state, (document) =>
        mapNode(document, id, (node) => ({
          ...node,
          label: label.trim() === "" ? node.id : label,
          label_source: "user",
        })),
      ),
    ),

  setNodeHidden: (id, hidden) =>
    set((state) =>
      edit(state, (document) =>
        mapNode(document, id, (node) => ({ ...node, hidden })),
      ),
    ),

  setNodePinned: (id, pinned) =>
    set((state) =>
      edit(state, (document) =>
        mapNode(document, id, (node) => ({ ...node, pinned })),
      ),
    ),

  setGroupCollapsed: (groupId, collapsed) =>
    set((state) =>
      edit(state, (document) => ({
        ...document,
        groups: document.groups.map((group) =>
          group.id === groupId ? { ...group, collapsed } : group,
        ),
      })),
    ),

  toggleShowHidden: () => set((state) => ({ showHidden: !state.showHidden })),
  setOverview: (overview) => set({ overview }),

  /** A new note opens its own editor: an empty note nobody can type in is litter. */
  addNote: (note) =>
    set((state) => {
      const edited = edit(state, (document) => ({
        ...document,
        notes: [...document.notes, note],
      }));
      if (edited.document === undefined) return edited;
      return { ...edited, editingNote: note.id };
    }),

  updateNote: (id, text) =>
    set((state) =>
      edit(state, (document) => ({
        ...document,
        notes: document.notes.map((note) =>
          note.id === id ? { ...note, text } : note,
        ),
      })),
    ),

  removeNote: (id) =>
    set((state) => ({
      ...edit(state, (document) => ({
        ...document,
        notes: document.notes.filter((note) => note.id !== id),
      })),
      editingNote: state.editingNote === id ? null : state.editingNote,
    })),

  setEditingNote: (id) => set({ editingNote: id }),

  setMode: (mode) =>
    set((state) => ({
      ...editCanvas(state, (canvas) => ({
        ...canvas,
        view: { ...canvas.view, mode },
      })),
      // The drawing is not shown in the analysis mode, so a drawing tool in
      // hand there would put invisible shapes on the paper. It goes down.
      tool: mode === "derived" ? "select" : state.tool,
    })),

  /**
   * Which derived layer is on the paper.
   *
   * Goes through `edit` like any other view change, so switching to watch the
   * agents work and back is one undo step and is saved with everything else.
   */
  setLayer: (layer) =>
    set((state) =>
      editCanvas(state, (canvas) => ({
        ...canvas,
        view: { ...canvas.view, layer },
      })),
    ),

  setTool: (tool) => set({ tool }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setEditingShape: (editingShape) => set({ editingShape }),
  setEditingConnectorLabel: (editingConnectorLabel) =>
    set({ editingConnectorLabel }),

  /** A new shape is selected and opened for typing: creating one is never a dead end. */
  addShape: (options) =>
    set((state) => {
      if (state.document === null) return {};
      const shape = createProjectMapShape(state.document.canvas.shapes, {
        ...options,
        x: snap(options.x),
        y: snap(options.y),
      });
      const edited = editCanvas(state, (canvas) => ({
        ...showingAuthored(canvas),
        // A frame paints behind what it contains, so it goes to the front of
        // the list rather than the end.
        shapes:
          shape.kind === "frame"
            ? [shape, ...canvas.shapes]
            : [...canvas.shapes, shape],
      }));
      return {
        ...edited,
        selection: [shape.id],
        focused: shape.id,
        editingShape: shape.kind === "frame" ? null : shape.id,
      };
    }),

  updateShapeText: (id, text) =>
    set((state) =>
      editCanvas(state, (canvas) =>
        mapShape(canvas, id, (shape) => ({ ...shape, text })),
      ),
    ),

  /**
   * Moving drawn shapes.
   *
   * An anchored shape keeps travelling with its node, so the move adjusts the
   * offset it travels at rather than fighting the anchor. A frame carries what
   * it visually contains, which is the only gesture in the editor where moving
   * one object moves another.
   */
  moveShapes: (ids, dx, dy) =>
    set((state) => {
      if (state.document === null) return {};
      const { shapes } = state.document.canvas;
      const direct = new Set(ids);
      const carried = new Set<string>();
      for (const frame of shapes) {
        if (!direct.has(frame.id) || frame.kind !== "frame") continue;
        for (const inner of shapes) {
          if (direct.has(inner.id) || inner.id === frame.id) continue;
          if (contains(frame, inner)) carried.add(inner.id);
        }
      }
      const moving = new Set([...direct, ...carried]);
      const nodeById = new Map(
        state.document.nodes.map((node) => [node.id, node]),
      );
      return editCanvas(state, (canvas) => ({
        ...canvas,
        shapes: canvas.shapes.map((shape) => {
          if (!moving.has(shape.id)) return shape;
          const x = snap(shape.x + dx);
          const y = snap(shape.y + dy);
          const anchor = shape.anchor?.layer === "code" ? shape.anchor : null;
          if (anchor === null) {
            return { ...shape, x, y };
          }
          const node = nodeById.get(anchor.node);
          if (node === undefined) return { ...shape, x, y };
          return {
            ...shape,
            x,
            y,
            anchor: { ...anchor, dx: x - node.x, dy: y - node.y },
          };
        }),
      }));
    }),

  resizeShape: (id, rect) =>
    set((state) =>
      editCanvas(state, (canvas) =>
        mapShape(canvas, id, (shape) => ({
          ...shape,
          x: snap(rect.x),
          y: snap(rect.y),
          width: Math.max(snap(rect.width), PROJECT_MAP_SHAPE_MIN_SIZE),
          height: Math.max(snap(rect.height), PROJECT_MAP_SHAPE_MIN_SIZE),
        })),
      ),
    ),

  setShapeAccent: (id, accent) =>
    set((state) =>
      editCanvas(state, (canvas) =>
        mapShape(canvas, id, (shape) => ({ ...shape, accent })),
      ),
    ),

  setShapePinned: (id, pinned) =>
    set((state) =>
      editCanvas(state, (canvas) =>
        mapShape(canvas, id, (shape) => ({ ...shape, pinned })),
      ),
    ),

  anchorShape: (id, anchor) =>
    set((state) =>
      editCanvas(state, (canvas) =>
        mapShape(canvas, id, (shape) => ({ ...shape, anchor })),
      ),
    ),

  /**
   * Deletes drawn things only.
   *
   * An analysed node is never deleted here: it is a claim about the repository
   * that the next analysis will make again. Hiding one is the gesture that
   * exists for that, and the inspector offers it.
   */
  removeSelected: () =>
    set((state) => {
      if (state.document === null) return {};
      const selected = new Set(state.selection);
      const { shapes, connectors } = state.document.canvas;
      const removedShapes = new Set(
        shapes
          .filter((shape) => selected.has(shape.id))
          .map((shape) => shape.id),
      );
      const removedConnectors = new Set(
        connectors
          .filter((connector) => selected.has(connector.id))
          .map((connector) => connector.id),
      );
      if (removedShapes.size === 0 && removedConnectors.size === 0) return {};
      const edited = editCanvas(state, (canvas) => ({
        ...canvas,
        shapes: canvas.shapes
          .filter((shape) => !removedShapes.has(shape.id))
          // A child whose parent is gone becomes a root rather than vanishing.
          .map((shape) =>
            shape.parent !== null && removedShapes.has(shape.parent)
              ? { ...shape, parent: null }
              : shape,
          ),
        connectors: canvas.connectors
          .filter((connector) => !removedConnectors.has(connector.id))
          // A line whose end is gone ends where that end was, rather than
          // disappearing along with it.
          .map((connector) => ({
            ...connector,
            from: releaseEndpoint(connector.from, removedShapes, shapes),
            to: releaseEndpoint(connector.to, removedShapes, shapes),
          })),
      }));
      return {
        ...edited,
        selection: [],
        focused: null,
        editingShape: null,
        editingConnectorLabel: null,
      };
    }),

  addConnector: (from, to) =>
    set((state) =>
      editCanvas(state, (canvas) => ({
        ...showingAuthored(canvas),
        connectors: [
          ...canvas.connectors,
          createProjectMapConnector(canvas.connectors, { from, to }),
        ],
      })),
    ),

  updateConnector: (id, change) =>
    set((state) =>
      editCanvas(state, (canvas) => ({
        ...canvas,
        connectors: canvas.connectors.map((connector) =>
          connector.id === id ? { ...connector, ...change } : connector,
        ),
      })),
    ),

  /** Wraps the selection in a frame sized to it, behind its contents. */
  groupSelection: () =>
    set((state) => {
      if (state.document === null) return {};
      const selected = new Set(state.selection);
      const inside = state.document.canvas.shapes.filter((shape) =>
        selected.has(shape.id),
      );
      const bounds = shapesBounds(inside);
      if (bounds === null) return {};
      const padding = PROJECT_MAP_GRID * 2;
      const frame = createProjectMapShape(state.document.canvas.shapes, {
        kind: "frame",
        x: bounds.x - padding,
        y: bounds.y - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2,
      });
      const edited = editCanvas(state, (canvas) => ({
        ...showingAuthored(canvas),
        shapes: [frame, ...canvas.shapes],
      }));
      return { ...edited, selection: [frame.id], focused: frame.id };
    }),

  /** Removes a frame and leaves everything that was inside it exactly where it is. */
  ungroupFrame: (id) =>
    set((state) =>
      editCanvas(state, (canvas) => ({
        ...canvas,
        shapes: canvas.shapes.filter(
          (shape) => !(shape.id === id && shape.kind === "frame"),
        ),
      })),
    ),

  addBranchChild: (parentId) =>
    set((state) => {
      if (state.document === null) return {};
      const parent = state.document.canvas.shapes.find(
        (shape) => shape.id === parentId,
      );
      if (parent === undefined) return {};
      const siblings = state.document.canvas.shapes.filter(
        (shape) => shape.parent === parentId,
      );
      const size = PROJECT_MAP_SHAPE_DEFAULT_SIZE.branch;
      const child = createProjectMapShape(state.document.canvas.shapes, {
        kind: "branch",
        parent: parentId,
        x: parent.x + parent.width + PROJECT_MAP_GRID * 4,
        y: parent.y + siblings.length * (size.height + PROJECT_MAP_GRID * 2),
      });
      const edited = editCanvas(state, (canvas) => ({
        ...showingAuthored(canvas),
        shapes: [...canvas.shapes, child],
      }));
      return {
        ...edited,
        selection: [child.id],
        focused: child.id,
        editingShape: child.id,
      };
    }),

  addBranchSibling: (siblingId) =>
    set((state) => {
      if (state.document === null) return {};
      const sibling = state.document.canvas.shapes.find(
        (shape) => shape.id === siblingId,
      );
      if (sibling === undefined) return {};
      const next = createProjectMapShape(state.document.canvas.shapes, {
        kind: sibling.kind === "frame" ? "branch" : sibling.kind,
        parent: sibling.parent,
        x: sibling.x,
        y: sibling.y + sibling.height + PROJECT_MAP_GRID * 2,
      });
      const edited = editCanvas(state, (canvas) => ({
        ...showingAuthored(canvas),
        shapes: [...canvas.shapes, next],
      }));
      return {
        ...edited,
        selection: [next.id],
        focused: next.id,
        editingShape: next.id,
      };
    }),

  /**
   * Arranges the drawn layer.
   *
   * Scope is the selection when there is one: "arrange" with nothing chosen
   * should not rearrange a diagram someone else laid out by hand. Pinned and
   * anchored shapes are left where they are by the layout itself.
   */
  runLayout: (kind) =>
    set((state) => {
      if (state.document === null) return {};
      const { canvas } = state.document;
      const selected = new Set(state.selection);
      const scoped =
        selected.size > 0
          ? canvas.shapes.filter((shape) => selected.has(shape.id))
          : canvas.shapes;
      const fixed = canvas.shapes.filter(
        (shape) => shape.pinned || shape.anchor !== null,
      );
      const clearOf = shapesBounds(fixed);
      const origin = clearOf
        ? { x: clearOf.x + clearOf.width + PROJECT_MAP_GRID * 4, y: clearOf.y }
        : { x: 0, y: 0 };
      const positions = layoutProjectMapShapes(scoped, {
        kind,
        origin,
        connectors: canvas.connectors,
      });
      return editCanvas(state, (current) => ({
        ...current,
        view: { ...current.view, layout: kind },
        shapes: current.shapes.map((shape) => {
          const position = positions.get(shape.id);
          if (position === undefined) return shape;
          return { ...shape, x: snap(position.x), y: snap(position.y) };
        }),
      }));
    }),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (previous === undefined || state.document === null) return {};
      return {
        document: previous,
        past: state.past.slice(0, -1),
        // Defensive and, as things stand, unreachable: `past` is capped at
        // the same limit and `undo` is the only thing that pushes here, so
        // `future` can never be longer than the number of steps there were
        // to undo. Kept rather than removed because it is the invariant, not
        // a consequence somebody should have to re-derive — and said out
        // loud so nobody writes a test for it that cannot fail.
        future: [state.document, ...state.future].slice(
          0,
          PROJECT_MAP_HISTORY_LIMIT,
        ),
        dirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (next === undefined || state.document === null) return {};
      return {
        document: next,
        past: [...state.past, state.document].slice(-PROJECT_MAP_HISTORY_LIMIT),
        future: rest,
        dirty: true,
      };
    }),

  setViewport: (viewport) =>
    set({
      viewport: {
        ...viewport,
        scale: Math.min(
          PROJECT_MAP_MAX_SCALE,
          Math.max(PROJECT_MAP_MIN_SCALE, viewport.scale),
        ),
      },
    }),
}));
