/**
 * The open workbench: the editor buffer over `.openhands/workbench.json`, the
 * selection, the viewport, and the undo history.
 *
 * The file is owned by `useWorkbench`; this store owns the working copy, the
 * way an editor owns unsaved text. Every edit goes through `commit`, which
 * snapshots the document first, so undo and redo are the same operation for a
 * moved part, a deleted sprint or a re-planned board. The selection and the
 * viewport are not part of the history: undoing a move should not also move
 * the camera.
 *
 * One owner, one writer: components read from here and call these actions;
 * nothing else mutates the document.
 */

import { create } from "zustand";
import {
  WORKBENCH_STAGES,
  type WorkbenchAccent,
  type WorkbenchDocument,
  type WorkbenchEpic,
  type WorkbenchHighlight,
  type WorkbenchLevel,
  type WorkbenchMode,
  type WorkbenchPart,
  type WorkbenchPartKind,
  type WorkbenchPersona,
  type WorkbenchPoint,
  type WorkbenchRepo,
  type WorkbenchStage,
  type WorkbenchTool,
  type WorkbenchWireLabel,
  type WorkbenchWorkItem,
  type WorkbenchItemType,
  type WorkbenchRoleId,
} from "#/types/workbench";
import {
  nextPartSlot,
  snap,
  type WorkbenchViewport,
} from "#/utils/workbench/workbench-geometry";
import {
  activeSprint,
  nextKey,
  planSprint,
  plannedSprint,
  splitStory,
} from "#/utils/workbench/workbench-planning";

export const WORKBENCH_UNDO_LIMIT = 100;

export interface WorkbenchSelection {
  partIds: string[];
  wireId: string | null;
  highlightId: string | null;
  itemId: string | null;
}

const EMPTY_SELECTION: WorkbenchSelection = {
  partIds: [],
  wireId: null,
  highlightId: null,
  itemId: null,
};

export interface WorkbenchOverlays {
  agents: boolean;
  changes: boolean;
  tests: boolean;
  drift: boolean;
}

interface WorkbenchState {
  /** Fingerprint of the file revision the buffer came from. */
  source: string | null;
  document: WorkbenchDocument | null;
  /** True once the buffer differs from the file. */
  dirty: boolean;
  past: WorkbenchDocument[];
  future: WorkbenchDocument[];
  selection: WorkbenchSelection;
  mode: WorkbenchMode;
  tool: WorkbenchTool;
  level: WorkbenchLevel;
  overlays: WorkbenchOverlays;
  viewport: WorkbenchViewport;
  persona: WorkbenchPersona;
  autopilot: boolean;
  /** Repo whose frame a drag is over, for the drop ring. */
  dropRepoId: string | null;
  /** Which part a hovered agent's trail belongs to. */
  hoverAgentId: string | null;
  /** The sprint tab the board is showing. */
  boardSprintId: string | null;
  boardEpicId: string | null;
}

interface WorkbenchActions {
  hydrate: (source: string, document: WorkbenchDocument) => void;
  markSaved: () => void;
  /** Replace the document as one undoable step. */
  commit: (edit: (document: WorkbenchDocument) => WorkbenchDocument) => void;
  undo: () => void;
  redo: () => void;

  setSelection: (selection: Partial<WorkbenchSelection>) => void;
  togglePart: (partId: string) => void;
  clearSelection: () => void;
  setMode: (mode: WorkbenchMode) => void;
  setTool: (tool: WorkbenchTool) => void;
  setLevel: (level: WorkbenchLevel) => void;
  toggleOverlay: (overlay: keyof WorkbenchOverlays) => void;
  setViewport: (viewport: WorkbenchViewport) => void;
  setPersona: (persona: WorkbenchPersona) => void;
  setAutopilot: (on: boolean) => void;
  setDropRepo: (repoId: string | null) => void;
  setHoverAgent: (agentId: string | null) => void;
  setBoardSprint: (sprintId: string | null) => void;
  setBoardEpic: (epicId: string | null) => void;

