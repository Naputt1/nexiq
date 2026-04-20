import type { ComponentLoc, VariableName } from "../component.js";
import type { TypeData, TypeDataLiteralBody } from "./primitive.js";
import type { NexiqConfig, SubProject } from "./config.js";
export * from "./primitive.js";
export * from "./object.js";
export * from "./git.js";
export * from "./config.js";

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
  gitComparisonEnabled?: boolean;
  viewport?: { x: number; y: number; zoom: number } | null;
  view?: GraphViewType;
  sidebar: {
    right: {
      width?: number;
      height?: number;
    };
    bottom?: {
      isOpen?: boolean;
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

export * from "./backend.js";
