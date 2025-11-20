import { useEffect, useState } from "react";
import type { LabelData } from "./label";
import type Konva from "konva";

type useGraphProps = {
  nodes?: NodeData[];
  edges?: EdgeData[];
  combos?: ComboData[];
};

export type GraphDataCallbackParams =
  | { type: "new-nodes" }
  | { type: "new-edges" }
  | { type: "new-combos" }
  | { type: "combo-collapsed"; id: string }
  | { type: "combo-drag-move"; id: string; edgeIds: string[] }
  | { type: "combo-radius-change"; id: string; edgeIds: string[] };

export type GraphDataCallback = (params: GraphDataCallbackParams) => void;

export interface GraphItem {
  x?: number;
  y?: number;
}

export interface PointData extends GraphItem {
  radius?: number;
  label?: LabelData;
}

export interface NodeData extends PointData {
  id: string;
  radius?: number;
}

export type EdgeData = {
  id: string;
  source: string;
  target: string;
};

export interface ComboData extends PointData {
  id: string;
  collapsed?: boolean;
  collapsedRadius: number;
  expandedRadius: number;
}

export interface NodeGraphData extends NodeData {
  x: number;
  y: number;
  radius: number;
}
export interface EdgeGraphData extends Partial<GraphItem>, EdgeData {
  points: number[];
}
export interface ComboGraphData extends ComboData {
  x: number;
  y: number;
  radius: number;
}

export class GraphData {
  private nodes: Map<string, NodeGraphData> = new Map();
  private edges: Map<string, EdgeGraphData> = new Map();
  private combos: Map<string, ComboGraphData> = new Map();

  private callback: Record<string, GraphDataCallback> = {};

  private edgeToCreate: EdgeData[] = [];
  private edgeIds: Record<string, Set<string>> = {};

  constructor(nodes: NodeData[], edges: EdgeData[], combos: ComboData[]) {
    this.addNodes(nodes);
    this.addCombos(combos);
    // console.log("combos", this.nodes, this.combos, combos);
    this.addEdges(edges);
  }

  public bind(cb: GraphDataCallback) {
    const id = crypto.randomUUID();
    this.callback[id] = cb;
    return id;
  }

  public unbind(id: string) {
    delete this.callback[id];
  }

  private trigger(data: GraphDataCallbackParams) {
    for (const cb of Object.values(this.callback)) {
      cb(data);
    }
  }

  private getConnectorPoints = (
    from: NodeGraphData | ComboGraphData,
    to: NodeGraphData | ComboGraphData
  ) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(-dy, dx);

