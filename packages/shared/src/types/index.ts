import type { ComponentLoc, VariableName } from "../component.ts";
import type { TypeData, TypeDataLiteralBody } from "./primitive.ts";
import type { NexiqConfig, SubProject } from "./config.ts";
export * from "./primitive.ts";
export * from "./object.ts";
export * from "./git.ts";
export * from "./config.ts";

export interface ProjectStatus {
  hasConfig: boolean;
  isMonorepo: boolean;
  projectType: "vite" | "next" | "unknown";
  config: NexiqConfig | null;
  subProjects: SubProject[];
}

export type GraphViewType = "component" | "file" | "router" | "package";

export interface AppSelectionState {
  type: "node" | "edge";
  id: string;
}

export interface AppStateData {
  selectedSubProjects: string[];
  centeredItemId: string | null;
  selectedId: string | null;
  selectedEdgeId?: string | null;
  selectedItemType?: "node" | "edge" | null;
  selected?: AppSelectionState | null;
  isSidebarOpen: boolean;
  activeTab: "projects" | "git";
  selectedCommit: string | null;
  viewport?: { x: number; y: number; zoom: number } | null;
  view?: GraphViewType;
  sidebar: {
    right: {
      width?: number;
      height?: number;
    };
  };
}

export interface TypeDataParam {
  name: string;
  default?: TypeData;
  constraint?: TypeData;
}

export interface TypeDataParamFunction extends TypeDataParam {
  const?: boolean;
  in?: boolean;
  out?: boolean;
}

export interface TypeDataDeclareBase {
  id: string;
  type: "interface" | "type";
  name: VariableName;
}

export interface TypeDataDeclareInterface
  extends TypeDataDeclareBase, ComponentLoc {
  type: "interface";
  extends?: string[];
  body: TypeDataLiteralBody[];
  params?: Record<string, TypeDataParam>;
}

export interface TypeDataDeclareType extends TypeDataDeclareBase, ComponentLoc {
  type: "type";
  body: TypeData;
  params?: TypeDataParam[];
}

export type TypeDataDeclare = TypeDataDeclareInterface | TypeDataDeclareType;

export type ComponentTypeData =
  | {
      type: "name";
      name: string;
    }
  | {
      type: "inline";
      body: TypeData;
    };

export interface UIItemState {
  x: number;
  y: number;
  radius?: number;
  collapsedRadius?: number;
  expandedRadius?: number;
  isLayoutCalculated?: boolean;
  collapsed?: boolean;
}

export type UIStateMap = Record<string, UIItemState>;

export * from "./backend.ts";
