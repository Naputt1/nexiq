import type {
  TypeDataDeclare,
  ComponentFileVar,
  VariableName,
  DatabaseData,
} from "@nexiq/shared";

// Re-exporting these from shared for convenience if needed by extensions
export type { TypeDataDeclare, ComponentFileVar, VariableName, DatabaseData };

export interface GraphItemPosition {
  x: number;
  y: number;
}

export interface GraphNodeData {
  id: string;
  name: VariableName | string;
  label?: { text: string; fill?: string };
  type?: string;
  projectPath?: string;
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
  [key: string]: unknown;
}

export interface GraphComboData extends GraphNodeData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  padding?: number;
  [key: string]: unknown;
}

export interface GraphArrowData {
  id: string;
  source: string;
  target: string;
  label?: string;
  combo?: string;
  [key: string]: unknown;
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
  run: (
    data: DatabaseData,
    result: GraphViewResult,
    batch?: Partial<DatabaseData>,
  ) => GraphViewResult;
}

export interface DetailSectionProps {
  selectedId: string;
  item: GraphNodeData | GraphComboData;
  graph: unknown; // GraphData instance
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

export interface MCPToolHandlerArgs {
  projectPath?: string;
  projectManager: unknown; // We use unknown here to avoid dependency on server package
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: MCPToolHandlerArgs) => Promise<unknown>;
}

export interface Extension {
  id: string;
  viewTasks?: Record<string, GraphViewTask[]>; // Mapping of GraphViewType to tasks
  detailSections?: DetailSection[];
  mcpTools?: MCPTool[];
}

export * from "./tasks/componentTask.js";
export * from "./tasks/gitTask.js";
