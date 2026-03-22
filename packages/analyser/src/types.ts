import type {
  AnalysisRunRow,
  CrossPackageResolveErrorRow,
  FileAnalysisErrorRow,
  FileRunStatusRow,
  JsonData,
  PackageRunSummaryRow,
  ResolveErrorRow,
  WorkspacePackageInfo,
  WorkspacePackageRow,
  WorkspaceRunRow,
} from "@nexiq/shared";

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
  runId: string;
  srcDir: string;
  dbPath?: string | undefined;
  filesTotal: number;
  filesSucceeded: number;
  filesFailed: number;
  resolveErrors: number;
  graph: JsonData;
}

export interface AnalyzeProjectOptions {
  cacheFile?: string | undefined;
  ignorePatterns?: string[] | undefined;
  sqlitePath?: string | undefined;
  monorepo?: boolean | undefined;
  centralSqlitePath?: string | undefined;
  packageDbDir?: string | undefined;
  packageConcurrency?: number | undefined;
  fileWorkerThreads?: number | undefined;
}

export interface FileTaskSuccessMessage {
  type: "file_success";
  filePath: string;
  result: import("@nexiq/shared").ComponentFile;
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

export type AnalysisRunRecord = AnalysisRunRow;
export type FileRunStatusRecord = FileRunStatusRow;
export type FileAnalysisErrorRecord = FileAnalysisErrorRow;
export type ResolveErrorRecord = ResolveErrorRow;
export type CrossPackageResolveErrorRecord = CrossPackageResolveErrorRow;
export type WorkspacePackageRecord = WorkspacePackageRow;
export type WorkspaceRunRecord = WorkspaceRunRow;
export type PackageRunSummaryRecord = PackageRunSummaryRow;
export type DiscoveredWorkspacePackage = WorkspacePackageInfo;
