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
          onRehydrateStorage: (state) => {
            return () => state.setHasHydrated(true);
          },
          partialize: (state) => ({ projectRoot: state.projectRoot }),
        }

    

  )

);


