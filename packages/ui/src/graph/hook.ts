import { useEffect, useState } from "react";
import type { LabelData } from "./label";
import type Konva from "konva";
import { ForceLayout, type Node, type Edge } from "./layout";

type useGraphProps = {
  nodes?: NodeData[];
  edges?: EdgeData[];
  combos?: ComboData[];
  config?: GraphDataConfig;
};

export type GraphDataCallbackParams =
  | { type: "new-nodes" }
  | { type: "new-edges" }
  | { type: "new-combos" }
  // | { type: "combo-collapsed"; id: string; child?: boolean }
  | { type: "combo-drag-move"; id: string; edgeIds: string[]; child?: boolean }
  | {
      type: "combo-radius-change";
      id: string;
      edgeIds: string[];
      child?: boolean;
    };

export type GraphDataCallback = (params: GraphDataCallbackParams) => void;

export interface GraphItem {
  x?: number;
  y?: number;
}

export interface PointData extends GraphItem {
  color?: string;
  radius?: number;
  label?: LabelData;
  combo?: string;
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
  collapsedRadius?: number;
  expandedRadius?: number;
  animation?: boolean;
}

export interface NodeGraphData extends NodeData {
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface EdgeGraphData extends Partial<GraphItem>, EdgeData {
  points: number[];
}

export interface ComboGraphDataChild {
  nodes: Record<string, NodeGraphData>;
  combos: Record<string, ComboGraphData>;
  edges: Record<string, EdgeGraphData>;
}

export interface ComboGraphData extends ComboData {
  x: number;
  y: number;
  color: string;
  radius: number;
  child?: ComboGraphDataChild;
  collapsedRadius: number;
  expandedRadius: number;
}

export interface ComboGraphDataHookBase extends Omit<ComboGraphData, "child"> {
  nodes?: Record<string, NodeGraphData>;
  edges?: Record<string, EdgeGraphData>;
  combos?: string[];
}

export interface ComboGraphDataHook extends ComboGraphDataHookBase {
  comboRadiusChange: (id: string, radius: number) => void;
  comboCollapsed: (id: string) => void;
  comboDragMove: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
}

export interface GraphDataConfig {
  node: {
    color: string;
  };
  combo: {
    color: string;
    minRadius: number;
    maxRadius: number;
  };
}

const defaultConfig: GraphDataConfig = {
  node: {
    color: "blue",
  },
  combo: {
    color: "blue",
    minRadius: 20,
    maxRadius: 40,
  },
};

export class GraphData {
  private nodes: Map<string, NodeGraphData> = new Map();
  private edges: Map<string, EdgeGraphData> = new Map();
  private combos: Map<string, ComboGraphData> = new Map();

  private comboChildMap: Map<string, string> = new Map();

  private callback: Record<string, GraphDataCallback> = {};

  private comboToCreate: ComboData[] = [];
  private nodeToCreate: NodeData[] = [];
  private edgeToCreate: EdgeData[] = [];
  private edgeIds: Record<string, Set<string>> = {};

  private config: GraphDataConfig;

  constructor(
    nodes: NodeData[],
    edges: EdgeData[],
    combos: ComboData[],
    config?: GraphDataConfig
  ) {
    this.config = {
      ...defaultConfig,
      ...config,
      node: {
        ...defaultConfig.node,
        ...config?.node,
      },
      combo: {
        ...defaultConfig.combo,
        ...config?.combo,
      },
    };

    this.addCombos(combos);
    this.addNodes(nodes);
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

  private getComboHook(id: string): ComboGraphDataHookBase | undefined {
    const combo = this.getComboByID(id);
    if (combo == null) return;

    const { child, ...comboData } = combo;
    return {
      ...comboData,
      ...child,
      combos: child?.combos == null ? undefined : Object.keys(child.combos),
    };
  }

  public useCombo(id: string) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [state, setState] = useState<ComboGraphDataHook | null>(null);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const combo = this.getComboHook(id);
      if (combo == null) return;

      const newData: ComboGraphDataHook = {
        ...combo,
        comboCollapsed: (id: string) => {
          this.comboCollapsed(id);
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        },
        comboDragMove: (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
          this.comboDragMove(id, e);
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        },
        comboRadiusChange: (id: string, radius: number) => {
          this.comboRadiusChange(id, radius);
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        },
      };

      setState(newData);
    }, [id]);

