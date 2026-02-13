import type Konva from "konva";
import type {
  ComponentInfoRender,
  PropData,
  TypeData,
  TypeDataParam,
  VariableLoc,
  VariableName,
  VariableScope,
} from "shared";
import type { GraphData } from "../hook";
import type { LabelData } from "../label";
import type { GraphArrow } from "./arrow";
import type { GraphCombo } from "./combo";
import type { GraphNode } from "./node";
import type { CustomColors } from "../../../electron/types";

export * from "./arrow";
export * from "./combo";
export * from "./node";

export interface GraphItemPosition {
  x: number;
  y: number;
}

export interface CurRender {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphArrow>;
  combos: Record<string, GraphCombo>;
}

export type ComboChild = CurRender;

export interface RenderContext {
  graph: GraphData;
  onSelect?: (id: string) => void;
  hasGitChanges: boolean;
  stage: Konva.Stage;
  theme: "dark" | "light";
  customColors?: CustomColors;
}

export interface Renderable {
  render(
    context: RenderContext,
    parent: Konva.Container,
  ): Konva.Group | Konva.Arrow;
}

export interface PointData {
  x?: number;
  y?: number;
  color?: string;
  radius?: number;
  label?: LabelData;
  combo?: string;
  highlighted?: boolean;
}

export interface DetailItemData {
  id: string;
  name: VariableName;
  fileName: string;
  pureFileName?: string;
  scope?: VariableScope;
  loc?: VariableLoc;
  props?: PropData[];
  propData?: PropData;
  propType?: TypeData;
  type?:
    | "component"
    | "hook"
    | "type"
    | "interface"
    | "state"
    | "render"
    | "effect"
    | "memo"
    | "callback"
    | "ref"
    | "prop";
  typeParams?: TypeDataParam[];
  extends?: string[];
  renders?: Record<string, ComponentInfoRender>;
  hooks?: string[];
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

export interface BaseNodeData extends DetailItemData, PointData {
  scale?: number;
  parent?: GraphCombo;
  isLayoutCalculated?: boolean;
}

export type GraphNodeData = BaseNodeData;

export interface GraphComboData extends BaseNodeData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  padding?: number;
  child?: CurRender;
}

export interface GraphArrowData {
  id: string;
  source: string;
  target: string;
  points?: number[];
  scale?: number;
  combo?: string;
  visible?: boolean;
  opacity?: number;
}
