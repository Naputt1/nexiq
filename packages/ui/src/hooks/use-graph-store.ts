import { create } from "zustand";
import type { GraphData } from "../graph/hook";

interface GraphStore {
  graphInstance: GraphData | null;
  setGraphInstance: (graph: GraphData | null) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  graphInstance: null,
  setGraphInstance: (graph) => set({ graphInstance: graph }),
}));