    return [
      from.x + -from.radius * Math.cos(angle + Math.PI),
      from.y + from.radius * Math.sin(angle + Math.PI),
      to.x + -to.radius * Math.cos(angle),
      to.y + to.radius * Math.sin(angle),
    ];
  };

  public addNodes(nodes: NodeData[]) {
    this.nodes.clear();
    for (const n of nodes) {
      this.nodes.set(n.id, {
        ...n,
        radius: n.radius ?? 20,
        x: Math.random() * 100,
        y: Math.random() * 100,
      });
    }

    this.createEdges();

    this.trigger({ type: "new-nodes" });
  }

  private addEdgeId(src: string, target: string) {
    if (this.edgeIds[src] == null) {
      this.edgeIds[src] = new Set();
    }
    if (this.edgeIds[target] == null) {
      this.edgeIds[target] = new Set();
    }

    this.edgeIds[src].add(target);
    this.edgeIds[target].add(src);
  }

  private getPointId(id: string) {
    return this.nodes.get(id) ?? this.combos.get(id);
  }

  private createEdges() {
    const newEdgesToCreate: EdgeData[] = [];
    for (const e of this.edgeToCreate) {
      const srcNode = this.getPointId(e.source);
      const targetNode = this.getPointId(e.target);

      if (srcNode == null || targetNode == null) {
        newEdgesToCreate.push(e);
        continue;
      }

      this.addEdgeId(e.source, e.target);

      const points = this.getConnectorPoints(srcNode, targetNode);

      this.edges.set(e.id, {
        ...e,
        points,
      });
    }

    this.edgeToCreate = newEdgesToCreate;
  }

  public addEdges(edges: EdgeData[]) {
    this.edges.clear();
    for (const e of edges) {
      const srcNode = this.nodes.get(e.source) ?? this.combos.get(e.source);
      const targetNode = this.nodes.get(e.target) ?? this.combos.get(e.target);

      if (srcNode == null || targetNode == null) {
        this.edgeToCreate.push(e);
        continue;
      }

      this.addEdgeId(e.source, e.target);

      const points = this.getConnectorPoints(srcNode, targetNode);

      this.edges.set(e.id, {
        ...e,
        points,
      });
    }
    // console.log(this.edges);
    this.trigger({ type: "new-edges" });
  }

  public addCombos(combos: ComboData[]) {
    this.combos.clear();
    for (const c of combos) {
      this.combos.set(c.id, {
        ...c,
        radius: c.radius ?? 20,
        collapsedRadius: c.collapsedRadius ?? 20,
        expandedRadius: c.expandedRadius ?? 40,
        // x: 0,
        // y: 0,
        x: Math.random() * combos.length * 20,
        y: Math.random() * combos.length * 20,
      });
    }

    this.createEdges();

    this.trigger({ type: "new-combos" });
  }

  public comboCollapsed(id: string) {
    const combo = this.combos.get(id);
    if (combo == null) {
      console.error("comboCollapsed: combo not found");
      return;
    }

    combo.collapsed = !combo.collapsed;

    this.trigger({ type: "combo-collapsed", id });
  }

  public comboRadiusChange(id: string, radius: number) {
    const combo = this.combos.get(id);
    if (combo == null) {
      console.error("comboRadiusChange: combo not found");
      return;
    }

    combo.radius = radius;
    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.trigger({ type: "combo-radius-change", id, edgeIds });
  }

  private updateEdgePos(ids: string[]) {
    for (const id of ids) {
      const edge = this.edges.get(id);
      if (edge == null) continue;

      const srcNode = this.getPointId(edge.source);
      const targetNode = this.getPointId(edge.target);

      if (srcNode == null || targetNode == null) {
        this.edgeToCreate.push(edge);
        this.edges.delete(id);
        continue;
      }

      edge.points = this.getConnectorPoints(srcNode, targetNode);
    }
  }

  private getComboEdges(src: string) {
    const targetIds = this.edgeIds[src];
    if (targetIds == null) return [];

    const edges: string[] = [];
    for (const targetId of targetIds) {
      let id = `${src}-${targetId}`;
      if (this.edges.has(id)) {
        edges.push(id);
        continue;
      }

      id = `${targetId}-${src}`;
      if (this.edges.has(id)) {
        edges.push(id);
      }
    }

    return edges;
  }

  public comboDragMove(id: string, e: Konva.KonvaEventObject<DragEvent>) {
    const combo = this.combos.get(id);
    if (combo == null) {
      console.error("comboDragMove: combo not found");
      return;
    }

    combo.x = e.target.x();
    combo.y = e.target.y();

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.trigger({ type: "combo-drag-move", id, edgeIds });
  }

  public getNodes() {
    return Object.fromEntries(this.nodes);
  }

  public getEdges() {
    return Object.fromEntries(this.edges);
  }

  public getCombos() {
    return Object.fromEntries(this.combos);
  }

  public getNode(id: string) {
    return this.nodes.get(id);
  }

  public getEdge(id: string) {
    return this.edges.get(id);
  }

  public getCombo(id: string) {
    return this.combos.get(id);
  }
}

const useGraph: (option: useGraphProps) => GraphData = ({
  nodes = [],
  edges = [],
  combos = [],
}) => {
  const [data] = useState(() => new GraphData(nodes, edges, combos));

  useEffect(() => {
    data.addNodes(nodes);
  }, [nodes]);

  useEffect(() => {
    data.addEdges(edges);
  }, [edges]);

  useEffect(() => {
    data.addCombos(combos);
  }, [combos]);

  return data;
};

// const useGraph = ({ nodes = [], edges = [], combos = [] }) => {
//   const dataRef = useRef<GraphData | null>(null);

//   if (!dataRef.current) {
//     dataRef.current = new GraphData(nodes, edges, combos);
//   }

//   useEffect(() => {
//     dataRef.current!.updateNodes(nodes);
//   }, [nodes]);

//   useEffect(() => {
//     dataRef.current!.updateEdges(edges);
//   }, [edges]);

//   useEffect(() => {
//     dataRef.current!.updateCombos(combos);
//   }, [combos]);

//   return dataRef.current!;
// };

export default useGraph;
