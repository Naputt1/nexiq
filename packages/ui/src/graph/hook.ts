import { useCallback, useEffect, useState } from "react";
import type { LabelData } from "./label";
import type {
  ComponentInfoRender,
  PropData,
  TypeData,
  TypeDataParam,
  VariableLoc,
  VariableScope,
} from "shared";
import type Konva from "konva";
import { type Node, type Edge } from "./layout";

export type useGraphProps = {
  nodes?: NodeData[];
  edges?: EdgeData[];
  combos?: ComboData[];
  config?: GraphDataConfig;
  projectPath?: string;
  targetPath?: string;
};

export type GraphDataCallbackParams =
  | { type: "new-nodes" }
  | { type: "new-edges" }
  | { type: "new-combos" }
  | { type: "combo-collapsed"; id: string }
  | { type: "combo-drag-move"; id: string; edgeIds: string[]; child?: boolean }
  | { type: "combo-drag-end"; id: string }
  | { type: "node-drag-move"; id: string; edgeIds: string[] }
  | { type: "node-drag-end"; id: string }
  | {
      type: "combo-radius-change";
      id: string;
      edgeIds: string[];
      child?: boolean;
    }
  | { type: "layout-change" }
  | { type: "child-moved" };

export type GraphDataCallback = (params: GraphDataCallbackParams) => void;

type InnerCallBackParams = { type: "child-moved" } | { type: "layout-change" };

type InnerCallBack = (params: InnerCallBackParams) => void;

export interface GraphItem {
  x?: number;
  y?: number;
}

export interface PointData extends GraphItem {
  color?: string;
  radius?: number;
  label?: LabelData;
  combo?: string;
  highlighted?: boolean;
}

export interface DetailItemData {
  id: string;
  fileName: string;
  pureFileName?: string;
  scope?: VariableScope;
  loc?: VariableLoc;
  props?: PropData[];
  propData?: PropData;
  propType?: TypeData;
  type?:
    | "component"
    | "type"
    | "interface"
    | "state"
    | "render"
    | "effect"
    | "memo"
    | "ref"
    | "prop";
  typeParams?: TypeDataParam[];
  extends?: string[];
  renders?: Record<string, ComponentInfoRender>;
  gitStatus?: "added" | "modified" | "deleted";
  visible?: boolean;
  ui?: {
    renders?: Record<string, { x: number; y: number }>;
    isLayoutCalculated?: boolean;
    x?: number;
    y?: number;
    radius?: number;
  };
}

export interface NodeData extends PointData, DetailItemData {
  radius?: number;
}

export type EdgeData = {
  id: string;
  source: string;
  target: string;
  combo?: string;
};

export interface ComboData extends PointData, DetailItemData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  animation?: boolean;
  padding?: number;
}

export interface NodeGraphData extends NodeData {
  x: number;
  y: number;
  radius: number;
  color: string;
  isLayoutCalculated: boolean;
  parent?: ComboGraphData;
  scale: number;
}

export interface EdgeGraphData extends Partial<GraphItem>, EdgeData {
  points: number[];
  scale: number;
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
  padding: number;
  isLayoutCalculated: boolean;
  parent?: ComboGraphData;
  scale: number;
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
  comboDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  comboHover: () => void;
}

interface CurRender {
  nodes: Record<string, NodeGraphData>;
  edges: Record<string, EdgeGraphData>;
  combos: Record<string, ComboGraphData>;
}

export interface GraphDataConfig {
  node: {
    color: string;
  };
  combo: {
    color: string;
    minRadius: number;
    maxRadius: number;
    padding: number;
  };
}

import LayoutWorker from "./layout.worker?worker";
import type { LayoutRequest, LayoutResponse } from "./layout.worker";

const SCALE_FACTOR = 0.6;

const defaultConfig: GraphDataConfig = {
  node: {
    color: "blue",
  },
  combo: {
    color: "blue",
    minRadius: 20,
    maxRadius: 40,
    padding: 10,
  },
};

export class GraphData {
  private nodes: Map<string, NodeGraphData> = new Map();
  private edges: Map<string, EdgeGraphData> = new Map();
  private combos: Map<string, ComboGraphData> = new Map();

