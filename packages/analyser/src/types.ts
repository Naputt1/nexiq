import type {
  AnalysisRunRow,
  ComponentDBResolve,
  ComponentFile,
  ComponentFileExport,
  ComponentFileImport,
  ComponentFileVar,
  CrossPackageResolveErrorRow,
  FileAnalysisErrorRow,
  FileRunStatusRow,
  JsonData,
  PackageRunSummaryRow,
  ResolveErrorRow,
  WorkspacePackageRow,
  WorkspaceRunRow,
} from "@nexiq/shared";
import type { WorkspacePackageInfo } from "./workspace.ts";

export type PackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export type FileRunStatus =
  | "pending"
  | "running"
  | "parsed"
  | "persisted"
  | "resolve_pending"
  | "resolved"
  | "failed_parse"
  | "failed_extract"
  | "failed_resolve"
  | "worker_crashed";

export interface DeferredResolveTask {
  filePath: string;
  packageId?: string | undefined;
  type: string;
  sourceName?: string | undefined;
  sourceModule?: string | undefined;
  targetHint?: string | undefined;
  scopeId?: string | undefined;
  entityId?: string | undefined;
  locLine?: number | undefined;
  locColumn?: number | undefined;
  retryCount: number;
  message: string;
  resolverStage: "package_local" | "cross_package" | "final_merge";
}

export interface PackageAnalysisSummary {
  packageId: string;
  packageName: string;
  runId: string;
  srcDir: string;
  dbPath?: string | undefined;
  filesTotal: number;
  filesSucceeded: number;
  filesFailed: number;
  resolveErrors: number;
  graph: JsonData;
  workspaceHandoff: WorkspaceAnalysisHandoff;
}

export interface WorkspacePackageDependency {
  name: string;
  version: string;
  isDev: boolean;
}

export interface WorkspacePackageExport {
  packageId: string;
  packageName: string;
  filePath: string;
  exportName: string;
  exportType: ComponentFileExport["type"];
  exportKind: ComponentFileExport["exportKind"];
  exportId: string;
  isDefault: boolean;
}

export interface WorkspaceExternalImport {
  packageId: string;
  packageName: string;
  filePath: string;
  sourceModule: string;
  sourcePackageName: string;
  sourceSubpath?: string | undefined;
  localName: string;
  importedName: string | null;
  importType: ComponentFileImport["type"];
  importKind: ComponentFileImport["importKind"];
}

export interface WorkspaceAnalysisHandoff {
  packageId: string;
  packageName: string;
  exports: WorkspacePackageExport[];
  externalImports: WorkspaceExternalImport[];
  dependencies: WorkspacePackageDependency[];
  deferredResolveTasks: DeferredResolveTask[];
  entryCandidates: string[];
}

export interface ResolvedCrossPackageRelation {
  fromPackageId: string;
  fromPackageName: string;
  toPackageId: string;
  toPackageName: string;
  sourceFilePath: string;
  targetFilePath: string;
  sourceLocalName: string;
  targetExportName: string;
  targetExportId: string;
  sourceImportId: string;
  relationKind: "import";
}

export type PhaseCallback = (phase: string, ms: number) => void;

export interface AnalyzeProjectOptions {
  cacheFile?: string | undefined;
  ignorePatterns?: string[] | undefined;
  sqlitePath?: string | undefined;
  monorepo?: boolean | undefined;
  centralSqlitePath?: string | undefined;
  packageDbDir?: string | undefined;
  packageConcurrency?: number | undefined;
  fileWorkerThreads?: number | undefined;
  analysisPaths?: string[] | undefined;
  /** When false, skip all SQLite persistence (pure in-memory analysis). Defaults to true. */
  persist?: boolean | undefined;
  onPhase?: PhaseCallback | undefined;
}

export interface FileTaskSuccessMessage {
  type: "file_success";
  filePath: string;
  result: ComponentFile;
  resolveTasks: ComponentDBResolve[];
  blockedVars?: Record<string, Record<string, ComponentFileVar>> | undefined;
}

export interface FileTaskErrorMessage {
  type: "file_parse_error" | "file_extract_error" | "worker_runtime_error";
  filePath: string;
  error: string;
  stack?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  parser?: string | undefined;
}

export type FileTaskMessage = FileTaskSuccessMessage | FileTaskErrorMessage;

export interface WorkerSessionConfig {
  srcDir: string;
  viteAliases: Record<string, string>;
  packageJsonData: Record<string, unknown>;
  runId?: string | undefined;
  tsConfigMap?: Record<string, boolean>;
}

export interface FileBatchTask {
  type: "analyze_files";
  filePaths: string[];
}

export interface FileBatchResultMessage {
  type: "batch_result";
  results: FileTaskMessage[];
  workerCpuMs?: number;
  serializeMs?: number;
  workerReadMs?: number;
  workerParseMs?: number;
  workerExtractMs?: number;
  workerTraverseMainMs?: number;
  workerUsageMs?: number;
}

export interface WorkerReadyMessage {
  type: "worker_ready";
}

export type AnalyzerWorkerRequest = FileBatchTask;
export type AnalyzerWorkerResponse = FileBatchResultMessage;
export type AnalyzerWorkerMessage = FileBatchResultMessage | WorkerReadyMessage;

export type AnalysisRunRecord = AnalysisRunRow;
export type FileRunStatusRecord = FileRunStatusRow;
export type FileAnalysisErrorRecord = FileAnalysisErrorRow;
export type ResolveErrorRecord = ResolveErrorRow;
export type CrossPackageResolveErrorRecord = CrossPackageResolveErrorRow;
export type WorkspacePackageRecord = WorkspacePackageRow;
export type WorkspaceRunRecord = WorkspaceRunRow;
export type PackageRunSummaryRecord = PackageRunSummaryRow;
export type DiscoveredWorkspacePackage = WorkspacePackageInfo;
