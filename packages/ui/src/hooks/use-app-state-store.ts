import { create } from "zustand";
import type { GraphViewType } from "../../electron/types";

interface AppState {
  selectedSubProject: string | null;
  centeredItemId: string | null;
  selectedId: string | null;
  isSidebarOpen: boolean;
  activeTab: "projects" | "git";
  selectedCommit: string | null;
  isLoaded: boolean;
  viewport: { x: number; y: number; zoom: number } | null;
  view: GraphViewType;

  setSelectedSubProject: (path: string | null) => void;
  setCenteredItemId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setActiveTab: (tab: "projects" | "git") => void;
  setSelectedCommit: (commit: string | null) => void;
  setViewport: (
    viewport: { x: number; y: number; zoom: number } | null,
  ) => void;
  setView: (view: GraphViewType) => void;

  // Persistence helpers
  loadState: (projectRoot: string) => Promise<void>;
  saveState: (projectRoot: string) => Promise<void>;
  reset: () => void;
}

export const useAppStateStore = create<AppState>((set, get) => ({
  selectedSubProject: null,
  centeredItemId: null,
  selectedId: null,
  isSidebarOpen: false,
  activeTab: "projects",
  selectedCommit: null,
  isLoaded: false,
  viewport: null,
  view: "component",

  setSelectedSubProject: (path) => set({ selectedSubProject: path }),
  setCenteredItemId: (id) => set({ centeredItemId: id }),
  setSelectedId: (id) => set({ selectedId: id }),
  setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCommit: (commit) => set({ selectedCommit: commit }),
  setViewport: (viewport) => set({ viewport }),
  setView: (view) => set({ view }),

  reset: () =>
    set({
      selectedSubProject: null,
      centeredItemId: null,
      selectedId: null,
      activeTab: "projects",
      selectedCommit: null,
      viewport: null,
      isLoaded: false,
      view: "component",
    }),

  loadState: async (projectRoot: string) => {
    set({ isLoaded: false });
    const state = await window.ipcRenderer.invoke("read-state", projectRoot);
    if (state) {
      set({
        selectedSubProject: state.selectedSubProject || projectRoot,
        centeredItemId: state.centeredItemId || null,
        selectedId: state.selectedId || null,
        isSidebarOpen: state.isSidebarOpen ?? false,
        activeTab: state.activeTab || "projects",
        selectedCommit: state.selectedCommit || null,
        viewport: state.viewport || null,
        view: state.view || "component",
        isLoaded: true,
      });
    } else {
      // Default state for new project
      set({
        selectedSubProject: projectRoot,
        centeredItemId: null,
        selectedId: null,
        isSidebarOpen: false,
        activeTab: "projects",
        selectedCommit: null,
        viewport: null,
        view: "component",
        isLoaded: true,
      });
    }
  },

  saveState: async (projectRoot: string) => {
    const {
      selectedSubProject,
      centeredItemId,
      selectedId,
      isSidebarOpen,
      activeTab,
      selectedCommit,
      viewport,
      view,
      isLoaded,
    } = get();
    if (!isLoaded) return; // Don't save until we've loaded

    // Defensive check: ensure selectedSubProject is actually part of this projectRoot
    if (
      selectedSubProject &&
      selectedSubProject !== projectRoot &&
      !selectedSubProject.startsWith(projectRoot + "/") &&
      !selectedSubProject.startsWith(projectRoot + "\\")
    ) {
      console.warn(
        "Prevented saving stale subProject from different projectRoot",
        {
          selectedSubProject,
          projectRoot,
        },
      );
      return;
    }

    await window.ipcRenderer.invoke("save-state", projectRoot, {
      selectedSubProject,
      centeredItemId,
      selectedId,
      isSidebarOpen,
      activeTab,
      selectedCommit,
      viewport,
      view,
    });
  },
}));
