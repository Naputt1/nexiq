import os from "node:os";
import path from "node:path";
import type { ComponentDBResolve, ComponentFile, JsonData } from "@nexiq/shared";
import { discoverWorkspacePackages } from "@nexiq/shared";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import { PackageJson } from "./db/packageJson.js";
import { SqliteDB } from "./db/sqlite.js";
import { PackageMaster } from "./packageMaster.js";
import type {
  AnalyzeProjectOptions,
  PackageAnalysisSummary,
  ResolvedCrossPackageRelation,
  WorkspaceAnalysisHandoff,
  WorkspaceExternalImport,
  WorkspacePackageExport,
} from "./types.js";
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

function getWorkspaceScopes(packageNames: string[]) {
  const scopes = new Set<string>();
  for (const packageName of packageNames) {
    if (packageName.startsWith("@")) {
      const [scope] = packageName.split("/");
      if (scope) {
        scopes.add(scope);
      }
    }
  }
  return scopes;
}

function getPackageNameFromModule(sourceModule: string) {
  if (sourceModule.startsWith("@")) {
    const parts = sourceModule.split("/");
    return parts.slice(0, 2).join("/");
  }
  return sourceModule.split("/")[0] || sourceModule;
}

function stripExtension(filePath: string) {
  return filePath.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
}

