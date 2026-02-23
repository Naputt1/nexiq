import type { ComponentLoc, VariableName } from "../component.js";
import type { TypeData, TypeDataLiteralBody } from "./primitive.js";
import type { ReactMapConfig, SubProject } from "./config.js";
export * from "./primitive.js";
export * from "./object.js";
export * from "./git.js";
export * from "./config.js";

export interface ProjectStatus {
  hasConfig: boolean;
  isMonorepo: boolean;
  projectType: "vite" | "next" | "unknown";
  config: ReactMapConfig | null;
  subProjects: SubProject[];
}

export type GraphViewType = "component" | "file" | "router";

export interface AppStateData {
  selectedSubProject: string | null;
  centeredItemId: string | null;
  selectedId: string | null;
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

export * from "./backend.js";
