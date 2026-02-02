import { create } from "zustand";

interface AppState {
  selectedSubProject: string | null;
  centeredItemId: string | null;
  selectedId: string | null;
  isSidebarOpen: boolean;
  isLoaded: boolean;
  
  setSelectedSubProject: (path: string | null) => void;
  setCenteredItemId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  
  // Persistence helpers
  loadState: (projectRoot: string) => Promise<void>;
  saveState: (projectRoot: string) => Promise<void>;
}

export const useAppStateStore = create<AppState>((set, get) => ({
  selectedSubProject: null,
  centeredItemId: null,
  selectedId: null,
  isSidebarOpen: false,
  isLoaded: false,

  setSelectedSubProject: (path) => set({ selectedSubProject: path }),
  setCenteredItemId: (id) => set({ centeredItemId: id }),
  setSelectedId: (id) => set({ selectedId: id }),
  setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),

  loadState: async (projectRoot: string) => {
    set({ isLoaded: false });
    const state = await window.ipcRenderer.invoke("read-state", projectRoot);
    if (state) {
      set({
        selectedSubProject: state.selectedSubProject || projectRoot,
        centeredItemId: state.centeredItemId || null,
        selectedId: state.selectedId || null,
        isSidebarOpen: state.isSidebarOpen ?? false,
        isLoaded: true,
      });
    } else {
      // Default state for new project
      set({
        selectedSubProject: projectRoot,
        centeredItemId: null,
        selectedId: null,
        isSidebarOpen: false,
        isLoaded: true,
      });
    }
  },

  saveState: async (projectRoot: string) => {
    const { selectedSubProject, centeredItemId, selectedId, isSidebarOpen, isLoaded } = get();
    if (!isLoaded) return; // Don't save until we've loaded

    await window.ipcRenderer.invoke("save-state", projectRoot, {
      selectedSubProject,
      centeredItemId,
      selectedId,
      isSidebarOpen,
    });
  },
}));