    return { ...state };
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

  private _addChildNode(c: NodeData): boolean {
    if (c.combo == null) {
      console.error("_addChildNode parent is null", c);
      return false;
    }

    const parentCombo = this.getComboByID(c.combo);
    if (parentCombo != null) {
      if (parentCombo.child == null) {
        parentCombo.child = {
          nodes: {},
          combos: {},
          edges: {},
        };
      }

      const size = Object.keys(parentCombo.child.combos).length;
      parentCombo.child.nodes[c.id] = {
        ...c,
        radius: c.radius ?? this.config.combo.minRadius,
        color: c.color ?? this.config.node.color,
        x: Math.random() * size * 5,
        y: Math.random() * size * 5,
      };
      this.comboChildMap.set(c.id, c.combo);
      return true;
    }

    return false;
  }

  private _addNodes(count?: number) {
    if (count != null && count == this.nodeToCreate.length) {
      console.error(
        "_addNodes failed to create",
        this.nodeToCreate,
        Object.fromEntries(this.combos)
      );
      return;
    }

    const newNodeToCreate: NodeData[] = [];
    for (const c of this.nodeToCreate) {
      if (this._addChildNode(c)) {
        continue;
      }

      newNodeToCreate.push(c);
    }

    const prevCount = this.nodeToCreate.length;
    this.nodeToCreate = newNodeToCreate;

    if (this.nodeToCreate.length > 0) {
      this._addNodes(prevCount);
    }
  }

  public addNodes(nodes: NodeData[]) {
    this.nodes.clear();
    for (const n of nodes) {
      if (n.combo == null) {
        this.nodes.set(n.id, {
          ...n,
          radius: n.radius ?? 20,
          color: n.color ?? this.config.node.color,
          x: Math.random() * 100,
          y: Math.random() * 100,
        });
        continue;
      }

      if (this._addChildNode(n)) {
        continue;
      }

      this.nodeToCreate.push(n);
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

    this.trigger({ type: "new-edges" });
  }

  private getTopParent(id: string): ComboGraphData | undefined {
    if (this.combos.has(id)) {
      const parentCombo = this.combos.get(id);
      if (parentCombo != null) {
        return parentCombo;
      }
    }

    if (this.comboChildMap.has(id)) {
      const parentId = this.comboChildMap.get(id);
      if (parentId != null) {
        return this.getTopParent(parentId);
      }
    }

    return undefined;
  }

  private getComboByID(id: string): ComboGraphData | undefined {
    if (this.combos.has(id)) {
      const parentCombo = this.combos.get(id);
      if (parentCombo != null) {
        return parentCombo;
      }
    }

    if (this.comboChildMap.has(id)) {
      const parentId = this.comboChildMap.get(id);
      if (parentId != null) {
        const parent = this.getTopParent(parentId);
        if (parent != null) {
          return parent.child?.combos[id];
        }
      }
    }

    return undefined;
  }

  private _addChildCombo(c: ComboData): boolean {
    if (c.combo == null) {
      console.error("_addChildCombo parent is null", c);
      return false;
    }

    const parentCombo = this.getComboByID(c.combo);
    if (parentCombo != null) {
      if (parentCombo.child == null) {
        parentCombo.child = {
          nodes: {},
          combos: {},
          edges: {},
        };
      }

      const size = Object.keys(parentCombo.child.combos).length;
      parentCombo.child.combos[c.id] = {
        ...c,
        radius: c.radius ?? this.config.combo.minRadius,
        color: c.color ?? this.config.combo.color,
        collapsedRadius: c.collapsedRadius ?? this.config.combo.minRadius,
        expandedRadius: c.expandedRadius ?? this.config.combo.maxRadius,
        x: Math.random() * size * 5,
        y: Math.random() * size * 5,
      };
      this.comboChildMap.set(c.id, c.combo);
      return true;
    }

    return false;
  }

  private _addCombos(count?: number) {
    if (count != null && count == this.comboToCreate.length) {
      console.error("_addCombos failed to create", this.comboToCreate);
      return;
    }

    const newComboToCreate: ComboData[] = [];
    for (const c of this.comboToCreate) {
      if (this._addChildCombo(c)) {
        continue;
      }

      newComboToCreate.push(c);
    }

    const prevCount = this.comboToCreate.length;
    this.comboToCreate = newComboToCreate;

    if (this.comboToCreate.length > 0) {
      this._addCombos(prevCount);
    }
  }

  public addCombos(combos: ComboData[]) {
    this.combos.clear();
    for (const c of combos) {
      if (c.combo == null) {
        this.combos.set(c.id, {
          ...c,
          radius: c.radius ?? this.config.combo.minRadius,
          color: c.color ?? this.config.combo.color,
          collapsedRadius: c.collapsedRadius ?? this.config.combo.minRadius,
          expandedRadius: c.expandedRadius ?? this.config.combo.maxRadius,
          x: (Math.random() - 0.5) * combos.length * 20,
          y: (Math.random() - 0.5) * combos.length * 20,
        });
        continue;
      }

      if (this._addChildCombo(c)) {
        continue;
      }

      this.comboToCreate.push(c);
    }

    // add combo that have parent
    this._addCombos();
    this._addNodes();

    this.createEdges();

    this.trigger({ type: "new-combos" });
  }

  public comboCollapsed(id: string) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboCollapsed: combo not found");
      return;
    }

