import os from "node:os";
import path from "node:path";
import type { JsonData } from "@nexiq/shared";
import { discoverWorkspacePackages } from "@nexiq/shared";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import { PackageJson } from "./db/packageJson.js";
import { SqliteDB } from "./db/sqlite.js";
import { PackageMaster } from "./packageMaster.js";
import type { AnalyzeProjectOptions, PackageAnalysisSummary } from "./types.js";
import { WorkspaceSqliteDB } from "./workspaceSqlite.js";

function getWorkspaceRunId(rootDir: string) {
  return `workspace:${rootDir.replace(/[^a-zA-Z0-9_-]/g, "_")}:${Date.now()}`;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function getPackageDbPath(packageDbDir: string, packagePath: string) {
  const safe = packagePath.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(packageDbDir, `${safe}.sqlite`);
}

export interface CentralMasterOptions extends AnalyzeProjectOptions {
  srcDir: string;
  cacheData?: JsonData;
}

export class CentralMaster {
  private readonly srcDir: string;
  private readonly options: CentralMasterOptions;

  constructor(options: CentralMasterOptions) {
    this.srcDir = options.srcDir;
    this.options = options;
  }

  public async analyzeWorkspace(): Promise<JsonData> {
    const packages = await discoverWorkspacePackages(this.srcDir);
    if (packages.length === 0) {
      const packageJson = new PackageJson(this.srcDir);
      const sqlite = this.options.sqlitePath
        ? new SqliteDB(this.options.sqlitePath)
        : undefined;
      try {
        const master = new PackageMaster({
          srcDir: this.srcDir,
          viteConfigPath: getViteConfig(this.srcDir),
          files: getFiles(this.srcDir, this.options.ignorePatterns || []),
          packageJson,
          cacheData: this.options.cacheData,
          sqlite,
          threads: this.options.fileWorkerThreads,
        });
        const summary = await master.analyzePackage();
        return summary.graph;
      } finally {
        sqlite?.close();
      }
    }

    const packageDbDir =
      this.options.packageDbDir || path.join(this.srcDir, ".nexiq", "packages");
    const centralDbPath =
      this.options.centralSqlitePath ||
      path.join(this.srcDir, ".nexiq", "workspace.sqlite");
    const workspaceDb = new WorkspaceSqliteDB(centralDbPath);
    const runId = getWorkspaceRunId(this.srcDir);
    const summaries: PackageAnalysisSummary[] = [];
    const packageNameMap = new Map(packages.map((pkg) => [pkg.name, pkg]));

    workspaceDb.beginWorkspaceRun({
      id: runId,
      root_dir: this.srcDir,
      status: "running",
      started_at: new Date().toISOString(),
    });

    await runWithConcurrency(
      packages,
      this.options.packageConcurrency || Math.max(1, Math.floor(os.cpus().length / 2)),
      async (pkg) => {
        const packageJson = new PackageJson(pkg.path);
        const dbPath = getPackageDbPath(packageDbDir, pkg.path);
        const sqlite = new SqliteDB(dbPath);
        try {
          const master = new PackageMaster({
            srcDir: pkg.path,
            viteConfigPath: getViteConfig(pkg.path),
            files: getFiles(pkg.path, this.options.ignorePatterns || []),
            packageJson,
            cacheData: undefined,
            sqlite,
            threads: this.options.fileWorkerThreads,
          });
          const summary = await master.analyzePackage();
          summaries.push({
            ...summary,
            dbPath,
          });
          const workspacePackage: {
            package_id: string;
            name: string;
            version?: string | undefined;
            path: string;
            db_path: string;
          } = {
            package_id: summary.packageId,
            name: pkg.name,
            path: pkg.path,
            db_path: dbPath,
          };
          if (pkg.version) {
            workspacePackage.version = pkg.version;
          }
          workspaceDb.upsertWorkspacePackage(workspacePackage);
          workspaceDb.insertPackageRunSummary({
            id: `${runId}:${summary.packageId}`,
            workspace_run_id: runId,
            package_id: summary.packageId,
            analysis_run_id: summary.runId,
            status: summary.filesFailed > 0 || summary.resolveErrors > 0 ? "completed_with_errors" : "completed",
            files_total: summary.filesTotal,
            files_succeeded: summary.filesSucceeded,
            files_failed: summary.filesFailed,
            resolve_errors: summary.resolveErrors,
          });
        } finally {
          sqlite.close();
        }
      },
    );

    const merged: JsonData = {
      src: this.srcDir,
      files: {},
      edges: [],
      resolve: [],
    };

    for (const summary of summaries) {
      Object.assign(merged.files, summary.graph.files);
      merged.edges.push(...summary.graph.edges);
      merged.resolve.push(...summary.graph.resolve);
    }

    for (const summary of summaries) {
      for (const file of Object.values(summary.graph.files)) {
        for (const fileImport of Object.values(file.import)) {
          if (fileImport.source.startsWith(".") || fileImport.source.startsWith("/")) {
            continue;
          }
          const importBase = fileImport.source.startsWith("@")
            ? fileImport.source.split("/").slice(0, 2).join("/")
            : (fileImport.source.split("/")[0] || fileImport.source);
          const targetPackage = packageNameMap.get(importBase);
          if (targetPackage) {
            const targetPackageJson = new PackageJson(targetPackage.path);
            const targetId =
              targetPackageJson.getPackageIdForFile(targetPackage.path) || targetPackage.path;
            const relation: {
              from_package_id: string;
              to_package_id: string;
              relation_kind: string;
              source_file_path: string;
              source_symbol: string;
              target_symbol?: string | undefined;
              run_id: string;
            } = {
              from_package_id: summary.packageId,
              to_package_id: targetId,
              relation_kind: "import",
              source_file_path: file.path,
              source_symbol: fileImport.localName,
              run_id: runId,
            };
            if (fileImport.importedName) {
              relation.target_symbol = fileImport.importedName;
            }
            workspaceDb.insertPackageRelation(relation);
            continue;
          }

          workspaceDb.insertCrossPackageResolveError({
            id: `${runId}:${summary.packageId}:${file.path}:${fileImport.localName}`,
            run_id: runId,
            from_package_id: summary.packageId,
            file_path: file.path,
            source_name: fileImport.localName,
            source_module: fileImport.source,
            relation_kind: "import",
            message: `Failed to resolve workspace package import ${fileImport.source}`,
          });
        }
      }
    }

    workspaceDb.finishWorkspaceRun(runId, "completed");
    workspaceDb.close();
    return merged;
  }
}