function toRootRelativePath(workspaceRoot: string, packageDir: string, filePath: string) {
  const withoutLeadingSlash = filePath.replace(/^\//, "");
  return `/${path.relative(workspaceRoot, path.join(packageDir, withoutLeadingSlash)).replaceAll(path.sep, "/")}`;
}

function createCrossPackageResolveTask(
  externalImport: WorkspaceExternalImport,
  message: string,
): ComponentDBResolve {
  return {
    type: "crossPackageImport",
    fileName: externalImport.filePath,
    source: externalImport.sourceModule,
    localName: externalImport.localName,
    importedName: externalImport.importedName,
    importType: externalImport.importType,
    importKind: externalImport.importKind,
    message,
  };
}

function getImportSymbolId(filePath: string, localName: string) {
  return `symbol:import:${filePath}:${localName}`;
}

function getCrossPackageErrorId(
  runId: string,
  externalImport: WorkspaceExternalImport,
) {
  return `${runId}:${externalImport.packageId}:${externalImport.filePath}:${externalImport.localName}:${externalImport.sourceModule}`;
}

function matchesEntryCandidate(filePath: string, entryCandidates: string[]) {
  const normalized = stripExtension(filePath.replace(/^\//, ""));
  return entryCandidates.some((candidate) => {
    const candidateNoExt = stripExtension(candidate.replace(/^\.\//, "").replace(/^\//, ""));
    return normalized === candidateNoExt || normalized.endsWith(`/${candidateNoExt}`);
  });
}

function matchesSubpath(filePath: string, subpath?: string) {
  if (!subpath) {
    return true;
  }

  const normalizedFile = stripExtension(filePath.replace(/^\//, ""));
  const normalizedSubpath = stripExtension(subpath.replace(/^\//, ""));
  return (
    normalizedFile.endsWith(`/${normalizedSubpath}`) ||
    normalizedFile.endsWith(`/${normalizedSubpath}/index`) ||
    normalizedFile.endsWith(`/src/${normalizedSubpath}`) ||
    normalizedFile.endsWith(`/src/${normalizedSubpath}/index`)
  );
}

function resolveImportAgainstExports(
  externalImport: WorkspaceExternalImport,
  targetExports: WorkspacePackageExport[],
  entryCandidates: string[],
): {
  relation?: ResolvedCrossPackageRelation;
  error?: string;
} {
  const scopedExports = targetExports.filter((candidate) =>
    matchesSubpath(candidate.filePath, externalImport.sourceSubpath),
  );

  let candidates = scopedExports;
  if (externalImport.importType === "default") {
    candidates = candidates.filter((candidate) => candidate.isDefault);
  } else if (externalImport.importType === "named" || externalImport.importType === "type") {
    const importedName = externalImport.importedName || externalImport.localName;
    candidates = candidates.filter((candidate) => candidate.exportName === importedName);
  } else {
    return {
      error: `Unsupported workspace import type ${externalImport.importType}`,
    };
  }

  if (candidates.length === 0) {
    return {
      error: `No matching export found for ${externalImport.sourceModule}`,
    };
  }

  if (candidates.length > 1) {
    const preferred = candidates.filter((candidate) =>
      matchesEntryCandidate(candidate.filePath, entryCandidates),
    );
    if (preferred.length === 1) {
      candidates = preferred;
    }
  }

  if (candidates.length > 1) {
    return {
      error: `Ambiguous export match for ${externalImport.sourceModule}`,
    };
  }

  const match = candidates[0]!;
  return {
    relation: {
      fromPackageId: externalImport.packageId,
      fromPackageName: externalImport.packageName,
      toPackageId: match.packageId,
      toPackageName: match.packageName,
      sourceFilePath: externalImport.filePath,
      targetFilePath: match.filePath,
      sourceLocalName: externalImport.localName,
      targetExportName: match.exportName,
      targetExportId: match.exportId,
      sourceImportId: getImportSymbolId(externalImport.filePath, externalImport.localName),
      relationKind: "import",
    },
  };
}

function cloneFile(file: ComponentFile): ComponentFile {
  return JSON.parse(JSON.stringify(file)) as ComponentFile;
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

  private mergePackageGraphs(
    summaries: PackageAnalysisSummary[],
    packageDirById: Map<string, string>,
  ) {
    const keyCounts = new Map<string, number>();
    for (const summary of summaries) {
      for (const key of Object.keys(summary.graph.files)) {
        keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
      }
    }

    const merged: JsonData = {
      src: this.srcDir,
      files: {},
      edges: [],
      resolve: [],
    };

    for (const summary of summaries) {
      const packageDir = packageDirById.get(summary.packageId) || summary.srcDir;
      for (const [fileKey, file] of Object.entries(summary.graph.files)) {
        const mergedKey =
          (keyCounts.get(fileKey) || 0) > 1
            ? toRootRelativePath(this.srcDir, packageDir, file.path)
            : fileKey;
        merged.files[mergedKey] = cloneFile(file);
      }
      merged.edges.push(...summary.graph.edges);
      merged.resolve.push(...summary.graph.resolve);
    }

    return merged;
  }

  public async analyzeWorkspace(): Promise<JsonData> {
    const packages = (await discoverWorkspacePackages(this.srcDir)).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
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
    const packageDirById = new Map<string, string>();
    const packageByName = new Map<string, { packageId: string; handoff: WorkspaceAnalysisHandoff; srcDir: string }>();
    const workspaceScopes = getWorkspaceScopes(packages.map((pkg) => pkg.name));

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
          packageDirById.set(summary.packageId, pkg.path);
          packageByName.set(summary.packageName, {
            packageId: summary.packageId,
            handoff: summary.workspaceHandoff,
            srcDir: pkg.path,
          });
          const workspacePackage: {
            package_id: string;
            name: string;
            version?: string | undefined;
            path: string;
            db_path: string;
          } = {
            package_id: summary.packageId,
            name: summary.packageName,
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
            status:
              summary.filesFailed > 0 || summary.resolveErrors > 0
                ? "completed_with_errors"
                : "completed",
            files_total: summary.filesTotal,
            files_succeeded: summary.filesSucceeded,
            files_failed: summary.filesFailed,
            resolve_errors: summary.resolveErrors,
          });

          for (const pkgExport of summary.workspaceHandoff.exports) {
            workspaceDb.insertPackageExport({
              id: `${runId}:${pkgExport.packageId}:${pkgExport.filePath}:${pkgExport.exportName}:${pkgExport.exportType}`,
              run_id: runId,
              package_id: pkgExport.packageId,
              package_name: pkgExport.packageName,
              file_path: pkgExport.filePath,
              export_name: pkgExport.exportName,
              export_type: pkgExport.exportType,
              export_kind: pkgExport.exportKind,
              export_id: pkgExport.exportId,
              is_default: pkgExport.isDefault,
            });
          }

          for (const externalImport of summary.workspaceHandoff.externalImports) {
            workspaceDb.insertDeferredExternalImport({
              id: `${runId}:${externalImport.packageId}:${externalImport.filePath}:${externalImport.localName}:${externalImport.sourceModule}`,
              run_id: runId,
              package_id: externalImport.packageId,
              package_name: externalImport.packageName,
              file_path: externalImport.filePath,
              source_module: externalImport.sourceModule,
              source_package_name: externalImport.sourcePackageName,
              source_subpath: externalImport.sourceSubpath,
              local_name: externalImport.localName,
              imported_name: externalImport.importedName,
              import_type: externalImport.importType,
              import_kind: externalImport.importKind,
            });
          }
        } finally {
          sqlite.close();
        }
      },
    );

    const merged = this.mergePackageGraphs(summaries, packageDirById);
    const crossPackageErrorsByPackage = new Map<string, number>();
    let totalCrossPackageErrors = 0;
    const totalPackageErrors = summaries.reduce(
      (count, summary) => count + summary.filesFailed + summary.resolveErrors,
      0,
    );

    for (const summary of summaries) {
      for (const externalImport of summary.workspaceHandoff.externalImports) {
        const targetPackageName = getPackageNameFromModule(externalImport.sourceModule);
        const targetPackage = packageByName.get(targetPackageName);
        const isWorkspaceCandidate =
          targetPackage != null ||
          (targetPackageName.startsWith("@") &&
            workspaceScopes.has(targetPackageName.split("/")[0] || ""));
        if (!isWorkspaceCandidate) {
          continue;
        }
        if (!targetPackage) {
          const message = `Failed to resolve workspace package import ${externalImport.sourceModule}`;
          workspaceDb.insertCrossPackageResolveError({
            id: getCrossPackageErrorId(runId, externalImport),
            run_id: runId,
            from_package_id: summary.packageId,
            file_path: externalImport.filePath,
            source_name: externalImport.localName,
            source_module: externalImport.sourceModule,
            relation_kind: "import",
            message,
          });
          merged.resolve.push(createCrossPackageResolveTask(externalImport, message));
          crossPackageErrorsByPackage.set(
            summary.packageId,
            (crossPackageErrorsByPackage.get(summary.packageId) || 0) + 1,
          );
          totalCrossPackageErrors++;
          continue;
        }

        const resolution = resolveImportAgainstExports(
          externalImport,
          targetPackage.handoff.exports,
          targetPackage.handoff.entryCandidates,
        );

        if (!resolution.relation) {
          const message = resolution.error || `Failed to resolve import ${externalImport.sourceModule}`;
          workspaceDb.insertCrossPackageResolveError({
            id: getCrossPackageErrorId(runId, externalImport),
            run_id: runId,
            from_package_id: summary.packageId,
            file_path: externalImport.filePath,
            source_name: externalImport.localName,
            source_module: externalImport.sourceModule,
            relation_kind: "import",
            message,
          });
          merged.resolve.push(createCrossPackageResolveTask(externalImport, message));
          crossPackageErrorsByPackage.set(
            summary.packageId,
            (crossPackageErrorsByPackage.get(summary.packageId) || 0) + 1,
          );
          totalCrossPackageErrors++;
          continue;
        }

        const relation = resolution.relation;
        workspaceDb.insertPackageRelation({
          from_package_id: relation.fromPackageId,
          to_package_id: relation.toPackageId,
          relation_kind: relation.relationKind,
          source_file_path: relation.sourceFilePath,
          target_file_path: relation.targetFilePath,
          source_symbol: relation.sourceLocalName,
          target_symbol: relation.targetExportName,
          run_id: runId,
        });
        merged.edges.push({
          from: relation.targetExportId,
          to: relation.sourceImportId,
          label: "import",
        });
      }
    }

    for (const summary of summaries) {
      const summaryId = `${runId}:${summary.packageId}`;
      const hasErrors =
        summary.filesFailed > 0 ||
        summary.resolveErrors > 0 ||
        (crossPackageErrorsByPackage.get(summary.packageId) || 0) > 0;
      workspaceDb.updatePackageRunSummaryStatus(
        summaryId,
        hasErrors ? "completed_with_errors" : "completed",
      );
    }

    workspaceDb.finishWorkspaceRun(
      runId,
      totalCrossPackageErrors > 0 || totalPackageErrors > 0
        ? "completed_with_errors"
        : "completed",
    );
    workspaceDb.close();
    return merged;
  }
}
