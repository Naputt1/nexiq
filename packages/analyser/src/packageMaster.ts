import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ComponentFile,
  JsonData,
  PackageRow,
  ComponentDBResolve,
} from "@nexiq/shared";
import { getTsConfigAliases, getViteAliases } from "./vite.ts";
import { ComponentDB } from "./db/componentDB.ts";
import type { PackageJson as PackageJsonStore } from "./db/packageJson.ts";
import { SqliteDB } from "./db/sqlite.ts";
import { WorkerPool } from "./workerPool.ts";
import { parseCode } from "./analyzer/utils.ts";
import type { File } from "@babel/types";
import { traverseFn } from "./utils/babel.ts";
import ImportDeclaration from "./analyzer/importDeclaration.ts";
import ExportNamedDeclaration from "./analyzer/exportNamedDeclaration.ts";
import ExportDefaultDeclaration from "./analyzer/exportDefaultDeclaration.ts";
import ExportAllDeclaration from "./analyzer/exportAllDeclaration.ts";
import FunctionDeclaration from "./analyzer/functionDeclaration.ts";
import VariableDeclarator from "./analyzer/variableDeclaration.ts";
import ClassDeclaration from "./analyzer/classDeclaration.ts";
import ClassMethod from "./analyzer/classMethod.ts";
import ClassProperty from "./analyzer/classProperty.ts";
import JSXElement from "./analyzer/JSXElement.ts";
import CallExpression from "./analyzer/callExpression.ts";
import ReturnStatement from "./analyzer/returnStatement.ts";
import ArrowFunctionExpression from "./analyzer/arrowFunctionExpression.ts";
import FunctionExpression from "./analyzer/functionExpression.ts";
import TSInterfaceDeclaration from "./analyzer/type/TSInterfaceDeclaration.ts";
import TSTypeAliasDeclaration from "./analyzer/type/TSTypeAliasDeclaration.ts";
import AssignmentExpression from "./analyzer/assignmentExpression.ts";
import BlockScope from "./analyzer/blockScope.ts";
import { extractFileUsages } from "./analyzer/usageCollector.ts";
import type {
  DeferredResolveTask,
  FileTaskMessage,
  FileRunStatus,
  PackageAnalysisSummary,
  WorkspaceAnalysisHandoff,
  WorkspaceExternalImport,
  WorkspacePackageDependency,
  WorkspacePackageExport,
} from "./types.ts";
import { resolvePath } from "./utils/path.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIN_FILES_FOR_WORKERS = 24;
const MIN_FILES_PER_WORKER = 8;

