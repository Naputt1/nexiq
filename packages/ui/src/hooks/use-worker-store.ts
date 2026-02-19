import { create } from "zustand";

export interface WorkerRegistryState {
  registry: Record<string, { id: string; priority: number }[]>;
  rendererRegistry: Record<string, { id: string; priority: number }[]>;
  lastUpdated: number;
}

interface WorkerState {
  worker: Worker | null;
  registryState: WorkerRegistryState | null;
  setWorker: (worker: Worker | null) => void;
  setRegistryState: (state: WorkerRegistryState) => void;
  refreshRegistry: () => void;
}

export const useWorkerStore = create<WorkerState>((set, get) => ({
  worker: null,
  registryState: null,
  setWorker: (worker) => set({ worker }),
  setRegistryState: (registryState) => set({ registryState }),
  refreshRegistry: () => {
    const { worker } = get();
    if (worker) {
      worker.postMessage({ type: "DEBUG_GET_REGISTRY" });
    }
  },
}));