  // Design
  moveParts: (moves: { id: string; x: number; y: number }[]) => void;
  moveRepo: (repoId: string, x: number, y: number) => void;
  addPart: (
    repoId: string,
    kind: WorkbenchPartKind,
    name: string,
    at?: WorkbenchPoint,
  ) => string;
  renamePart: (partId: string, name: string) => void;
  setPartStatus: (partId: string, status: WorkbenchPart["status"]) => void;
  movePartToRepo: (partId: string, repoId: string, at?: WorkbenchPoint) => void;
  deleteParts: (partIds: string[]) => void;
  addWire: (from: string, to: string, label?: WorkbenchWireLabel) => void;
  setWireLabel: (wireId: string, label: WorkbenchWireLabel) => void;
  deleteWire: (wireId: string) => void;
  addHighlight: (points: WorkbenchPoint[]) => void;
  deleteHighlight: (highlightId: string) => void;
  clearHighlights: () => void;
  addRepoToProject: (projectId: string, repoId: string) => void;
  removeRepoFromProject: (projectId: string, repoId: string) => void;
  addRepo: (
    repo: Omit<WorkbenchRepo, "accent"> & { accent?: WorkbenchAccent },
  ) => void;
  renameRepo: (repoId: string, name: string) => void;
  addProject: (name: string, repoIds: string[]) => string;
  deleteSelection: () => void;

  // Work
  addItem: (item: {
    title: string;
    type?: WorkbenchItemType;
    epicId?: string;
    sprintId?: string | null;
    points?: number;
    partId?: string | null;
    role?: WorkbenchRoleId | null;
    note?: string;
  }) => string | null;
  moveItemToStage: (itemId: string, stage: WorkbenchStage) => void;
  moveItemToSprint: (itemId: string, sprintId: string | null) => void;
  renameItem: (itemId: string, title: string) => void;
  setItemPoints: (itemId: string, points: number) => void;
  setItemEpic: (itemId: string, epicId: string) => void;
  deleteItem: (itemId: string) => void;
  splitItem: (itemId: string) => void;
  addEpic: (title: string, key: string, goal?: string) => string;
  renameEpic: (epicId: string, title: string) => void;
  deleteEpic: (epicId: string) => void;
  addSprint: (dates?: string) => string;
  planSprint: (sprintId: string) => number;
  startSprint: (sprintId: string) => void;
  endSprint: (sprintId: string) => void;
  setSprintGoal: (sprintId: string, goal: string) => void;
  deleteSprint: (sprintId: string) => void;
}

export type WorkbenchStore = WorkbenchState & WorkbenchActions;