  private comboChildMap: Map<string, string> = new Map();
  private edgeParentMap: Map<string, string> = new Map();

  private callback: Record<string, GraphDataCallback> = {};

  private comboToCreate: ComboData[] = [];
  private nodeToCreate: NodeData[] = [];
  private edgeToCreate: EdgeData[] = [];
  private edgeIds: Record<string, Set<string>> = {};

  private config: GraphDataConfig;

  private innerCallback: Map<string, InnerCallBack> = new Map();

  private isBatching = false;

  private worker: Worker;

  private projectPath?: string;
  private targetPath?: string;

  private layoutInProgress: Set<string> = new Set();

  constructor(
    nodes: NodeData[],
    edges: EdgeData[],
    combos: ComboData[],
    config?: GraphDataConfig,
    projectPath?: string,
    targetPath?: string,
  ) {
    this.projectPath = projectPath;
    this.targetPath = targetPath;
    this.worker = new LayoutWorker();
    this.worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const { type, id, nodes } = e.data;
      if (type === "layout-result") {
        this.layoutInProgress.delete(id);
        this.batch(() => {
          if (id === "root") {
            for (const n of nodes) {
              const node = this.getPointByID(n.id);
              if (node) {
                node.x = n.x;
                node.y = n.y;
                if (!("collapsedRadius" in node)) {
                  node.isLayoutCalculated = true;
                }
              }
            }

            const edgeIds = new Set<string>();
            for (const n of nodes) {
              const ids = this.getComboEdges(n.id);
              for (const edgeId of ids) {
                edgeIds.add(edgeId);
              }
            }

            this.updateEdgePos(Array.from(edgeIds));

            for (const c of this.combos.values()) {
              this.innerCallback.get(c.id)?.({ type: "layout-change" });
            }
          } else {
            const combo = this.getComboByID(id);
            if (combo) {
              for (const n of nodes) {
                const node =
                  combo.child?.nodes[n.id] ?? combo.child?.combos[n.id];
                if (node) {
                  node.x = n.x;
                  node.y = n.y;
                  if (!("collapsedRadius" in node)) {
                    node.isLayoutCalculated = true;
                  }
                }
              }

              const edgeIds = new Set<string>();
              for (const n of nodes) {
                const ids = this.getComboEdges(n.id);
                for (const edgeId of ids) {
                  edgeIds.add(edgeId);
                }
              }

              this.updateEdgePos(Array.from(edgeIds));

              combo.expandedRadius = this.calculateComboRadius(combo);
              combo.isLayoutCalculated = true;
              this.innerCallback.get(id)?.({ type: "layout-change" });

              this.trigger({
                type: "combo-radius-change",
                id: combo.id,
                edgeIds: Array.from(edgeIds),
                child: true,
              });

              // Trigger parent layout to accommodate new radius
              if (combo.combo == null) {
                this.layout(true);
              } else {
                this.calculateComboChildrenLayout(combo.combo, true);
              }
            }
          }

          // Trigger IPC update
          this.savePositions(nodes, id);
        }, true); // onlyLayout = true
      }
    };

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
    if (this.isBatching) return;
    for (const cb of Object.values(this.callback)) {
      cb(data);
    }
  }

  private savePositions(
    nodes: { id: string; x: number; y: number }[],
    contextId: string,
  ) {
    if (this.projectPath && this.targetPath) {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) {
        positions[n.id] = { x: n.x, y: n.y };
      }
      window.ipcRenderer.invoke(
        "update-graph-position",
        this.projectPath,
        this.targetPath,
        positions,
        contextId,
      );
    }
  }

  public batch(fn: () => void, onlyLayout = false) {
    const prevBatching = this.isBatching;
    this.isBatching = true;
    try {
      fn();
    } finally {
      this.isBatching = prevBatching;
      if (!this.isBatching) {
        this.refresh(onlyLayout);
      }
    }
  }

  public refresh(onlyLayout = false) {
    this.curRender = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      combos: Object.fromEntries(this.combos),
    };

    if (onlyLayout) {
      this.trigger({ type: "layout-change" });
    } else {
      this.trigger({ type: "new-nodes" });
      this.trigger({ type: "new-combos" });
      this.trigger({ type: "new-edges" });
    }

    for (const c of this.combos.values()) {
      this.innerCallback.get(c.id)?.({ type: "layout-change" });
    }
  }

  public clear() {
    this.nodes.clear();
    this.edges.clear();
    this.combos.clear();
    this.comboChildMap.clear();
    this.comboToCreate = [];
    this.nodeToCreate = [];
    this.edgeToCreate = [];
    this.edgeIds = {};
  }

  public setData(
    nodes: NodeData[],
    edges: EdgeData[],
    combos: ComboData[],
    projectPath?: string,
    targetPath?: string,
  ) {
    if (projectPath) this.projectPath = projectPath;
    if (targetPath) this.targetPath = targetPath;

    this.batch(() => {
      this.clear();
      this.addCombos(combos);
      this.addNodes(nodes);
      this.addEdges(edges);
    });
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
    const callback = useCallback(
      (param: InnerCallBackParams) => {
        if (param.type === "child-moved") {
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        } else if (param.type === "layout-change") {
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        }
      },
      [setState, id],
    );

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const combo = this.getComboHook(id);
      if (combo == null) return;

      this.innerCallback.set(id, callback);

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
        comboDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
          this.comboDragEnd(id, e);
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
        comboHover: () => {
          this.calculateComboChildrenLayout(id);
        },
      };

      setState(newData);
    }, [id, callback]);

    return { ...state };
  }

  public calculateComboChildrenLayout(id: string, force = false) {
    const combo = this.getComboByID(id);
    if (combo == null) return;
    if (!force && combo.isLayoutCalculated) return;
    if (this.layoutInProgress.has(id)) return;

    // Check if all children already have positions from UI or parent renders
    const children = [
      ...Object.values(combo.child?.nodes ?? {}),
      ...Object.values(combo.child?.combos ?? {}),
    ];

    if (!force && children.length > 0) {
      const allCalculated = children.every((c) => c.isLayoutCalculated);

      if (allCalculated) {
        combo.isLayoutCalculated = true;
        // Need to update edge positions since they might not be calculated
        const edgeIds = new Set<string>();
        for (const child of children) {
          const ids = this.getComboEdges(child.id);
          for (const eid of ids) edgeIds.add(eid);
        }
        this.updateEdgePos(Array.from(edgeIds));
        this.trigger({ type: "layout-change" });
        return;
      }
    }

    // Check if we already have positions (from persistence)
    // If all children have x,y != 0 (or some check), maybe skips?
    // But persistence layer should set isLayoutCalculated = true if loaded.

    // If not calculated, send to worker
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    for (const n of Object.values(combo.child?.nodes ?? {})) {
      nodes.push({
        id: n.id,
        x: n.x, // Pass existing X if available (from persistence)
        y: n.y,
        radius: n.radius,
      });
    }

    for (const c of Object.values(combo.child?.combos ?? {})) {
      nodes.push({
        id: c.id,
        x: c.x,
        y: c.y,
        radius: c.collapsed ? c.collapsedRadius : c.expandedRadius,
      });
    }

    for (const e of Object.values(combo.child?.edges ?? {})) {
      edges.push({
        id: e.id,
        source: e.source,
        target: e.target,
      });
    }

    this.worker.postMessage({
      type: "layout",
      id: combo.id,
      nodes,
      edges,
      options: {
        repulsionStrength: 250 * combo.scale,
        linkDistance: 25 * combo.scale,
        damping: 0.8,
        gravity: 0.05,
        timeStep: 0.02,
        minNodeDistance: 25 * combo.scale,
        collisionStrength: 2,
        alpha: 1.0,
        alphaDecay: 0.005,
      },
      iterations: 2000,
    } as LayoutRequest);
  }

  private getConnectorPoints = (
    from: NodeGraphData | ComboGraphData,
    to: NodeGraphData | ComboGraphData,
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

  private _addChildEdge(e: EdgeData): boolean {
    if (e.combo == null) {
      return false;
    }

    const parentCombo = this.getComboByID(e.combo);
    if (parentCombo != null) {
      if (parentCombo.child == null) {
        parentCombo.child = {
          nodes: {},
          combos: {},
          edges: {},
        };
      }

      const srcNode =
        parentCombo.child.nodes[e.source] ?? parentCombo.child.combos[e.source];
      const targetNode =
        parentCombo.child.nodes[e.target] ?? parentCombo.child.combos[e.target];

      if (srcNode == null || targetNode == null) {
        return false;
      }

      parentCombo.child.edges[e.id] = {
        ...e,
        points: [],
        scale: Math.min(srcNode.scale, targetNode.scale),
      };
      this.edgeParentMap.set(e.id, parentCombo.id);
      this.updateEdgePos([e.id]);
      return true;
    }

    return false;
  }

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

      const nodesSize = Object.keys(parentCombo.child.nodes).length;
      const combosSize = Object.keys(parentCombo.child.combos).length;
      const size = nodesSize + combosSize;

      let x = c.x;
      let y = c.y;

      if (c.ui) {
        x = c.ui.x;
        y = c.ui.y;
      } else if (parentCombo.ui?.renders?.[c.id]) {
        x = parentCombo.ui.renders[c.id].x;
        y = parentCombo.ui.renders[c.id].y;
      }

      const scale = parentCombo.scale * SCALE_FACTOR;

      let radius = c.ui?.radius ?? c.radius ?? this.config.combo.minRadius;
      if (!c.ui?.radius) {
        radius *= scale;
      }

      parentCombo.child.nodes[c.id] = {
        ...c,
        radius,
        color: c.color ?? this.config.node.color,
        isLayoutCalculated: !!c.ui?.isLayoutCalculated,
        x: x ?? (Math.random() - 0.5) * (size + 1) * 10 * scale,
        y: y ?? (Math.random() - 0.5) * (size + 1) * 10 * scale,
        parent: parentCombo,
        scale,
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
        count,
        this.nodeToCreate,
        Object.fromEntries(this.combos),
        this.comboChildMap.get("44d171ea-4fbf-4cc4-ae67-218df1a1caf2-render"),
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
          radius: n.ui?.radius ?? n.radius ?? 20,
          color: n.color ?? this.config.node.color,
          isLayoutCalculated: !!n.ui?.isLayoutCalculated,
          x: n.ui?.x ?? n.x ?? (Math.random() - 0.5) * 100, // Use UI position if available
          y: n.ui?.y ?? n.y ?? (Math.random() - 0.5) * 100,
          scale: 1,
        });
        continue;
      }

      if (this._addChildNode(n)) {
        continue;
      }

      this.nodeToCreate.push(n);
    }

    // Update radii for combos that have children nodes added
    for (const c of this.getAllCombos()) {
      if (c.isLayoutCalculated) {
        this.updateComboRadius(c.id);
      }
    }

    this.createEdges();

    this.trigger({ type: "new-nodes" });
  }

  private addEdgeId(nodeId: string, edgeId: string) {
    if (this.edgeIds[nodeId] == null) {
      this.edgeIds[nodeId] = new Set();
    }
    this.edgeIds[nodeId].add(edgeId);
  }

  private getPointId(id: string) {
    return this.getPointByID(id);
  }

  public getPointByID(id: string): NodeGraphData | ComboGraphData | undefined {
    let item: NodeGraphData | ComboGraphData | undefined =
      this.nodes.get(id) ?? this.combos.get(id);

    if (!item) {
      const parentId = this.comboChildMap.get(id);
      if (parentId) {
        const parent = this.getComboByID(parentId);
        if (parent && parent.child) {
          item = parent.child.nodes[id] ?? parent.child.combos[id];
        }
      }
    }

    return item;
  }

  private createEdges() {
    const newEdgesToCreate: EdgeData[] = [];
    for (const e of this.edgeToCreate) {
      if (e.combo == null) {
        const srcNode = this.getPointId(e.source);
        const targetNode = this.getPointId(e.target);

        if (srcNode == null || targetNode == null) {
          newEdgesToCreate.push(e);
          continue;
        }

        this.edges.set(e.id, {
          ...e,
          points: [],
          scale: Math.min(srcNode.scale, targetNode.scale),
        });
        this.updateEdgePos([e.id]);
        continue;
      }

      if (!this._addChildEdge(e)) {
        newEdgesToCreate.push(e);
      }
    }

    this.edgeToCreate = newEdgesToCreate;
  }

  public addEdges(edges: EdgeData[]) {
    this.edges.clear();
    this.edgeParentMap.clear();
    for (const e of edges) {
      this.addEdgeId(e.source, e.id);
      this.addEdgeId(e.target, e.id);

      if (e.combo == null) {
        const srcNode = this.getPointId(e.source);
        const targetNode = this.getPointId(e.target);

        if (srcNode == null || targetNode == null) {
          this.edgeToCreate.push(e);
          continue;
        }

        this.edges.set(e.id, {
          ...e,
          points: [],
          scale: Math.min(srcNode.scale, targetNode.scale),
        });
        this.updateEdgePos([e.id]);
        this.edgeParentMap.delete(e.id);
      }

      if (this._addChildEdge(e)) {
        continue;
      }

      this.edgeToCreate.push(e);
    }

    this.trigger({ type: "new-edges" });
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
        const parent = this.getComboByID(parentId);
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

      const nodesSize = Object.keys(parentCombo.child.nodes).length;
      const combosSize = Object.keys(parentCombo.child.combos).length;
      const size = nodesSize + combosSize;

      const scale = parentCombo.scale * SCALE_FACTOR;

      let collapsedRadius = c.collapsedRadius ?? this.config.combo.minRadius;
      let expandedRadius =
        c.ui?.radius ?? c.expandedRadius ?? this.config.combo.maxRadius;

      if (!c.ui?.radius) {
        collapsedRadius *= scale;
        expandedRadius *= scale;
      }

      parentCombo.child.combos[c.id] = {
        ...c,
        radius: c.collapsed ? collapsedRadius : expandedRadius,
        color: c.color ?? this.config.combo.color,
        collapsedRadius,
        expandedRadius,
        x: c.ui?.x ?? c.x ?? (Math.random() - 0.5) * (size + 1) * 50 * scale,
        y: c.ui?.y ?? c.y ?? (Math.random() - 0.5) * (size + 1) * 50 * scale,
        padding: c.padding ?? this.config.combo.padding,
        isLayoutCalculated: !!c.ui?.isLayoutCalculated,
        parent: parentCombo,
        scale,
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
        const collapsedRadius =
          c.collapsedRadius ?? this.config.combo.minRadius;
        const expandedRadius =
          c.ui?.radius ?? c.expandedRadius ?? this.config.combo.maxRadius;

        this.combos.set(c.id, {
          ...c,
          radius: c.collapsed ? collapsedRadius : expandedRadius,
          color: c.color ?? this.config.combo.color,
          collapsedRadius,
          expandedRadius,
          x: c.ui?.x ?? c.x ?? (Math.random() - 0.5) * combos.length * 10,
          y: c.ui?.y ?? c.y ?? (Math.random() - 0.5) * combos.length * 10,
          padding: c.padding ?? this.config.combo.padding,
          isLayoutCalculated: !!c.ui?.isLayoutCalculated,
          scale: 1,
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

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.trigger({
      type: "combo-collapsed",
      id: combo.id,
    });

    if (!combo.collapsed) {
      // Ensure children of this combo are laid out so we know its expanded size
      this.calculateComboChildrenLayout(id, true);
    }

    // Recalculate parent layout when expanding/collapsing to avoid overlaps/gaps
    if (combo.combo == null) {
      this.layout(true);
    } else {
      this.calculateComboChildrenLayout(combo.combo, true);
    }
  }

  // trigger by self on collpase/expand
  public comboRadiusChange(id: string, radius: number) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboRadiusChange: combo not found");
      return;
    }

    combo.radius = radius;
    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.trigger({
      type: "combo-radius-change",
      id: combo.id,
      edgeIds,
      child: false,
    });

    if (combo.parent != null) {
      this.updateComboRadius(combo.parent.id);
    }
  }

  private updateEdgePos(ids: string[]) {
    for (const id of ids) {
      const edge = this.getEdge(id);
      if (edge == null) continue;

      const parentId = this.edgeParentMap.get(id);
      const srcVisible = this.getVisiblePoint(edge.source, parentId);
      const targetVisible = this.getVisiblePoint(edge.target, parentId);

      if (srcVisible == null || targetVisible == null) continue;

      if (srcVisible.item.id === targetVisible.item.id) {
        edge.points = [];
        continue;
      }

      const srcNode = srcVisible.item;
      const targetNode = targetVisible.item;

      edge.scale = Math.min(srcNode.scale, targetNode.scale);

      if (parentId == null) {
        // Top-level edge or absolute coordinate space required
        const srcPos = this.getAbsolutePosition(srcNode.id);
        const targetPos = this.getAbsolutePosition(targetNode.id);
        if (srcPos && targetPos) {
          edge.points = this.getConnectorPoints(
            { ...srcNode, ...srcPos },
            { ...targetNode, ...targetPos },
          );
        }
      } else {
        // Nested edge: use local positions (siblings)
        edge.points = this.getConnectorPoints(srcNode, targetNode);
      }
    }
  }

  private getComboEdges(nodeId: string): string[] {
    const edgeIds = new Set<string>();
    const collect = (itemId: string) => {
      const ids = this.edgeIds[itemId];
      if (ids) {
        for (const eid of ids) {
          edgeIds.add(eid);
        }
      }

      const combo = this.getComboByID(itemId);
      if (combo && combo.child) {
        for (const childNode of Object.values(combo.child.nodes)) {
          collect(childNode.id);
        }
        for (const childCombo of Object.values(combo.child.combos)) {
          collect(childCombo.id);
        }
      }
    };
    collect(nodeId);
    return Array.from(edgeIds);
  }

  private calculateComboRadius(combo: ComboGraphData): number {
    let maxRadius = 0;

    for (const node of Object.values(combo.child?.nodes ?? {})) {
      const dist = Math.sqrt(node.x * node.x + node.y * node.y) + node.radius;
      if (dist > maxRadius) maxRadius = dist;
    }

    for (const childCombo of Object.values(combo.child?.combos ?? {})) {
      const dist =
        Math.sqrt(childCombo.x * childCombo.x + childCombo.y * childCombo.y) +
        childCombo.radius;
      if (dist > maxRadius) maxRadius = dist;
    }

    return Math.max(
      maxRadius + combo.padding * combo.scale,
      combo.collapsedRadius,
      this.config.combo.maxRadius * combo.scale,
    );
  }

  private updateComboRadius(id: string) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("updateComboRadius: combo not found");
      return;
    }

    const radius = this.calculateComboRadius(combo);

    combo.expandedRadius = radius;
    if (!combo.collapsed) {
      combo.radius = radius;
    }

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);
    this.trigger({
      type: "combo-radius-change",
      id: id,
      edgeIds,
    });

    const cb = this.innerCallback.get(id);
    if (cb != null) {
      cb({
        type: "child-moved",
      });
    }

    if (combo.parent != null) {
      this.updateComboRadius(combo.parent.id);
    }
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

    // const parentCombo = this.getTopParent(id);
    // if (parentCombo == null) return;

    if (combo.combo == null) {
      this.trigger({
        type: "combo-drag-move",
        id: combo.id,
        edgeIds,
      });
      return;
    }

    this.updateComboRadius(combo.combo);
    const cb = this.innerCallback.get(combo.combo);
    if (cb == null) return;

    cb({
      type: "child-moved",
    });

    if (combo.parent != null) {
      this.updateComboRadius(combo.parent.id);

      const parentCb = this.innerCallback.get(combo.parent.id);
      if (parentCb == null) return;

      parentCb({
        type: "child-moved",
      });
    }
  }

  public comboDragEnd(id: string, _e: Konva.KonvaEventObject<DragEvent>) {
    this.trigger({
      type: "combo-drag-end",
      id: id,
    });
  }

  public comboChildNodeMove(
    id: string,
    nodeId: string,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboChildNodeMove: combo not found");
      return;
    }

    const node = combo.child?.nodes[nodeId];
    if (node == null) {
      console.error("comboChildNodeMove: node not found");
      return;
    }

    node.x = e.target.x();
    node.y = e.target.y();

    const edgeIds = new Set<string>();

    const ids = this.getComboEdges(node.id);
    for (const edgeId of ids) {
      edgeIds.add(edgeId);
    }

    this.updateEdgePos(Array.from(edgeIds));

    this.trigger({
      type: "node-drag-move",
      id: nodeId,
      edgeIds: Array.from(edgeIds),
    });

    this.updateComboRadius(combo.id);
    const cb = this.innerCallback.get(combo.id);
    if (cb == null) return;

    cb({
      type: "child-moved",
    });

    if (combo.parent != null) {
      this.updateComboRadius(combo.parent.id);

      const parentCb = this.innerCallback.get(combo.parent.id);
      if (parentCb == null) return;

      parentCb({
        type: "child-moved",
      });
    }
  }

  public comboChildNodeEnd(_id: string, nodeId: string) {
    this.trigger({
      type: "node-drag-end",
      id: nodeId,
    });
  }

  public getVisiblePoint(
    id: string,
    limitId?: string,
  ):
    | { item: NodeGraphData | ComboGraphData; isCollapsedAncestor: boolean }
    | undefined {
    const item = this.getPointByID(id);
    if (!item) return undefined;

    let highestCollapsed: ComboGraphData | undefined = undefined;

    let p = item.parent;
    while (p && p.id !== limitId) {
      if (p.collapsed) {
        highestCollapsed = p;
      }
      p = p.parent;
    }

    if (highestCollapsed) {
      return { item: highestCollapsed, isCollapsedAncestor: true };
    }
    return { item, isCollapsedAncestor: false };
  }

  public getAbsolutePosition(id: string): { x: number; y: number } | undefined {
    let item: NodeGraphData | ComboGraphData | undefined =
      this.nodes.get(id) ?? this.combos.get(id);

    if (!item) {
      const parentId = this.comboChildMap.get(id);
      if (parentId) {
        const parent = this.getComboByID(parentId);
        if (parent && parent.child) {
          item = parent.child.nodes[id] ?? parent.child.combos[id];
        }
      }
    }

    if (!item) return undefined;

    let x = item.x;
    let y = item.y;
    let currentId = id;

    while (this.comboChildMap.has(currentId)) {
      const parentId = this.comboChildMap.get(currentId)!;
      const parent = this.getComboByID(parentId);
      if (parent) {
        x += parent.x;
        y += parent.y;
        currentId = parentId;
      } else {
        break;
      }
    }

    return { x, y };
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

  public updateCombo(combo: ComboGraphData) {
    const target = this.getComboByID(combo.id);
    if (target) {
      Object.assign(target, combo);
    } else {
      this.combos.set(combo.id, combo);
    }

    this.trigger({ type: "new-combos" });

    const cb = this.innerCallback.get(combo.id);
    if (cb == null) return;

    cb({
      type: "child-moved",
    });
  }

  public updateNode(node: NodeGraphData) {
    const target = this.getPointId(node.id);
    if (target) {
      Object.assign(target, node);
    } else {
      this.nodes.set(node.id, node);
    }
    this.trigger({ type: "new-nodes" });
  }

  public getAllNodes(): NodeGraphData[] {
    const all: NodeGraphData[] = [];
    const collect = (
      nodes: Record<string, NodeGraphData>,
      combos: Record<string, ComboGraphData>,
    ) => {
      for (const n of Object.values(nodes)) {
        all.push(n);
      }
      for (const c of Object.values(combos)) {
        if (c.child) {
          collect(c.child.nodes, c.child.combos);
        }
      }
    };
    collect(Object.fromEntries(this.nodes), Object.fromEntries(this.combos));
    return all;
  }

  public getAllCombos(): ComboGraphData[] {
    const all: ComboGraphData[] = [];
    const collect = (combos: Record<string, ComboGraphData>) => {
      for (const c of Object.values(combos)) {
        all.push(c);
        if (c.child) {
          collect(c.child.combos);
        }
      }
    };
    collect(Object.fromEntries(this.combos));
    return all;
  }

  public expandAncestors(id: string) {
    const parentId = this.comboChildMap.get(id);
    if (!parentId) return;

    const parent = this.getComboByID(parentId);
    if (parent) {
      if (parent.collapsed) {
        parent.collapsed = false;

        // Trigger update for the parent combo to start expansion animation
        this.trigger({
          type: "combo-collapsed",
          id: parentId,
        });

        // Ensure child layout is calculated if it hasn't been before
        this.calculateComboChildrenLayout(parentId, true);

        // Recalculate parent layout when expanding to avoid overlaps
        if (parent.combo == null) {
          this.layout(true);
        } else {
          this.calculateComboChildrenLayout(parent.combo, true);
        }

        // Trigger update for the parent combo (internal)
        const cb = this.innerCallback.get(parentId);
        if (cb) {
          cb({ type: "child-moved" }); // Triggers re-render of the combo
        }
      }
      this.expandAncestors(parentId);
    }
  }

  public getNode(id: string) {
    const point = this.getPointByID(id);
    if (point && !("collapsedRadius" in point)) {
      return point as NodeGraphData;
    }
    return undefined;
  }

  public getEdge(id: string) {
    if (this.edges.has(id)) return this.edges.get(id);
    const parentId = this.edgeParentMap.get(id);
    if (parentId) {
      const parent = this.getComboByID(parentId);
      if (parent && parent.child) {
        return parent.child.edges[id];
      }
    }
    return this.curRender.edges[id];
  }

  public nodeDragMove(nodeId: string, e: Konva.KonvaEventObject<DragEvent>) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.x = e.target.x();
    node.y = e.target.y();

    const edgeIds = new Set<string>();
    const ids = this.getComboEdges(nodeId);
    for (const edgeId of ids) {
      edgeIds.add(edgeId);
    }

    this.updateEdgePos(Array.from(edgeIds));

    this.trigger({
      type: "node-drag-move",
      id: nodeId,
      edgeIds: Array.from(edgeIds),
    });
  }

  public nodeDragEnd(nodeId: string, _e: Konva.KonvaEventObject<DragEvent>) {
    this.trigger({
      type: "node-drag-end",
      id: nodeId,
    });
  }

  public getCombo(id: string) {
    return this.getComboByID(id);
  }

  public layout(force = false) {
    const allItems = [...this.nodes.values(), ...this.combos.values()];
    const allCalculated = allItems.every((c) => c.isLayoutCalculated);

    if (!force && allItems.length > 0 && allCalculated) {
      this.trigger({ type: "layout-change" });
      return;
    }

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    for (const n of this.nodes.values()) {
      nodes.push({
        id: n.id,
        x: n.x,
        y: n.y,
        radius: n.radius,
      });
    }

    for (const c of this.combos.values()) {
      nodes.push({
        id: c.id,
        x: c.x,
        y: c.y,
        radius: c.collapsed ? c.collapsedRadius : c.expandedRadius,
      });
    }

    for (const e of this.edges.values()) {
      edges.push({
        id: e.id,
        source: e.source,
        target: e.target,
      });
    }

    this.worker.postMessage({
      type: "layout",
      id: "root",
      nodes,
      edges,
      iterations: 2000,
      options: {
        minNodeDistance: 200,
        gravity: 0.5,
        repulsionStrength: 1000,
        alpha: 1.0,
        alphaDecay: 0.001,
      },
    });

    // Populate curRender immediately with current positions (even if not laid out yet)
    // or we might wait? But render() initializes curRender.
  }

  private curRender: CurRender = {
    nodes: {},
    edges: {},
    combos: {},
  };

  public getCurNodes() {
    return this.curRender.nodes;
  }

  public getCurEdges() {
    return this.curRender.edges;
  }

  public getCurCombos() {
    return this.curRender.combos;
  }

  public render() {
    // Run the layout algorithm once
    this.layout();

    // Show all nodes/combos/edges initially (no viewport culling on initial render)
    // Viewport culling can be handled by the rendering layer if needed
    this.curRender = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      combos: Object.fromEntries(this.combos),
    };

    // Trigger final updates to render everything
    this.trigger({ type: "new-combos" });
    this.trigger({ type: "new-nodes" });
    this.trigger({ type: "new-edges" });

    console.log("render done", this);
  }
}

const useGraph: (option: useGraphProps) => GraphData = ({
  nodes = [],
  edges = [],
  combos = [],
  config,
  projectPath,
  targetPath,
}) => {
  const [data] = useState(
    () => new GraphData(nodes, edges, combos, config, projectPath, targetPath),
  );

  useEffect(() => {
    data.setData(nodes, edges, combos, projectPath, targetPath);
  }, [nodes, edges, combos, projectPath, targetPath, data]);

  return data;
};

export default useGraph;
