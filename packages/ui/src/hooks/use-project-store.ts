import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProjectState {
  projectRoot: string | null;
  _hasHydrated: boolean;
  setProjectRoot: (path: string | null) => void;
  setHasHydrated: (state: boolean) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projectRoot: null,
      _hasHydrated: false,
      setProjectRoot: (path) => set({ projectRoot: path }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      reset: () => set({ projectRoot: null }),
    }),

    {
      name: "project-storage",
      onRehydrateStorage: (_state) => {
        return (state) => state?.setHasHydrated(true);
      },
      partialize: (_state) => ({}), // Don't persist projectRoot in localStorage
    },
  ),
);
