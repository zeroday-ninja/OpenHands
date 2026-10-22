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
  ProjectMapNote,
} from "#/types/project-map";
import {
  PROJECT_MAP_GRID,
  projectMapGroupAtPoint,
  projectMapNodeSize,
} from "#/utils/project-map/project-map-layout";
import { mergeProjectMap } from "#/utils/project-map/merge-project-map";

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
  viewport: ProjectMapViewport;
  /** Hidden nodes are drawn, faint, while this is on, so they can be restored. */
  showHidden: boolean;

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

  addNote: (note: ProjectMapNote) => void;
  updateNote: (id: string, text: string) => void;
  removeNote: (id: string) => void;
  setEditingNote: (id: string | null) => void;

  setViewport: (viewport: ProjectMapViewport) => void;
}

function snap(value: number): number {
  return Math.round(value / PROJECT_MAP_GRID) * PROJECT_MAP_GRID;
}

function center(node: PlacedProjectMapNode): { x: number; y: number } {
  const { width, height } = projectMapNodeSize(node.size);
  return { x: node.x + width / 2, y: node.y + height / 2 };
}

/** Applies a change to the buffer and records that it now differs from disk. */
function edit(
  state: ProjectMapState,
  change: (document: PlacedProjectMapDocument) => PlacedProjectMapDocument,
): Partial<ProjectMapState> {
  if (state.document === null) return {};
  return { document: change(state.document), dirty: true };
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
  dirty: false,
  selection: [],
  focused: null,
  editingNote: null,
  viewport: INITIAL_VIEWPORT,
  showHidden: false,

  hydrate: (source, incoming) =>
    set((state) => {
      if (state.source === source) return {};
      // A new revision arriving on top of unsaved edits is the regeneration
      // case: the agent rewrote the file while the user still had moves in
      // hand. The merge replays those decisions onto the new analysis, so a
      // regeneration costs nobody their arrangement even when it was never
      // saved. The analysis prompt asks the agent to preserve the same
      // fields; this is the half of that contract Canvas can enforce itself.
      const document =
        state.document !== null && state.dirty
          ? mergeProjectMap(state.document, incoming).document
          : incoming;
      const ids = new Set(document.nodes.map((node) => node.id));
      const noteIds = new Set(document.notes.map((note) => note.id));
      return {
        source,
        document,
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
      };
    }),

  reset: () =>
    set({
      source: null,
      document: null,
      dirty: false,
      selection: [],
      focused: null,
      editingNote: null,
      viewport: INITIAL_VIEWPORT,
      showHidden: false,
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
