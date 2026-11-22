/**
 * Which repository the `/map` page is looking at, per backend.
 *
 * The map is a picture of a repository, so the page has to know which one.
 * Before this it did not: it read the backend's own working directory — on a
 * development stack, a folder of automation runs — and the only way to point
 * it anywhere else was to generate a map inside a sandbox and follow that
 * conversation around. The choice lives here so it survives a reload and so
 * the page, which owns it, has one place to write it.
 *
 * Per backend because a path belongs to a machine: the folder that holds a
 * repository on one host does not exist on another. Per backend *and* per
 * folder for the conversation, because switching from one repository to a
 * second and back should find the chat about the first still there — its
 * sandbox is still mounted on that folder and still remembers what was said.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ProjectMapWorkspaceSelection {
  /**
   * Absolute path of the chosen folder on the backend's host, or null for the
   * backend's own working directory — the page's behaviour before a choice.
   */
  path: string | null;
  /** The conversation bound to each folder, keyed by {@link workspaceKey}. */
  conversationByWorkspace: Record<string, string>;
}

interface ProjectMapWorkspaceState {
  selectionByBackendId: Record<string, ProjectMapWorkspaceSelection>;
}

interface ProjectMapWorkspaceActions {
  /** Point the page at a folder, or back at the backend's own directory. */
  chooseWorkspace: (backendId: string, path: string | null) => void;
  /** Remember (or, with null, forget) the conversation working in a folder. */
  bindConversation: (
    backendId: string,
    path: string | null,
    conversationId: string | null,
  ) => void;
}

export type ProjectMapWorkspaceStore = ProjectMapWorkspaceState &
  ProjectMapWorkspaceActions;

export const EMPTY_PROJECT_MAP_WORKSPACE_SELECTION: ProjectMapWorkspaceSelection =
  {
    path: null,
    conversationByWorkspace: {},
  };

/**
 * The record key for a folder. The backend's own working directory has no
 * path of its own here, so it is keyed by the empty string.
 */
function workspaceKey(path: string | null): string {
  return path ?? "";
}

export function selectionForBackend(
  state: ProjectMapWorkspaceState,
  backendId: string,
): ProjectMapWorkspaceSelection {
  return (
    state.selectionByBackendId[backendId] ??
    EMPTY_PROJECT_MAP_WORKSPACE_SELECTION
  );
}

/** The conversation bound to a folder of this selection, if any. */
export function boundConversationFor(
  selection: ProjectMapWorkspaceSelection,
  path: string | null,
): string | null {
  return selection.conversationByWorkspace[workspaceKey(path)] ?? null;
}

export const useProjectMapWorkspaceStore = create<ProjectMapWorkspaceStore>()(
  persist(
    (set) => ({
      selectionByBackendId: {},

      chooseWorkspace: (backendId, path) =>
        set((state) => ({
          selectionByBackendId: {
            ...state.selectionByBackendId,
            [backendId]: {
              ...selectionForBackend(state, backendId),
              path,
            },
          },
        })),

      bindConversation: (backendId, path, conversationId) =>
        set((state) => {
          const current = selectionForBackend(state, backendId);
          const conversationByWorkspace = {
            ...current.conversationByWorkspace,
          };
          if (conversationId === null) {
            delete conversationByWorkspace[workspaceKey(path)];
          } else {
            conversationByWorkspace[workspaceKey(path)] = conversationId;
          }
          return {
            selectionByBackendId: {
              ...state.selectionByBackendId,
              [backendId]: { ...current, conversationByWorkspace },
            },
          };
        }),
    }),
    {
      name: "project-map-workspace",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
