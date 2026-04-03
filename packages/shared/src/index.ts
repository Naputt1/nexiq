import type {
  ComponentFile,
  ComponentFileVar,
  PropData,
  EffectInfo,
  ComponentDBResolve,
  RelationKind,
} from "./component.ts";

export type DataEdge = {
  from: string;
  to: string;
  label: string;
};

export interface PackageRow {
  id: string; // usually name@version or path
  name: string;
  version: string;
  path: string;
}

export interface PackageDependencyRow {
  id: number;
  package_id: string;
  dependency_name: string;
  dependency_version: string;
  is_dev: boolean;
}

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
  kind: RelationKind;
  line: number | null;
  column: number | null;
  data_json: string | null;
}

export type {
  RelationKind,
  UsageOccurrence,
  ComponentRelation,
} from "./component.ts";

export interface FileRow {
  id: number;
  path: string;
  package_id: string | null;
  hash: string;
  fingerprint: string;
  default_export: string | null;
  star_exports_json: string | null;
}

export interface AnalysisRunRow {
  id: string;
  package_id: string | null;
  src_dir: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}

export interface FileRunStatusRow {
  id: string;
  run_id: string;
  package_id: string | null;
  file_path: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  attempt: number;
  file_hash: string | null;
  fingerprint: string | null;
}

export interface FileAnalysisErrorRow {
  id: string;
  run_id: string;
  package_id: string | null;
  file_path: string;
  stage: string;
  error_code: string | null;
  message: string;
  line: number | null;
  column: number | null;
  stack: string | null;
  parser: string | null;
  file_hash: string | null;
  fingerprint: string | null;
  created_at: string;
}

export interface ResolveErrorRow {
  id: string;
  run_id: string;
  package_id: string | null;
  file_path: string;
  scope_id: string | null;
  entity_id: string | null;
  relation_kind: string;
  source_name: string | null;
  source_module: string | null;
  target_hint: string | null;
  resolver_stage: string;
  message: string;
  loc_line: number | null;
  loc_column: number | null;
  retry_count: number;
  created_at: string;
}

export interface WorkspacePackageRow {
  package_id: string;
  name: string;
  version: string | null;
  path: string;
  db_path: string;
}

export interface WorkspaceRunRow {
  id: string;
  root_dir: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}

export interface PackageRunSummaryRow {
  id: string;
  workspace_run_id: string;
  package_id: string;
  analysis_run_id: string;
  status: string;
  files_total: number;
  files_succeeded: number;
  files_failed: number;
  resolve_errors: number;
}

export interface PackageRelationRow {
  from_package_id: string;
  to_package_id: string;
  relation_kind: string;
  source_file_path: string | null;
  target_file_path: string | null;
  source_symbol: string | null;
  target_symbol: string | null;
  run_id: string;
}

export interface CrossPackageResolveErrorRow {
  id: string;
  run_id: string;
  from_package_id: string;
  file_path: string;
  source_name: string | null;
  source_module: string | null;
  relation_kind: string;
  message: string;
  loc_line: number | null;
  loc_column: number | null;
  created_at: string;
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
  packages?: PackageRow[];
  package_dependencies?: PackageDependencyRow[];
  files: FileRow[];
  entities: EntityRow[];
  scopes: ScopeRow[];
  symbols: SymbolRow[];
  renders: RenderRow[];
  exports: ExportRow[];
  relations: RelationRow[];
  analysis_runs?: AnalysisRunRow[];
  file_run_status?: FileRunStatusRow[];
  file_analysis_errors?: FileAnalysisErrorRow[];
  resolve_errors?: ResolveErrorRow[];
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

export * from "./types/index.ts";
export * from "./component.ts";
export * from "./utils.ts";
export * from "./workspace.ts";
