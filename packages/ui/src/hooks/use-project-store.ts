import { create } from "zustand";

interface ProjectState {
  projectRoot: string | null;
  setProjectRoot: (path: string | null) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>()((set) => ({
  projectRoot: null,
  setProjectRoot: (path) => set({ projectRoot: path }),
  reset: () => set({ projectRoot: null }),
}));