let counter = 0;
export function newWorkbenchId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`;
}

function uniq<T>(list: T[]) {
  return Array.from(new Set(list));
}

function withoutParts(
  document: WorkbenchDocument,
  partIds: string[],
): WorkbenchDocument {
  const gone = new Set(partIds);
  return {
    ...document,
    parts: document.parts.filter((part) => !gone.has(part.id)),
    wires: document.wires.filter(
      (wire) => !gone.has(wire.from) && !gone.has(wire.to),
    ),
    agents: document.agents.map((agent) => ({
      ...agent,
      focus: agent.focus !== null && gone.has(agent.focus) ? null : agent.focus,
      trail: agent.trail.filter((id) => !gone.has(id)),
      targets: agent.targets.filter((id) => !gone.has(id)),
    })),
    work: document.work.map((item) =>
      item.partId !== null && gone.has(item.partId)
        ? { ...item, partId: null }
        : item,
    ),
  };
}

function nextAccent(used: WorkbenchAccent[]): WorkbenchAccent {
  for (const candidate of [1, 2, 3, 4, 5, 6] as WorkbenchAccent[]) {
    if (!used.includes(candidate)) return candidate;
  }
  return ((used.length % 6) + 1) as WorkbenchAccent;
}

export const useWorkbenchStore = create<WorkbenchStore>()((set, get) => {
  const commit: WorkbenchActions["commit"] = (edit) => {
    const { document, past } = get();
    if (document === null) return;
    const next = edit(document);
    if (next === document) return;
    set({
      document: next,
      dirty: true,
      past: [...past.slice(-(WORKBENCH_UNDO_LIMIT - 1)), document],
      future: [],
    });
  };

  const update = (edit: (document: WorkbenchDocument) => WorkbenchDocument) =>
    commit(edit);

  return {
    source: null,
    document: null,
    dirty: false,
    past: [],
    future: [],
    selection: EMPTY_SELECTION,
    mode: "design",
    tool: "select",
    level: "parts",
    overlays: { agents: true, changes: false, tests: false, drift: false },
    viewport: { x: 0, y: 0, k: 1 },
    persona: "arch",
    autopilot: true,
    dropRepoId: null,
    hoverAgentId: null,
    boardSprintId: null,
    boardEpicId: null,

    hydrate: (source, document) => {
      if (get().source === source) return;
      set({
        source,
        document,
        dirty: false,
        past: [],
        future: [],
        selection: EMPTY_SELECTION,
        boardSprintId:
          activeSprint(document)?.id ?? document.sprints[0]?.id ?? null,
      });
    },
    markSaved: () => set({ dirty: false }),
    commit,
    undo: () => {
      const { past, future, document } = get();
      if (document === null || past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        document: previous,
        past: past.slice(0, -1),
        future: [document, ...future],
        dirty: true,
        selection: EMPTY_SELECTION,
      });
    },
    redo: () => {
      const { past, future, document } = get();
      if (document === null || future.length === 0) return;
      const [next, ...rest] = future;
      set({
        document: next,
        past: [...past, document],
        future: rest,
        dirty: true,
      });
    },

    setSelection: (selection) =>
      set((state) => ({
        selection: {
          ...EMPTY_SELECTION,
          ...selection,
          ...(selection.partIds ? { partIds: uniq(selection.partIds) } : {}),
        },
        hoverAgentId: state.hoverAgentId,
      })),
    togglePart: (partId) =>
      set((state) => {
        const has = state.selection.partIds.includes(partId);
        return {
          selection: {
            ...EMPTY_SELECTION,
            partIds: has
              ? state.selection.partIds.filter((id) => id !== partId)
              : [...state.selection.partIds, partId],
          },
        };
      }),
    clearSelection: () => set({ selection: EMPTY_SELECTION }),
    setMode: (mode) => set({ mode }),
    setTool: (tool) => set({ tool }),
    setLevel: (level) => set({ level }),
    toggleOverlay: (overlay) =>
      set((state) => ({
        overlays: { ...state.overlays, [overlay]: !state.overlays[overlay] },
      })),
    setViewport: (viewport) => set({ viewport }),
    setPersona: (persona) => set({ persona }),
    setAutopilot: (autopilot) => set({ autopilot }),
    setDropRepo: (dropRepoId) => set({ dropRepoId }),
    setHoverAgent: (hoverAgentId) => set({ hoverAgentId }),
    setBoardSprint: (boardSprintId) => set({ boardSprintId }),
    setBoardEpic: (boardEpicId) => set({ boardEpicId }),

    moveParts: (moves) =>
      update((document) => {
        const byId = new Map(moves.map((move) => [move.id, move]));
        return {
          ...document,
          parts: document.parts.map((part) => {
            const move = byId.get(part.id);
            return move ? { ...part, x: snap(move.x), y: snap(move.y) } : part;
          }),
        };
      }),
    moveRepo: (repoId, x, y) =>
      update((document) => ({
        ...document,
        repos: document.repos.map((repo) =>
          repo.id === repoId ? { ...repo, x: snap(x), y: snap(y) } : repo,
        ),
      })),
    addPart: (repoId, kind, name, at) => {
      const id = newWorkbenchId("part");
      update((document) => {
        const slot = at ?? nextPartSlot(document, repoId);
        return {
          ...document,
          parts: [
            ...document.parts,
            {
              id,
              repoId,
              kind,
              name,
              x: snap(slot.x),
              y: snap(slot.y),
              status: "planned",
              files: [],
              tests: null,
              changes: 0,
            },
          ],
        };
      });
      return id;
    },
    renamePart: (partId, name) =>
      update((document) => ({
        ...document,
        parts: document.parts.map((part) =>
          part.id === partId ? { ...part, name } : part,
        ),
      })),
    setPartStatus: (partId, status) =>
      update((document) => ({
        ...document,
        parts: document.parts.map((part) =>
          part.id === partId ? { ...part, status } : part,
        ),
      })),
    movePartToRepo: (partId, repoId, at) =>
      update((document) => {
        const slot = at ?? nextPartSlot(document, repoId);
        return {
          ...document,
          parts: document.parts.map((part) =>
            part.id === partId
              ? { ...part, repoId, x: snap(slot.x), y: snap(slot.y) }
              : part,
          ),
        };
      }),
    deleteParts: (partIds) => {
      update((document) => withoutParts(document, partIds));
      set((state) => ({
        selection: {
          ...state.selection,
          partIds: state.selection.partIds.filter(
            (id) => !partIds.includes(id),
          ),
        },
      }));
    },
    addWire: (from, to, label = "planned") =>
      update((document) => {
        if (from === to) return document;
        if (document.wires.some((wire) => wire.from === from && wire.to === to))
          return document;
        return {
          ...document,
          wires: [...document.wires, { id: `${from}->${to}`, from, to, label }],
        };
      }),
    setWireLabel: (wireId, label) =>
      update((document) => ({
        ...document,
        wires: document.wires.map((wire) =>
          wire.id === wireId ? { ...wire, label } : wire,
        ),
      })),
    deleteWire: (wireId) => {
      update((document) => ({
        ...document,
        wires: document.wires.filter((wire) => wire.id !== wireId),
      }));
      set((state) => ({
        selection: {
          ...state.selection,
          wireId:
            state.selection.wireId === wireId ? null : state.selection.wireId,
        },
      }));
    },
    addHighlight: (points) =>
      update((document) => ({
        ...document,
        highlights: [
          ...document.highlights,
          { id: newWorkbenchId("hl"), points } satisfies WorkbenchHighlight,
        ],
      })),
    deleteHighlight: (highlightId) => {
      update((document) => ({
        ...document,
        highlights: document.highlights.filter((h) => h.id !== highlightId),
      }));
      set((state) => ({
        selection: { ...state.selection, highlightId: null },
      }));
    },
    clearHighlights: () =>
      update((document) => ({ ...document, highlights: [] })),
    addRepoToProject: (projectId, repoId) =>
      update((document) => ({
        ...document,
        projects: document.projects.map((project) =>
          project.id === projectId && !project.repoIds.includes(repoId)
            ? { ...project, repoIds: [...project.repoIds, repoId] }
            : project,
        ),
      })),
    removeRepoFromProject: (projectId, repoId) =>
      update((document) => ({
        ...document,
        projects: document.projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                repoIds: project.repoIds.filter((id) => id !== repoId),
              }
            : project,
        ),
      })),
    addRepo: (repo) =>
      update((document) => ({
        ...document,
        repos: [
          ...document.repos,
          {
            ...repo,
            accent:
              repo.accent ?? nextAccent(document.repos.map((r) => r.accent)),
          },
        ],
      })),
    renameRepo: (repoId, name) =>
      update((document) => ({
        ...document,
        repos: document.repos.map((repo) =>
          repo.id === repoId ? { ...repo, name } : repo,
        ),
      })),
    addProject: (name, repoIds) => {
      const id = newWorkbenchId("project");
      update((document) => ({
        ...document,
        projects: [...document.projects, { id, name, repoIds }],
      }));
      return id;
    },
    deleteSelection: () => {
      const { selection } = get();
      if (selection.partIds.length > 0) get().deleteParts(selection.partIds);
      if (selection.wireId) get().deleteWire(selection.wireId);
      if (selection.highlightId) get().deleteHighlight(selection.highlightId);
      if (selection.itemId) get().deleteItem(selection.itemId);
    },

    addItem: (input) => {
      const { document } = get();
      if (document === null) return null;
      const epic =
        document.epics.find((e) => e.id === input.epicId) ?? document.epics[0];
      if (!epic) return null;
      const id = newWorkbenchId("story");
      update((doc) => {
        const issued = nextKey(epic);
        const sprint =
          input.sprintId !== undefined
            ? input.sprintId
            : (activeSprint(doc)?.id ?? null);
        const item: WorkbenchWorkItem = {
          id,
          key: issued.key,
          type: input.type ?? "story",
          title: input.title,
          epicId: epic.id,
          sprintId: sprint,
          points: input.points ?? 2,
          partId: input.partId ?? null,
          stage: "backlog",
          role: input.role ?? null,
          ...(input.note ? { note: input.note } : {}),
        };
        return {
          ...doc,
          epics: doc.epics.map((e) =>
            e.id === epic.id ? { ...e, counter: issued.counter } : e,
          ),
          work: [...doc.work, item],
        };
      });
      return id;
    },
    moveItemToStage: (itemId, stage) =>
      update((document) => ({
        ...document,
        work: document.work.map((item) =>
          item.id === itemId
            ? {
                ...item,
                stage,
                ...(stage === "done"
                  ? { percent: 100, blocked: undefined }
                  : {}),
              }
            : item,
        ),
      })),
    moveItemToSprint: (itemId, sprintId) =>
      update((document) => ({
        ...document,
        work: document.work.map((item) =>
          item.id === itemId ? { ...item, sprintId } : item,
        ),
      })),
    renameItem: (itemId, title) =>
      update((document) => ({
        ...document,
        work: document.work.map((item) =>
          item.id === itemId ? { ...item, title } : item,
        ),
      })),
    setItemPoints: (itemId, points) =>
      update((document) => ({
        ...document,
        work: document.work.map((item) =>
          item.id === itemId ? { ...item, points: Math.max(1, points) } : item,
        ),
      })),
    setItemEpic: (itemId, epicId) =>
      update((document) => ({
        ...document,
        work: document.work.map((item) =>
          item.id === itemId ? { ...item, epicId } : item,
        ),
      })),
    deleteItem: (itemId) => {
      update((document) => ({
        ...document,
        work: document.work.filter((item) => item.id !== itemId),
      }));
      set((state) => ({
        selection: {
          ...state.selection,
          itemId:
            state.selection.itemId === itemId ? null : state.selection.itemId,
        },
      }));
    },
    splitItem: (itemId) =>
      update((document) => {
        const item = document.work.find((w) => w.id === itemId);
        const epic = item && document.epics.find((e) => e.id === item.epicId);
        if (!item || !epic) return document;
        let { counter: issued } = epic;
        const pieces = splitStory(item).map((piece) => {
          issued += 1;
          return {
            ...item,
            id: newWorkbenchId("story"),
            key: `${epic.key}-${issued}`,
            title: piece.title,
            points: piece.points,
            percent: undefined,
            note: undefined,
          } satisfies WorkbenchWorkItem;
        });
        return {
          ...document,
          epics: document.epics.map((e) =>
            e.id === epic.id ? { ...e, counter: issued } : e,
          ),
          work: document.work.flatMap((w) => (w.id === itemId ? pieces : [w])),
        };
      }),
    addEpic: (title, key, goal = "") => {
      const id = newWorkbenchId("epic");
      update((document) => ({
        ...document,
        epics: [
          ...document.epics,
          {
            id,
            key,
            title,
            goal,
            counter: 0,
            accent: nextAccent(document.epics.map((e) => e.accent)),
          } satisfies WorkbenchEpic,
        ],
      }));
      return id;
    },
    renameEpic: (epicId, title) =>
      update((document) => ({
        ...document,
        epics: document.epics.map((epic) =>
          epic.id === epicId ? { ...epic, title } : epic,
        ),
      })),
    deleteEpic: (epicId) => {
      update((document) => {
        const fallback = document.epics.find((epic) => epic.id !== epicId);
        return {
          ...document,
          epics: document.epics.filter((epic) => epic.id !== epicId),
          work: fallback
            ? document.work.map((item) =>
                item.epicId === epicId
                  ? { ...item, epicId: fallback.id }
                  : item,
              )
            : document.work.filter((item) => item.epicId !== epicId),
        };
      });
      set((state) => ({
        boardEpicId: state.boardEpicId === epicId ? null : state.boardEpicId,
      }));
    },
    addSprint: (dates = "") => {
      const id = newWorkbenchId("sprint");
      update((document) => {
        const last = document.sprints[document.sprints.length - 1];
        return {
          ...document,
          sprints: [
            ...document.sprints,
            {
              id,
              number: (last?.number ?? 0) + 1,
              dates,
              state: "planned",
              goal: "",
              days: 10,
              day: 0,
              burndown: [],
            },
          ],
        };
      });
      return id;
    },
    planSprint: (sprintId) => {
      let moved = 0;
      update((document) => {
        const sprint = document.sprints.find((s) => s.id === sprintId);
        if (!sprint) return document;
        const picked = planSprint(document, sprint);
        moved = picked.length;
        if (picked.length === 0) return document;
        return {
          ...document,
          work: document.work.map((item) =>
            picked.includes(item.id) ? { ...item, sprintId } : item,
          ),
        };
      });
      return moved;
    },
    startSprint: (sprintId) =>
      update((document) => ({
        ...document,
        sprints: document.sprints.map((sprint) => {
          if (sprint.id === sprintId)
            return { ...sprint, state: "active", day: 0, burndown: [] };
          return sprint.state === "active"
            ? { ...sprint, state: "closed", day: sprint.days }
            : sprint;
        }),
      })),
    endSprint: (sprintId) =>
      update((document) => {
        const next = plannedSprint(document);
        const done = document.work.filter(
          (w) => w.sprintId === sprintId && w.stage === "done",
        );
        const left = document.work.filter(
          (w) => w.sprintId === sprintId && w.stage !== "done",
        );
        const donePts = done.reduce((s, w) => s + w.points, 0);
        const total = donePts + left.reduce((s, w) => s + w.points, 0);
        return {
          ...document,
          velocity:
            donePts > 0
              ? Math.round((document.velocity + donePts) / 2)
              : document.velocity,
          sprints: document.sprints.map((sprint) => {
            if (sprint.id === sprintId) {
              return {
                ...sprint,
                state: "closed",
                day: sprint.days,
                review: `${donePts} of ${total} points done${left.length > 0 ? `; ${left.length} carried over` : ""}.`,
              };
            }
            if (sprint.id === next?.id) return { ...sprint, state: "active" };
            return sprint;
          }),
          work: document.work.map((item) =>
            item.sprintId === sprintId && item.stage !== "done"
              ? { ...item, sprintId: next?.id ?? null }
              : item,
          ),
        };
      }),
    setSprintGoal: (sprintId, goal) =>
      update((document) => ({
        ...document,
        sprints: document.sprints.map((sprint) =>
          sprint.id === sprintId ? { ...sprint, goal } : sprint,
        ),
      })),
    deleteSprint: (sprintId) => {
      update((document) => ({
        ...document,
        sprints: document.sprints.filter((sprint) => sprint.id !== sprintId),
        work: document.work.map((item) =>
          item.sprintId === sprintId ? { ...item, sprintId: null } : item,
        ),
      }));
      set((state) => ({
        boardSprintId:
          state.boardSprintId === sprintId ? null : state.boardSprintId,
      }));
    },
  };
});

/** Items on the board, in lane order. */
export function laneOrder(stage: WorkbenchStage) {
  return WORKBENCH_STAGES.indexOf(stage);
}
