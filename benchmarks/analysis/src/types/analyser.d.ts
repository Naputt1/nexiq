// The @nexiq/analyser dist currently ships without declaration files
// (tsup's dts step fails on a pre-existing type error in src/db/fileDB.ts).
// Narrow ambient typing for the surface this benchmark actually consumes.
declare module "@nexiq/analyser" {
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
    persist?: boolean | undefined;
    onPhase?: PhaseCallback | undefined;
  }

  export interface JsonFile {
    id?: string;
    path?: string;
    package_id?: string;
    var?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface JsonData {
    src?: string;
    files?: Record<string, JsonFile>;
    edges?: unknown[];
    resolve?: unknown[];
    [key: string]: unknown;
  }

  export function analyzeProject(
    srcDir: string,
    cacheFileOrOptions?: string | AnalyzeProjectOptions,
    ignorePatterns?: string[],
    sqlitePath?: string,
  ): Promise<JsonData>;
}
