import { ForceLayout, type Node, type Edge, type ForceOptions } from "./layout";

export type LayoutRequest = {
  type: "layout";
  id: string; // combo id
  nodes: Node[];
  edges: Edge[];
  options?: ForceOptions;
  iterations?: number;
};

export type LayoutResponse = {
  type: "layout-result";
  id: string;
  nodes: { id: string; x: number; y: number }[];
};

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { type, id, nodes, edges, options, iterations = 300 } = e.data;

  if (type === "layout") {
    const layout = new ForceLayout(nodes, edges, options);
    layout.runSteps(iterations);

    const positions = layout.getPositions();
    
    self.postMessage({
      type: "layout-result",
      id,
      nodes: positions,
    } as LayoutResponse);
  }
};