function createRunId(prefix: string, scope: string) {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}:${safeScope}:${Date.now()}`;
}

function getPackageRow(
  packageJson: PackageJsonStore,
  srcDir: string,
): PackageRow | undefined {
  const raw = packageJson.rawData as {
    name?: string;
    version?: string;
  };
  if (!raw.name || !raw.version) {
    return undefined;
  }
  return {
    id: `${raw.name}@${raw.version}`,
    name: raw.name,
    version: raw.version,
    path: srcDir,
  };
}

function getPackageNameFromModule(sourceModule: string) {
  if (sourceModule.startsWith("@")) {
    const parts = sourceModule.split("/");
    return parts.slice(0, 2).join("/");
  }
  return sourceModule.split("/")[0] || sourceModule;
}

function getPackageSubpath(sourceModule: string) {
  const packageName = getPackageNameFromModule(sourceModule);
  const remainder = sourceModule.slice(packageName.length).replace(/^\/+/, "");
  return remainder.length > 0 ? remainder : undefined;
}

function getEntryCandidates(rawData: Record<string, unknown>): string[] {
  const candidates = new Set<string>();
  const valueKeys = ["exports", "module", "main", "source"];
  for (const key of valueKeys) {
    const value = rawData[key];
    if (typeof value === "string") {
      candidates.add(value);
    }
  }

  candidates.add("src/index.tsx");
  candidates.add("src/index.ts");
  candidates.add("src/index.jsx");
  candidates.add("src/index.ts");
  candidates.add("index.tsx");
  candidates.add("index.ts");
  candidates.add("index.jsx");
  candidates.add("index.ts");

  return Array.from(candidates);
}

function toDeferredResolveTask(
  task: ComponentDBResolve,
  packageId?: string,
): DeferredResolveTask {
  switch (task.type) {
    case "comAddRender":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.tag,
        targetHint: task.parentId,
        entityId: task.kind,
        locLine: task.loc.line,
        locColumn: task.loc.column,
        retryCount: 1000,
        message: `Failed to resolve render target for ${task.tag}`,
        resolverStage: "package_local",
      };
    case "comAddHook":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.name,
        targetHint: task.hook,
        scopeId: task.parentId,
        locLine: task.loc.line,
        locColumn: task.loc.column,
        retryCount: 1000,
        message: `Failed to resolve hook ${task.hook}`,
        resolverStage: "package_local",
      };
    case "comResolveCallHook":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.hook,
        entityId: task.id,
        targetHint: task.hook,
        locLine: task.loc.line,
        locColumn: task.loc.column,
        retryCount: 1000,
        message: `Failed to resolve hook call ${task.hook}`,
        resolverStage: "package_local",
      };
    case "tsType":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.id,
        entityId: task.id,
        targetHint: task.id,
        retryCount: 1000,
        message: `Failed to resolve TypeScript type ${task.id}`,
        resolverStage: "package_local",
      };
    case "comPropsTsType":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.id,
        entityId: task.id,
        targetHint: task.id,
        retryCount: 1000,
        message: `Failed to resolve component props type ${task.id}`,
        resolverStage: "package_local",
      };
    case "comClassStateTsType":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.id,
        entityId: task.id,
        targetHint: task.id,
        retryCount: 1000,
        message: `Failed to resolve component class state type ${task.id}`,
        resolverStage: "package_local",
      };
    case "crossPackageImport":
      return {
        filePath: task.fileName,
        packageId,
        type: task.type,
        sourceName: task.localName,
        sourceModule: task.source,
        targetHint: task.importedName || task.localName,
        retryCount: 0,
        message:
          task.message ||
          `Failed to resolve cross-package import ${task.source}`,
        resolverStage: "cross_package",
      };
  }
}

function createStatusId(runId: string, filePath: string) {
  return `${runId}:${filePath}`;
}

export interface PackageMasterOptions {
  srcDir: string;
  viteConfigPath: string | null;
  files: string[];
  packageJson: PackageJsonStore;
  cacheData: JsonData | undefined;
  sqlite: SqliteDB | undefined;
  threads: number | undefined;
}

export class PackageMaster {
  private readonly srcDir: string;
  private readonly viteConfigPath: string | null;
  private readonly files: string[];
  private readonly packageJson: PackageJsonStore;
  private readonly cacheData: JsonData | undefined;
  private readonly sqlite: SqliteDB | undefined;
  private readonly threads: number;
  private readonly viteAliases: Record<string, string>;
  private readonly componentDB: ComponentDB;
  private readonly packageRow: PackageRow | undefined;
  private readonly runId: string;
  private readonly startedAt: string;
  private readonly packageName: string;

  constructor(options: PackageMasterOptions) {
    this.srcDir = options.srcDir;
    this.viteConfigPath = options.viteConfigPath;
    this.files = options.files;
    this.packageJson = options.packageJson;
    this.cacheData = options.cacheData;
    this.sqlite = options.sqlite;
    this.threads =
      options.threads ??
      (process.env.VITEST || process.env.SNAPSHOT ? 1 : os.cpus().length);
    this.viteAliases = {
      ...getViteAliases(this.viteConfigPath),
      ...getTsConfigAliases(this.srcDir),
    };
    this.componentDB = new ComponentDB({
      packageJson: this.packageJson,
      viteAliases: this.viteAliases,
      dir: this.srcDir,
      sqlite: this.sqlite,
    });
    this.packageRow = getPackageRow(this.packageJson, this.srcDir);
    this.packageName =
      this.packageRow?.name ||
      ((this.packageJson.rawData as { name?: string }).name ?? this.srcDir);
    this.runId = createRunId("run", this.packageRow?.id || this.srcDir);
    this.startedAt = new Date().toISOString();
  }

  private upsertPackageMetadata() {
    if (!this.sqlite) {
      return;
    }

    if (this.packageRow) {
      this.sqlite.insertPackage(this.packageRow);
      this.sqlite.clearPackageDependencies(this.packageRow.id);
      const raw = this.packageJson.rawData as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [dependency_name, dependency_version] of Object.entries(
        raw.dependencies || {},
      )) {
        this.sqlite.insertPackageDependency({
          package_id: this.packageRow.id,
          dependency_name,
          dependency_version,
          is_dev: false,
        });
      }
      for (const [dependency_name, dependency_version] of Object.entries(
        raw.devDependencies || {},
      )) {
        this.sqlite.insertPackageDependency({
          package_id: this.packageRow.id,
          dependency_name,
          dependency_version,
          is_dev: true,
        });
      }
    }
  }

  private startRun() {
    if (!this.sqlite) {
      return;
    }

    this.sqlite.beginRun({
      id: this.runId,
      package_id: this.packageRow?.id || null,
      src_dir: this.srcDir,
      status: "running",
      started_at: this.startedAt,
    });
  }

  private markFileStatus(
    filePath: string,
    status: FileRunStatus,
    overrides: {
      finishedAt?: string;
      fileHash?: string;
      fingerprint?: string;
      startedAt?: string;
    } = {},
  ) {
    if (!this.sqlite) {
      return;
    }

    this.sqlite.markFileStatus({
      id: createStatusId(this.runId, filePath),
      run_id: this.runId,
      package_id: this.packageRow?.id || null,
      file_path: filePath.replaceAll(path.sep, "/"),
      status,
      started_at: overrides.startedAt || this.startedAt,
      finished_at:
        overrides.finishedAt ??
        (status === "running" || status === "pending"
          ? null
          : new Date().toISOString()),
      file_hash: overrides.fileHash ?? null,
      fingerprint: overrides.fingerprint ?? null,
    });
  }

  private recordFileError(
    filePath: string,
    stage: "parse" | "extract" | "worker_runtime",
    error: string,
    options: {
      line?: number | undefined;
      column?: number | undefined;
      stack?: string | undefined;
      parser?: string | undefined;
      fileHash?: string | undefined;
      fingerprint?: string | undefined;
    } = {},
  ) {
    if (!this.sqlite) {
      return;
    }

    this.sqlite.recordFileAnalysisError({
      id: createRunId("file_error", `${this.runId}:${filePath}:${stage}`),
      run_id: this.runId,
      package_id: this.packageRow?.id || null,
      file_path: filePath.replaceAll(path.sep, "/"),
      stage,
      error_code: null,
      message: error,
      line: options.line ?? null,
      column: options.column ?? null,
      stack: options.stack ?? null,
      parser: options.parser ?? null,
      file_hash: options.fileHash ?? null,
      fingerprint: options.fingerprint ?? null,
    });
  }

  private recordResolveErrors(unresolvedTasks: ComponentDBResolve[]) {
    if (!this.sqlite) {
      return;
    }

    for (const task of unresolvedTasks) {
      const deferred = toDeferredResolveTask(task, this.packageRow?.id);
      // Build a stable, unique ID from the task's intrinsic fields so that
      // multiple tasks of the same type/file don't collide via Date.now().
      const discriminator = [
        deferred.filePath,
        deferred.type,
        deferred.sourceName ?? "",
        deferred.locLine ?? "",
        deferred.locColumn ?? "",
      ]
        .join(":")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
      this.sqlite.recordResolveError({
        id: `resolve_error:${this.runId}:${discriminator}`,
        run_id: this.runId,
        package_id: this.packageRow?.id || null,
        file_path: deferred.filePath,
        scope_id: deferred.scopeId ?? null,
        entity_id: deferred.entityId ?? null,
        relation_kind: deferred.type,
        source_name: deferred.sourceName ?? null,
        source_module: deferred.sourceModule ?? null,
        target_hint: deferred.targetHint ?? null,
        resolver_stage: deferred.resolverStage,
        message: deferred.message,
        loc_line: deferred.locLine ?? null,
        loc_column: deferred.locColumn ?? null,
        retry_count: deferred.retryCount,
      });
      this.markFileStatus(
        deferred.filePath.replace(/^\//, ""),
        "failed_resolve",
      );
    }
  }

  private runSingleThreadedAnalysis(fileName: string): ComponentFile {
    this.componentDB.clearStack();
    const code = fs.readFileSync(resolvePath(this.srcDir, fileName), "utf-8");
    const ast: File = parseCode(code);

    traverseFn(ast, {
      ImportDeclaration: ImportDeclaration(this.componentDB, fileName),
      ExportNamedDeclaration: ExportNamedDeclaration(
        this.componentDB,
        fileName,
      ),
      ExportAllDeclaration: ExportAllDeclaration(this.componentDB, fileName),
      ExportDefaultDeclaration: ExportDefaultDeclaration(
        this.componentDB,
        fileName,
      ),
      FunctionDeclaration: FunctionDeclaration(this.componentDB, fileName),
      ClassDeclaration: ClassDeclaration(this.componentDB, fileName),
      ClassExpression: ClassDeclaration(this.componentDB, fileName),
      ClassMethod: ClassMethod(this.componentDB, fileName),
      ClassPrivateMethod: ClassMethod(this.componentDB, fileName),
      ClassProperty: ClassProperty(this.componentDB, fileName),
      ClassPrivateProperty: ClassProperty(this.componentDB, fileName),
      VariableDeclarator: VariableDeclarator(this.componentDB, fileName),
      ReturnStatement: ReturnStatement(this.componentDB, fileName),
      ArrowFunctionExpression: ArrowFunctionExpression(
        this.componentDB,
        fileName,
      ),
      FunctionExpression: FunctionExpression(this.componentDB, fileName),
      ...JSXElement(this.componentDB, fileName),
      CallExpression: CallExpression(this.componentDB, fileName),
      TSTypeAliasDeclaration: TSTypeAliasDeclaration(
        this.componentDB,
        fileName,
      ),
      TSInterfaceDeclaration: TSInterfaceDeclaration(
        this.componentDB,
        fileName,
      ),
      AssignmentExpression: AssignmentExpression(this.componentDB, fileName),
      ...BlockScope(this.componentDB, fileName),
    });

    this.componentDB.clearStack();
    extractFileUsages(ast, this.componentDB, fileName);

    const file = this.componentDB.getFile(fileName);
    file.package_id =
      this.packageJson.getPackageIdForFile(
        resolvePath(this.srcDir, fileName),
      ) || undefined;

    const result = file.getData();
    return result;
  }

  private buildDependencies(): WorkspacePackageDependency[] {
    const raw = this.packageJson.rawData as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies: WorkspacePackageDependency[] = [];

    for (const [name, version] of Object.entries(raw.dependencies || {})) {
      dependencies.push({
        name,
        version,
        isDev: false,
      });
    }

    for (const [name, version] of Object.entries(raw.devDependencies || {})) {
      dependencies.push({
        name,
        version,
        isDev: true,
      });
    }

    return dependencies;
  }

  private buildWorkspaceHandoff(
    graphData: JsonData,
    unresolvedTasks: ComponentDBResolve[],
  ): WorkspaceAnalysisHandoff {
    const exports: WorkspacePackageExport[] = [];
    const externalImports: WorkspaceExternalImport[] = [];

    for (const file of Object.values(graphData.files)) {
      for (const fileExport of Object.values(file.export)) {
        exports.push({
          packageId: this.packageRow?.id || this.srcDir,
          packageName: this.packageName,
          filePath: file.path,
          exportName: fileExport.name,
          exportType: fileExport.type,
          exportKind: fileExport.exportKind,
          exportId: fileExport.id,
          isDefault: fileExport.type === "default",
        });
      }

      for (const fileImport of Object.values(file.import)) {
        if (
          fileImport.source.startsWith(".") ||
          fileImport.source.startsWith("/") ||
          fileImport.source.startsWith("node:")
        ) {
          continue;
        }

        externalImports.push({
          packageId: this.packageRow?.id || this.srcDir,
          packageName: this.packageName,
          filePath: file.path,
          sourceModule: fileImport.source,
          sourcePackageName: getPackageNameFromModule(fileImport.source),
          sourceSubpath: getPackageSubpath(fileImport.source),
          localName: fileImport.localName,
          importedName: fileImport.importedName,
          importType: fileImport.type,
          importKind: fileImport.importKind,
        });
      }
    }

    return {
      packageId: this.packageRow?.id || this.srcDir,
      packageName: this.packageName,
      exports,
      externalImports,
      dependencies: this.buildDependencies(),
      deferredResolveTasks: unresolvedTasks.map((task) =>
        toDeferredResolveTask(task, this.packageRow?.id),
      ),
      entryCandidates: getEntryCandidates(this.packageJson.rawData),
    };
  }

  private shouldUseWorkerPool(fileCount: number) {
    return (
      this.threads > 1 &&
      fileCount >= MIN_FILES_FOR_WORKERS &&
      this.threads * MIN_FILES_PER_WORKER <= fileCount * 2
    );
  }

  private getBatchSize(fileCount: number, workerCount: number) {
    const target = Math.ceil(fileCount / Math.max(workerCount * 2, 1));
    return Math.max(4, Math.min(100, target));
  }

  private processAnalyzedFileResult(
    filePath: string,
    message: FileTaskMessage,
    succeededFiles: string[],
  ) {
    if (message.type === "file_success") {
      const result = message.result;
      this.componentDB.addFile(filePath, result);
      this.componentDB.addResolveTasks(message.resolveTasks);
      this.markFileStatus(filePath, "parsed", {
        fileHash: result.hash,
        fingerprint: result.fingerPrint,
      });
      if (this.sqlite) {
        this.sqlite.saveFileResultsForRun(
          this.runId,
          {
            ...result,
            package_id: this.packageRow?.id,
          },
          this.packageRow?.id,
        );
      }
      succeededFiles.push(filePath);
      return false;
    }

    const stage =
      message.type === "file_parse_error"
        ? "parse"
        : message.type === "worker_runtime_error"
          ? "worker_runtime"
          : "extract";
    this.recordFileError(filePath, stage, message.error, {
      line: message.line,
      column: message.column,
      stack: message.stack,
      parser: message.parser,
    });
    this.markFileStatus(
      filePath,
      message.type === "worker_runtime_error"
        ? "worker_crashed"
        : stage === "parse"
          ? "failed_parse"
          : "failed_extract",
    );
    return true;
  }

  public async analyzePackage(): Promise<PackageAnalysisSummary> {
    this.upsertPackageMetadata();
    this.startRun();

    const filesToAnalyze: string[] = [];
    const succeededFiles: string[] = [];
    let filesFailed = 0;

    for (const fullfileName of this.files) {
      const fileNameWithSlash = `/${fullfileName}`;
      let fileCache: ComponentFile | undefined =
        this.cacheData?.files?.[fileNameWithSlash];
      if (!fileCache && this.sqlite) {
        fileCache = this.sqlite.getLatestSuccessfulFileResult(fullfileName);
      }

      if (!this.componentDB.addFile(fileNameWithSlash, fileCache)) {
        continue;
      }

      filesToAnalyze.push(fileNameWithSlash);
      this.markFileStatus(fullfileName, "pending");
    }

    if (this.shouldUseWorkerPool(filesToAnalyze.length)) {
      const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
      let workerScript = fileURLToPath(
        new URL(`./worker${ext}`, import.meta.url),
      );

      const distWorker = workerScript
        .replace("/src/", "/dist/")
        .replace(".ts", ".js");
      if (fs.existsSync(distWorker)) {
        workerScript = distWorker;
      }

      const pool = new WorkerPool(this.threads, workerScript, {
        srcDir: this.srcDir,
        viteAliases: this.viteAliases,
        packageJsonData: this.packageJson.rawData,
        runId: this.runId,
      });
      const batchSize = this.getBatchSize(filesToAnalyze.length, this.threads);
      const batches: string[][] = [];
      for (let index = 0; index < filesToAnalyze.length; index += batchSize) {
        batches.push(filesToAnalyze.slice(index, index + batchSize));
      }

      await Promise.all(
        batches.map(async (batch) => {
          for (const filePath of batch) {
            this.markFileStatus(filePath, "running");
          }
          try {
            const response = await pool.runTask({
              type: "analyze_files",
              filePaths: batch,
            });
            const resultByFile = new Map(
              response.results.map((item) => [item.filePath, item]),
            );

            const processBatch = this.sqlite?.db.transaction(() => {
              for (const filePath of batch) {
                const message = resultByFile.get(filePath);
                if (!message) {
                  filesFailed++;
                  this.recordFileError(
                    filePath,
                    "worker_runtime",
                    "Worker batch did not return a result for file",
                  );
                  this.markFileStatus(filePath, "worker_crashed");
                  continue;
                }
                if (
                  this.processAnalyzedFileResult(
                    filePath,
                    message,
                    succeededFiles,
                  )
                ) {
                  filesFailed++;
                }
              }
            });

            if (processBatch) {
              processBatch();
            } else {
              // Fallback if no sqlite (though unlikely in this path)
              for (const filePath of batch) {
                const message = resultByFile.get(filePath);
                if (message) {
                  this.processAnalyzedFileResult(
                    filePath,
                    message,
                    succeededFiles,
                  );
                }
              }
            }
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            for (const filePath of batch) {
              filesFailed++;
              this.recordFileError(filePath, "worker_runtime", err.message, {
                stack: err.stack,
              });
              this.markFileStatus(filePath, "worker_crashed");
            }
          }
        }),
      );

      await pool.terminate();
    } else {
      for (const filePath of filesToAnalyze) {
        this.markFileStatus(filePath, "running");
        try {
          const result = this.runSingleThreadedAnalysis(filePath);
          this.markFileStatus(filePath, "parsed", {
            fileHash: result.hash,
            fingerprint: result.fingerPrint,
          });
          if (this.sqlite) {
            this.sqlite.saveFileResultsForRun(
              this.runId,
              {
                ...result,
                package_id: this.packageRow?.id,
              },
              this.packageRow?.id,
            );
          }
          succeededFiles.push(filePath);
        } catch (error) {
          filesFailed++;
          const err = error as Error & {
            loc?: { line?: number; column?: number };
          };
          const stage = err.name === "SyntaxError" ? "parse" : "extract";
          this.recordFileError(filePath, stage, err.message, {
            line: err.loc?.line,
            column: err.loc?.column,
            stack: err.stack,
            parser: "babel",
          });
          this.markFileStatus(
            filePath,
            stage === "parse" ? "failed_parse" : "failed_extract",
          );
        }
      }
    }

    for (const filePath of succeededFiles) {
      this.markFileStatus(filePath, "resolve_pending");
    }

    const unresolvedTasks = this.componentDB.resolve();
    this.componentDB.resolveDependency();

    const graphData = this.componentDB.getData();

    if (this.sqlite) {
      this.sqlite.saveEdges(graphData.edges);

      const packages = this.packageJson.getAllLoadedPackages();
      for (const [dir, rawPkgJson] of packages) {
        if (!rawPkgJson.name || !rawPkgJson.version) {
          continue;
        }
        const pkgId = `${rawPkgJson.name}@${rawPkgJson.version}`;
        this.sqlite.insertPackage({
          id: pkgId,
          name: rawPkgJson.name,
          version: rawPkgJson.version,
          path: dir,
        });
      }

      for (const fullfileName of succeededFiles) {
        const result = this.componentDB.getFile(fullfileName).getData();
        result.package_id =
          this.packageJson.getPackageIdForFile(
            resolvePath(this.srcDir, fullfileName),
          ) || undefined;
        this.sqlite.saveFileResults({
          ...result,
          package_id: this.packageRow?.id,
        });
        this.markFileStatus(
          fullfileName,
          unresolvedTasks.length > 0 ? "resolved" : "resolved",
          {
            fileHash: result.hash,
            fingerprint: result.fingerPrint,
          },
        );
      }

      this.recordResolveErrors(unresolvedTasks);
      this.sqlite.finishRun(
        this.runId,
        unresolvedTasks.length > 0 ? "completed_with_errors" : "completed",
      );
    }

    return {
      packageId: this.packageRow?.id || this.srcDir,
      packageName: this.packageName,
      runId: this.runId,
      srcDir: this.srcDir,
      filesTotal: filesToAnalyze.length,
      filesSucceeded: succeededFiles.length,
      filesFailed,
      resolveErrors: unresolvedTasks.length,
      graph: graphData,
      workspaceHandoff: this.buildWorkspaceHandoff(graphData, unresolvedTasks),
    };
  }
}