    combo.collapsed = !combo.collapsed;

    // const parentCombo = this.getTopParent(id);
    // if (parentCombo == null) return;

    // this.trigger({
    //   type: "combo-collapsed",
    //   id: parentCombo.id,
    //   child: combo.id != id,
    // });
  }

  public comboRadiusChange(id: string, radius: number) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboRadiusChange: combo not found");
      return;
    }

    combo.radius = radius;
    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    const parentCombo = this.getTopParent(id);
    if (parentCombo == null) return;

    this.trigger({
      type: "combo-radius-change",
      id: parentCombo.id,
      edgeIds,
      child: combo.id != id,
    });
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
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboDragMove: combo not found");
      return;
    }

    combo.x = e.target.x();
    combo.y = e.target.y();

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    const parentCombo = this.getTopParent(id);
    if (parentCombo == null) return;

    this.trigger({
      type: "combo-drag-move",
      id: parentCombo.id,
      edgeIds,
      child: combo.id != id,
    });
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

  public layout() {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    for (const n of this.nodes.values()) {
      nodes.push({
        id: n.id,
        x: n.x,
        y: n.y,
      });
    }

    for (const c of this.combos.values()) {
      nodes.push({
        id: c.id,
        x: c.x,
        y: c.y,
      });
    }

    for (const e of this.edges.values()) {
      edges.push({
        id: e.id,
        source: e.source,
        target: e.target,
      });
    }

    console.log(nodes, edges);

    const layout = new ForceLayout(nodes, edges, {
      repulsionStrength: 4000,
      linkDistance: 300,
      damping: 0.85,
      gravity: 0.05,
      timeStep: 0.02,
    });

    layout.onTick = (nodesPositions, step) => {
      console.log("tick", step, nodesPositions);
    };

    layout.runSteps(1000);

    for (const n of layout.nodes) {
      const node: PointData | undefined = this.getPointId(n.id);
      if (node == null) continue;

      node.x = n.x;
      node.y = n.y;
    }

    const edgeIds = new Set<string>();

    for (const n of layout.nodes) {
      const ids = this.getComboEdges(n.id);
      for (const edgeId of ids) {
        edgeIds.add(edgeId);
      }
    }

    console.log("edgeIds", edgeIds);
    this.updateEdgePos(Array.from(edgeIds));

    this.trigger({ type: "new-combos" });
    this.trigger({ type: "new-nodes" });
    this.trigger({ type: "new-edges" });
  }
}

const useGraph: (option: useGraphProps) => GraphData = ({
  nodes = [],
  edges = [],
  combos = [],
  config,
}) => {
  const [data] = useState(() => new GraphData(nodes, edges, combos, config));

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

export default useGraph;
