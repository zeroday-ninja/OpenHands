/**
 * Where the drawers are. Kept apart from the document store because this is
 * about this browser, not about the project: a closed panel should stay closed
 * on the next visit and should not travel with the file.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface WorkbenchLayoutState {
  leftOpen: boolean;
  rightOpen: boolean;
}

interface WorkbenchLayoutActions {
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

export const WORKBENCH_LAYOUT_STORAGE_KEY = "openhands-workbench-layout";

export const useWorkbenchLayoutStore = create<
  WorkbenchLayoutState & WorkbenchLayoutActions
>()(
  persist(
    (set) => ({
      leftOpen: true,
      rightOpen: true,
      setLeftOpen: (leftOpen) => set({ leftOpen }),
      setRightOpen: (rightOpen) => set({ rightOpen }),
      toggleLeft: () => set((state) => ({ leftOpen: !state.leftOpen })),
      toggleRight: () => set((state) => ({ rightOpen: !state.rightOpen })),
    }),
    {
      name: WORKBENCH_LAYOUT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): WorkbenchLayoutState => ({
        leftOpen: state.leftOpen,
        rightOpen: state.rightOpen,
      }),
    },
  ),
);
