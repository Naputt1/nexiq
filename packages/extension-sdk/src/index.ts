import type { ReactNode } from "react";
import type { JsonData, TypeDataDeclare, ComponentFileVar } from "shared";

// Re-exporting these from shared for convenience if needed by extensions
export type { JsonData, TypeDataDeclare, ComponentFileVar };

export interface GraphItemPosition {
  x: number;
  y: number;
}

export interface GraphNodeData {
  id: string;
  name: any;
  label?: { text: string; fill?: string };
  type?: string;
  fileName?: string;
  pureFileName?: string;
  loc?: { line: number; column: number };
  radius?: number;
  color?: string;
  combo?: string;
  gitStatus?: "added" | "modified" | "deleted";
  declarationKind?: "const" | "let" | "var" | "using" | "await using";
  tag?: string;
  raw?: ComponentFileVar;
  displayName?: string;
  [key: string]: any;
}

export interface GraphComboData extends GraphNodeData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  padding?: number;
  [key: string]: any;
}

export interface GraphArrowData {
  id: string;
  source: string;
  target: string;
  label?: string;
  combo?: string;
  [key: string]: any;
}

export interface useGraphProps {
  nodes: GraphNodeData[];
  edges: GraphArrowData[];
  combos: GraphComboData[];
}

export interface GraphViewResult extends useGraphProps {
  typeData: Record<string, TypeDataDeclare>;
}

export interface GraphViewTask {
  id: string;
  priority: number;
  run: (data: JsonData, result: GraphViewResult) => GraphViewResult;
}

export interface DetailSectionProps {
  selectedId: string;
  item: GraphNodeData | GraphComboData;
  graph: any; // GraphData instance
  projectPath: string;
  typeData: Record<string, TypeDataDeclare>;
  onSelect?: (id: string) => void;
  renderNodes?: GraphNodeData[];
}

export interface DetailSection {
  id: string;
  title: string;
  priority: number;
  component: React.ComponentType<DetailSectionProps>;
  shouldShow: (item: GraphNodeData | GraphComboData) => boolean;
  defaultOpen?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  handler: (args: any) => Promise<any>;
}

export interface Extension {
  id: string;
  viewTasks?: Record<string, GraphViewTask[]>; // Mapping of GraphViewType to tasks
  detailSections?: DetailSection[];
  mcpTools?: MCPTool[];
}

export * from "./tasks/componentTask.js";
export * from "./tasks/gitTask.js";
