import type {
  ComponentFile,
  ComponentFileVar,
  PropData,
  EffectInfo,
  ComponentDBResolve,
} from "./component.js";

export type DataEdge = {
  from: string;
  to: string;
  label: string;
};

export interface EntityRow {
  id: string;
  scope_id: string;
  kind: string; // 'component', 'hook', 'function', 'class', 'variable', 'import', 'jsx', etc.
  name: string | null;
  type: string | null;
  line: number | null;
  column: number | null;
  end_line: number | null;
  end_column: number | null;
  declaration_kind: string | null;
  data_json: string | null;
}

export interface ScopeRow {
  id: string;
  file_id: number;
  parent_id: string | null;
  kind: string; // 'module', 'block'
  entity_id: string | null;
  data_json: string | null;
}

export interface SymbolRow {
  id: string;
  entity_id: string;
  scope_id: string;
  name: string;
  path: string | null;
  is_alias: number;
  has_default: number;
  data_json: string | null;
}

export interface RenderRow {
  id: string;
  file_id: number;
  parent_entity_id: string;
  parent_render_id: string | null;
  render_index: number;
  tag: string;
  symbol_id: string | null;
  line: number | null;
  column: number | null;
  kind: string;
  data_json: string | null;
}

export interface RelationRow {
  from_id: string;
  to_id: string;
  kind: string;
  line: number | null;
  column: number | null;
  data_json: string | null;
}

export interface FileRow {
  id: number;
  path: string;
  hash: string;
  fingerprint: string;
  default_export: string | null;
  star_exports_json: string | null;
}

export interface ExportRow {
  id: string;
  scope_id: string;
  symbol_id: string | null;
  entity_id: string | null;
  name: string | null;
  is_default: number;
}

export type DatabaseData = {
  files: FileRow[];
  entities: EntityRow[];
  scopes: ScopeRow[];
  symbols: SymbolRow[];
  renders: RenderRow[];
  exports: ExportRow[];
  relations: RelationRow[];
  diff?: AnalyzedDiff;
};

export type AnalyzedDiff = {
  added: string[];
  modified: string[];
  deleted: string[];
  deletedObjects?: Record<string, ComponentFileVar | PropData | EffectInfo>;
};

export type JsonData = {
  src: string;
  edges: DataEdge[];
  files: Record<string, ComponentFile>;
  labels?: Record<string, string[]>;
  diff?: AnalyzedDiff;
  resolve: ComponentDBResolve[];
};

export interface BenchmarkToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface BenchmarkStep {
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  toolCalls?: BenchmarkToolCall[];
  toolCallId?: string;
  toolName?: string;
  tokens: number;
}

export interface BenchmarkResult {
  scenarioId: string;
  projectName: string;
  approach: "baseline" | "nexiq-cold" | "nexiq-warm";
  testType: "single-prompt" | "planning";
  model: string;
  success: boolean;
  totalTokens: number;
  toolCallsCount: number;
  latencyMs: number;
  steps: BenchmarkStep[];
}

export * from "./types/index.js";
export * from "./component.js";
export * from "./utils.js";
