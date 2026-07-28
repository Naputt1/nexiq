import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { minimatch } from "minimatch";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "@nexiq/analyser";
import { SqliteDB } from "@nexiq/analyser/db/sqlite";
import Database from "better-sqlite3";
import {
  type JsonData,
  type ProjectStatus,
  type GitStatus,
  type GitCommit,
  type GitFileDiff,
  type NexiqConfig,
  type SubProject,
  getDisplayName,
  parseRawDiff,
  type DatabaseData,
  type SymbolRow,
  type RenderRow,
  type UsageOccurrence,
} from "@nexiq/shared";
import {
  discoverWorkspacePackages,
  getWorkspacePatterns,
} from "@nexiq/analyser";
import type { Extension, GraphNodeDetail } from "@nexiq/extension-sdk";
import { pathToFileURL, fileURLToPath } from "node:url";
import { exec, execSync, fork } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit, type LogOptions } from "simple-git";
import tmp from "tmp";

const execAsync = promisify(exec);

/** Resolve and load an extension module from server's node_modules or global npm roots. */
async function loadExtensionModule(
  name: string,
): Promise<Record<string, unknown> | null> {
  // 1. Try bare import (resolves from server's own node_modules)
  try {
    return (await import(name)) as Record<string, unknown>;
  } catch {
    // fall through
  }

  // 2. Try global npm/pnpm roots
  const globalPaths: string[] = [
    "/usr/local/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
    path.join(os.homedir(), ".npm", "lib", "node_modules"),
    path.join(os.homedir(), ".config", "yarn", "global", "node_modules"),
    path.join(os.homedir(), "Library", "pnpm", "global", "node_modules"),
  ];

  // Dynamically add npm/pnpm global roots
  try {
    const npmRoot = execSync("npm root -g", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (npmRoot && !globalPaths.includes(npmRoot)) {
      globalPaths.push(npmRoot);
    }
  } catch {
    // fall through
  }
  try {
    const pnpmRoot = execSync("pnpm root -g", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (pnpmRoot && !globalPaths.includes(pnpmRoot)) {
      globalPaths.push(pnpmRoot);
    }
  } catch {
    // fall through
  }

  for (const globalPath of globalPaths) {
    const candidate = path.join(globalPath, name);
    const candidatePkgJson = path.join(candidate, "package.json");
    if (fs.existsSync(candidatePkgJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidatePkgJson, "utf-8"));
        const entry = pkg.module || pkg.main || "index.js";
        return (await import(
          pathToFileURL(path.join(candidate, entry)).href
        )) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }

  return null;
}

interface ExtendedSymbolRow extends SymbolRow {
  file: string;
  line: number;
  column: number;
  kind: string;
  type: string;
}

interface ExtendedRenderRow extends RenderRow {
  file: string;
  in_name: string | null;
}

export interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

export interface ProjectInfo {
  projectPath: string;
  subProject?: string;
  graph?: JsonData;
  subscription?: watcher.AsyncSubscription;
  extensions: Extension[];
  sqlitePath: string;
  db?: SqliteDB;
  nodeDetailCache: Map<string, GraphNodeDetail>;
}

export interface SymbolSearchResult {
  kind?: string;
  usage_kind?: string;
  name: string;
  file: string;
  loc: { line: number; column: number };
  props?: unknown[];
  in?: string; // Context where it's used
  usages?: SymbolSearchResult[]; // Grouped usages
}

export interface SymbolInfo {
  definitions: SymbolSearchResult[];
  externalUsages?: SymbolSearchResult[];
}

export interface FieldAccessResult {
  file: string;
  line: number;
  column: number;
  owner: string;
  accessPath: string[];
  displayLabel: string;
  context: string[];
}

export interface ComponentHierarchyNode {
  id: string;
  name: string;
  children: (ComponentHierarchyNode | { name: string; status: string })[];
  status?: string;
}

export class ProjectManager {
  private projects = new Map<string, ProjectInfo>();
  private pendingProjects = new Map<string, Promise<ProjectInfo>>();

  async openProject(
    projectPath: string,
    subProject?: string,
    subProjects?: string[],
  ): Promise<ProjectInfo> {
    const key = subProjects
      ? `${projectPath}:multi:${subProjects.join(",")}`
      : subProject
        ? `${projectPath}:${subProject}`
        : projectPath;
    if (this.projects.has(key)) {
      const project = this.projects.get(key)!;
      // Robustness check: if the database file is gone or the handle is broken, re-open
      let isHealthy = fs.existsSync(project.sqlitePath);
      if (isHealthy && project.db) {
        try {
          project.db.db.prepare("SELECT 1").get();
        } catch (e) {
          console.error(`Database handle broken for ${key}, re-opening...`, e);
          isHealthy = false;
        }
      }

      if (isHealthy) {
        return project;
      }
      console.error(`Project health check failed for ${key}, re-opening...`);
      this.projects.delete(key);
    }

    if (this.pendingProjects.has(key)) {
      console.error(
        `Project already opening: ${key}, returning pending promise`,
      );
      return this.pendingProjects.get(key)!;
    }

    const openPromise = (async () => {
      try {
        const result = await this._openProjectInternal(
          projectPath,
          subProject,
          subProjects,
        );
        this.projects.set(key, result);
        return result;
      } finally {
        this.pendingProjects.delete(key);
      }
    })();

    this.pendingProjects.set(key, openPromise);
    return openPromise;
  }

  private safeWriteFileSync(filePath: string, content: string | Buffer) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
    } catch (e) {
      console.error(
        `Failed to write to ${filePath}:`,
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  }

  private async forkAndAnalyze(
    srcDir: string,
    options: {
      cacheFile?: string;
      ignorePatterns?: string[];
      sqlitePath?: string;
      analysisPaths?: string[];
      monorepo?: boolean;
    },
  ): Promise<JsonData> {
    if (process.env.VITEST) {
      return analyzeProject(srcDir, options);
    }

    const lockPath = path.join(
      os.tmpdir(),
      `nexiq-analyze-${crypto.createHash("md5").update(srcDir).digest("hex")}.lock`,
    );
    await this.acquireAnalysisLock(lockPath);
    try {
      return await this.runAnalysisWorker(srcDir, options);
    } finally {
      this.releaseAnalysisLock(lockPath);
    }
  }

  private async acquireAnalysisLock(lockPath: string): Promise<void> {
    const staleTimeout = 60_000;
    for (let i = 0; i < 120; i++) {
      try {
        fs.mkdirSync(lockPath);
        return;
      } catch {
        // Lock exists — check if stale
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > staleTimeout) {
            fs.rmdirSync(lockPath);
            continue;
          }
        } catch {
          // Lock was released by another process between stat and rmdir
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Timed out waiting for analysis lock: ${lockPath}`);
  }

  private releaseAnalysisLock(lockPath: string) {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      // Already released by another process, or never existed
    }
  }

  private async runAnalysisWorker(
    srcDir: string,
    options: {
      cacheFile?: string;
      ignorePatterns?: string[];
      sqlitePath?: string;
      analysisPaths?: string[];
      monorepo?: boolean;
    },
  ): Promise<JsonData> {
    const workerPath = fileURLToPath(
      new URL("analysis-worker.js", import.meta.url),
    );
    const child = fork(workerPath, [], {
      stdio: ["pipe", "ignore", "pipe", "ipc"],
      execArgv: [],
    });

    const input = JSON.stringify({ srcDir, ...options });
    child.stdin!.write(input);
    child.stdin!.end();

    let stderrBuf = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => (stderrBuf += chunk));

    const exitPromise = new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => {
        if (code !== 0)
          reject(
            new Error(
              `Worker exited with code ${code}. Stderr: ${stderrBuf.slice(-2000)}`,
            ),
          );
        else resolve();
      });
      child.on("error", (e) => {
        (e as Error & { stderr?: string }).stderr = stderrBuf;
        reject(e);
      });
    });

    const timeout = 600_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exitPromise.finally(() => clearTimeout(timeoutHandle)),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            child.kill();
            reject(new Error(`Analysis timed out after ${timeout / 1000}s`));
          }, timeout);
        }),
      ]);
    } catch (e) {
      console.error(`Analysis failed for ${srcDir}:`, e);
      return { src: "", files: {}, edges: [], resolve: [] } as JsonData;
    }

    if (options.cacheFile && fs.existsSync(options.cacheFile)) {
      try {
        return JSON.parse(
          fs.readFileSync(options.cacheFile, "utf-8"),
        ) as JsonData;
      } catch (e) {
        console.error(`Failed to read cache file ${options.cacheFile}:`, e);
      }
    }

    return {} as JsonData;
  }

  /** If `p` is a file path, return its parent directory; otherwise return as-is. */
  private ensureDirectory(p: string): string {
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) return path.dirname(p);
      return p; // Already a directory
    } catch {
      // Path doesn't exist — walk up to find the first existing directory
      let current = p;
      for (let i = 0; i < 20; i++) {
        const parent = path.dirname(current);
        if (parent === current) break;
        try {
          const stat = fs.statSync(parent);
          if (stat.isDirectory()) return parent;
        } catch {
          /* empty */
        }
        current = parent;
      }
    }
    return p;
  }

  private async _openProjectInternal(
    projectPath: string,
    subProject?: string,
    subProjects?: string[],
  ): Promise<ProjectInfo> {
    // LLM sometimes passes a file path instead of project root; resolve to directory
    const safeProjectPath = this.ensureDirectory(projectPath);
    const { analysisPath, cacheRoot, cacheDir, cacheFile, sqlitePath } =
      this.getProjectStoragePaths(safeProjectPath, subProject, subProjects);

    const isMultiProject = subProjects && subProjects.length > 0;

    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    } catch (e) {
      console.warn(`Failed to create cache directory at ${cacheDir}:`, e);
    }

    // Load config
    const configPath = path.join(cacheRoot, "nexiq.config.json");
    let ignorePatterns: string[] | undefined;
    let extensionNames: string[] = [];

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(
          fs.readFileSync(configPath, "utf-8"),
        ) as NexiqConfig;
        ignorePatterns = config.ignorePatterns;
        extensionNames = config.extensions || [];
      } catch (e: unknown) {
        console.warn("Failed to load config for project", e);
      }
    }

    // Load extensions dynamically
    const extensions: Extension[] = [];
    for (const name of extensionNames) {
      try {
        const loaded = await loadExtensionModule(name);
        if (!loaded) {
          console.error(
            `Failed to load extension ${name}: not found in any resolve path`,
          );
          continue;
        }

        const extension = Object.values(loaded).find(
          (val: unknown): val is Extension =>
            !!(val && typeof val === "object" && "id" in val),
        );

        if (extension) {
          extensions.push(extension);
          console.error(`Loaded extension: ${extension.id} from ${name}`);
        }
      } catch (e: unknown) {
        console.error(
          `Failed to load extension ${name}:`,
          e instanceof Error ? e.message : "Unknown error",
        );
      }
    }

    console.error(
      `Analyzing project: ${cacheRoot} (Selection: ${analysisPath})`,
    );
    const graph = await this.forkAndAnalyze(
      subProjects && subProjects.length > 0 ? projectPath : analysisPath,
      {
        cacheFile,
        ignorePatterns,
        sqlitePath,
        analysisPaths: subProjects?.map((p) =>
          path.join(projectPath, p.replace(/^\/+/, "")),
        ),
        monorepo: subProjects && subProjects.length > 0 ? true : undefined,
      },
    );

    if (process.env.MODE !== "production") {
      this.safeWriteFileSync(cacheFile, JSON.stringify(graph, null, 2));
    }

    const projectInfo: ProjectInfo = {
      projectPath,
      subProject,
      graph,
      extensions,
      sqlitePath,
      db: new SqliteDB(sqlitePath),
      nodeDetailCache: new Map<string, GraphNodeDetail>(),
    };

    // For workspace/monorepo analysis, the sqlitePath contains the central DB
    // (workspace-level metadata like package_relations, not actual symbols).
    // Redirect project.db to the root package's DB for queries.
    try {
      const hasWorkspaceTables = projectInfo
        .db!.db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_packages'",
        )
        .get();
      if (hasWorkspaceTables) {
        const packageDbDir = path.join(cacheRoot, ".nexiq", "packages");
        const rootPkgDb = path.join(
          packageDbDir,
          `${analysisPath.replace(/[^a-zA-Z0-9_-]/g, "_")}.sqlite`,
        );
        if (fs.existsSync(rootPkgDb)) {
          projectInfo.db!.close();
          projectInfo.db = new SqliteDB(rootPkgDb);
          projectInfo.sqlitePath = rootPkgDb;
        }
      }
    } catch {
      // Not a workspace DB, use as-is
    }

    // Set up watcher
    try {
      const subscription = await watcher.subscribe(
        cacheRoot,
        (err, events) => {
          if (err) {
            console.error(`Watcher error for ${cacheRoot}:`, err);
            return;
          }

          const hasRelevantChange = events.some((event) => {
            const filePath = event.path;
            return (
              filePath.endsWith(".ts") ||
              filePath.endsWith(".tsx") ||
              filePath.endsWith(".js") ||
              filePath.endsWith(".jsx")
            );
          });

          if (hasRelevantChange) {
            console.error(`Changes detected in ${cacheRoot}, re-analyzing...`);
            analyzeProject(isMultiProject ? projectPath : analysisPath, {
              cacheFile,
              ignorePatterns,
              sqlitePath: projectInfo.sqlitePath,
              analysisPaths: subProjects?.map((p) =>
                path.join(projectPath, p.replace(/^\/+/, "")),
              ),
              monorepo: isMultiProject ? true : undefined,
            })
              .then((newGraph: JsonData) => {
                projectInfo.graph = newGraph;
                if (process.env.MODE !== "production") {
                  this.safeWriteFileSync(
                    cacheFile,
                    JSON.stringify(projectInfo.graph, null, 2),
                  );
                }

                if (projectInfo.db) projectInfo.db.close();
                projectInfo.db = new SqliteDB(projectInfo.sqlitePath);
                projectInfo.nodeDetailCache.clear();

                console.error(`Project ${cacheRoot} re-analyzed successfully.`);
              })
              .catch((reAnalyzeError: Error) => {
                console.error(
                  `Re-analysis failed for ${cacheRoot}:`,
                  reAnalyzeError,
                );
              });
          }
        },
        {
          ignore: [
            "node_modules",
            ".git",
            ".nexiq",
            "dist",
            "build",
            ".next",
            ".vite",
            ...(ignorePatterns || []).map((p) =>
              p.replace(/^\*\*\/|\/\*\*$/g, ""),
            ),
          ],
        },
      );
      projectInfo.subscription = subscription;
    } catch (watcherError) {
      console.error(
        `Failed to start watcher for ${analysisPath}:`,
        watcherError,
      );
    }

    return projectInfo;
  }

  async getNodeDetail(
    projectPath: string,
    nodeId: string,
  ): Promise<GraphNodeDetail | null> {
    const project = this.projects.get(projectPath);
    if (!project || !project.db) return null;

    if (project.nodeDetailCache.has(nodeId)) {
      return project.nodeDetailCache.get(nodeId)!;
    }

    // Try to find as symbol
    const symbolResult = project.db.db
      .prepare<
        [string, string, string],
        {
          id: string;
          name: string;
          pure_path: string;
          kind: string;
          componentType: string;
          line: number;
          column: number;
          data_json: string;
          fileName: string;
        }
      >(
        `SELECT 
          s.id, s.name, s.path as pure_path, e.kind, e.type as componentType, e.line, e."column", e.data_json, f.path as fileName
        FROM symbols s
        JOIN entities e ON s.entity_id = e.id
        JOIN scopes sc ON s.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.id = ? OR ('workspace:' || ? || ':' || s.id) = ?`,
      )
      .get(nodeId, project.subProject || "", nodeId);

    if (symbolResult) {
      const detail: GraphNodeDetail = {
        id: nodeId,
        name: symbolResult.name,
        fileName: symbolResult.fileName,
        projectPath: projectPath,
        loc: { line: symbolResult.line || 0, column: symbolResult.column || 0 },
        componentType: symbolResult.componentType,
        raw: symbolResult.data_json
          ? JSON.parse(symbolResult.data_json)
          : undefined,
      };
      project.nodeDetailCache.set(nodeId, detail);
      return detail;
    }

    // Try to find as render
    const renderResult = project.db.db
      .prepare<
        [string, string, string],
        {
          id: string;
          name: string;
          line: number;
          column: number;
          data_json: string;
          fileName: string;
        }
      >(
        `SELECT 
          r.id, r.tag as name, r.line, r."column", r.data_json, f.path as fileName
        FROM renders r
        JOIN files f ON r.file_id = f.id
        WHERE r.id = ? OR ('workspace:' || ? || ':' || r.id) = ?`,
      )
      .get(nodeId, project.subProject || "", nodeId);

    if (renderResult) {
      const detail: GraphNodeDetail = {
        id: nodeId,
        name: renderResult.name,
        fileName: renderResult.fileName,
        projectPath: projectPath,
        loc: { line: renderResult.line || 0, column: renderResult.column || 0 },
        raw: renderResult.data_json
          ? JSON.parse(renderResult.data_json)
          : undefined,
      };
      project.nodeDetailCache.set(nodeId, detail);
      return detail;
    }

    return null;
  }

  public async getDatabaseData(
    projectPath: string,
    subProject?: string,
  ): Promise<DatabaseData> {
    const project = await this.openProject(projectPath, subProject);
    return project.db!.getAllData();
  }

  getOpenProjectPaths(): string[] {
    return Array.from(this.projects.values()).map((p) => p.projectPath);
  }

  getProject(
    projectPath: string,
    subProject?: string,
  ): ProjectInfo | undefined {
    const key = subProject ? `${projectPath}:${subProject}` : projectPath;
    return this.projects.get(key);
  }

  getAllExtensions(): Extension[] {
    const all = new Map<string, Extension>();
    for (const project of this.projects.values()) {
      for (const ext of project.extensions) {
        all.set(ext.id, ext);
      }
    }
    return Array.from(all.values());
  }

  async findSymbol(
    projectPath: string,
    query: string,
    subProject?: string,
    strict: boolean = true,
    includeProps: boolean = false,
    includeUsages: boolean = false,
    exclude?: string[],
  ): Promise<SymbolInfo> {
    const project = await this.openProject(projectPath, subProject);

    const definitions_results: SymbolSearchResult[] = [];
    const externalUsages: SymbolSearchResult[] = [];

    const isExcluded = (filePath: string) => {
      if (!exclude || exclude.length === 0) return false;
      return exclude.some(
        (pattern) =>
          minimatch(filePath, pattern, { dot: true, nocase: true }) ||
          minimatch(path.basename(filePath), pattern, {
            dot: true,
            nocase: true,
          }),
      );
    };

    // 1. Find the symbol's definition(s)
    let definitions: ExtendedSymbolRow[];
    if (strict) {
      definitions = project
        .db!.db.prepare(
          `
          SELECT s.*, f.path as file, e.line, e.column, e.kind, e.type, e.data_json 
          FROM symbols s
          JOIN entities e ON s.entity_id = e.id
          JOIN scopes sc ON e.scope_id = sc.id
          JOIN files f ON sc.file_id = f.id
          WHERE s.name = ? and e.kind != 'import'
        `,
        )
        .all(query) as ExtendedSymbolRow[];
    } else {
      definitions = project
        .db!.db.prepare(
          `
          SELECT s.*, f.path as file, e.line, e.column, e.kind, e.type, e.data_json 
          FROM symbols s
          JOIN entities e ON s.entity_id = e.id
          JOIN scopes sc ON e.scope_id = sc.id
          JOIN files f ON sc.file_id = f.id
          WHERE (s.name = ? OR s.name LIKE ?) and e.kind != 'import'
        `,
        )
        .all(query, `%${query}%`) as ExtendedSymbolRow[];
    }

    for (const def of definitions) {
      if (isExcluded(def.file)) continue;

      const definition: SymbolSearchResult = {
        kind: def.kind,
        name: def.name,
        file: def.file,
        loc: { line: def.line || 0, column: def.column || 0 },
      };

      if (includeProps && def.data_json) {
        try {
          const data = JSON.parse(def.data_json);
          definition.props = data.props || [];
        } catch {
          definition.props = [];
        }
      }

      if (includeUsages) {
        definition.usages = [];
        // 2. Find usages via relations table (render edges)
        // Relations store use: from_id = rendered component's entity_id, to_id = parent component's entity_id
        // file_id is null in relations, so we resolve the file through the entity's scope
        const usages = project
          .db!.db.prepare(
            `
          SELECT DISTINCT
            f.path as file,
            e_to.name as in_name,
            e_to.line,
            e_to.column
          FROM relations rel
          JOIN entities e_to ON rel.to_id = e_to.id
          JOIN scopes sc_to ON e_to.scope_id = sc_to.id
          JOIN files f ON sc_to.file_id = f.id
          WHERE rel.from_id = ? AND rel.kind = 'render'
        `,
          )
          .all(def.entity_id) as Array<{
          file: string;
          in_name: string;
          line: number;
          column: number;
        }>;

        for (const usage of usages) {
          if (isExcluded(usage.file)) continue;

          definition.usages.push({
            kind: "render",
            name: def.name,
            file: usage.file,
            loc: { line: usage.line || 0, column: usage.column || 0 },
            in: usage.in_name || "unknown",
          });
        }
      }

      definitions_results.push(definition);
    }

    // 3. Query usage-render-call relations for cross-file JSX usage
    //    These are created by usageCollector.ts during analysis and always
    //    have correct cross-file data (unlike the renders table which misses
    //    entries created during the resolve phase)
    if (includeUsages) {
      const defFiles = new Set(definitions_results.map((d) => d.file));
      const results = project
        .db!.db.prepare(
          `
        SELECT DISTINCT rel.line, rel.column, rel.data_json,
               e_from.name as in_name,
               f.path as file
        FROM relations rel
        JOIN entities e_from ON rel.from_id = e_from.id
        JOIN scopes sc_from ON e_from.scope_id = sc_from.id
        JOIN files f ON sc_from.file_id = f.id
        WHERE rel.kind = 'usage-render-call'
          AND json_extract(rel.data_json, '$.displayLabel') = ?
      `,
        )
        .all(query) as {
        line: number;
        column: number;
        data_json: string | null;
        in_name: string;
        file: string;
      }[];

      for (const usage of results) {
        if (isExcluded(usage.file)) continue;
        if (defFiles.has(usage.file)) continue;

        let tag = query;
        if (usage.data_json) {
          try {
            const data = JSON.parse(usage.data_json);
            if (data.displayLabel) tag = data.displayLabel;
          } catch {
            /* empty */
          }
        }

        externalUsages.push({
          kind: "render",
          name: tag,
          file: usage.file,
          loc: { line: usage.line || 0, column: usage.column || 0 },
          in: usage.in_name || "unknown",
        });
      }
    }

    return { definitions: definitions_results, externalUsages };
  }

  async getSymbolUsagesWithContext(
    projectPath: string,
    query: string,
    subProject?: string,
    strict: boolean = true,
    contextLines: number = 2,
    exclude?: string[],
  ) {
    const symbolInfo = await this.findSymbol(
      projectPath,
      query,
      subProject,
      strict,
      false,
      true,
      exclude,
    );

    const allUsages: SymbolSearchResult[] = [];
    symbolInfo.definitions.forEach((def) => {
      if (def.usages) allUsages.push(...def.usages);
    });
    if (symbolInfo.externalUsages) {
      allUsages.push(...symbolInfo.externalUsages);
    }

    const fileCache = new Map<string, string[]>();
    const results = [];

    const analysisPath = this.getAnalysisPath(projectPath, subProject);

    for (const usage of allUsages) {
      const fullPath = path.resolve(
        analysisPath,
        usage.file.startsWith("/") ? usage.file.slice(1) : usage.file,
      );

      if (!fs.existsSync(fullPath)) continue;

      let lines = fileCache.get(fullPath);
      if (!lines) {
        lines = fs.readFileSync(fullPath, "utf-8").split("\n");
        fileCache.set(fullPath, lines);
      }

      const lineIdx = usage.loc.line - 1;
      const start = Math.max(0, lineIdx - contextLines);
      const end = Math.min(lines.length - 1, lineIdx + contextLines);
      const context = lines.slice(start, end + 1);

      results.push({
        file: usage.file,
        line: usage.loc.line,
        column: usage.loc.column,
        in: usage.in,
        kind: usage.kind,
        context,
      });
    }

    return results;
  }

  async getFieldAccesses(
    projectPath: string,
    query: string,
    fieldPath: string,
    subProject?: string,
    contextLines: number = 2,
  ): Promise<{
    symbol: string;
    fieldPath: string;
    results: FieldAccessResult[];
  }> {
    const project = await this.openProject(projectPath, subProject);
    const analysisPath = this.getAnalysisPath(projectPath, subProject);

    // Find all usage-read relations with matching field access
    const results: FieldAccessResult[] = [];
    const suffixPattern = `%.${fieldPath}`;

    const accesses = project
      .db!.db.prepare(
        `
      SELECT r.line, r.column, r.data_json
      FROM relations r
      WHERE r.kind = 'usage-read'
        AND (json_extract(r.data_json, '$.displayLabel') = ?
             OR json_extract(r.data_json, '$.displayLabel') LIKE ?)
    `,
      )
      .all(fieldPath, suffixPattern) as Array<{
      line: number;
      column: number;
      data_json: string | null;
    }>;

    // Look up entity IDs matching the query symbol name for owner filtering
    const queryEntityIds = new Set(
      (
        project
          .db!.db.prepare(
            `SELECT DISTINCT e.id FROM entities e JOIN symbols s ON s.entity_id = e.id WHERE s.name = ?`,
          )
          .all(query) as { id: string }[]
      ).map((r) => r.id),
    );

    const ownerMatched: FieldAccessResult[] = [];
    const otherResults: FieldAccessResult[] = [];

    for (const access of accesses) {
      if (!access.data_json) continue;
      const data = JSON.parse(access.data_json) as UsageOccurrence;
      const file = data.filePath;
      if (!file) continue;

      const result: FieldAccessResult = {
        file,
        line: access.line,
        column: access.column,
        owner: data.ownerKind || "unknown",
        accessPath: data.accessPath || [],
        displayLabel: data.displayLabel || "",
        context: [],
      };

      if (data.ownerId && queryEntityIds.has(data.ownerId)) {
        ownerMatched.push(result);
      } else {
        otherResults.push(result);
      }
    }

    // Use owner-matched results when available; otherwise fall back to all
    results.push(...(ownerMatched.length > 0 ? ownerMatched : otherResults));

    // Step 3: Read context lines if requested
    if (contextLines > 0) {
      const fileCache = new Map<string, string[]>();
      for (const result of results) {
        const fullPath = path.resolve(
          analysisPath,
          result.file.startsWith("/") ? result.file.slice(1) : result.file,
        );
        if (!fs.existsSync(fullPath)) continue;

        let lines = fileCache.get(fullPath);
        if (!lines) {
          lines = fs.readFileSync(fullPath, "utf-8").split("\n");
          fileCache.set(fullPath, lines);
        }

        const lineIdx = result.line - 1;
        const start = Math.max(0, lineIdx - contextLines);
        const end = Math.min(lines.length - 1, lineIdx + contextLines);
        result.context = lines.slice(start, end + 1);
      }
    }

    return { symbol: query, fieldPath, results };
  }

  async getPropDefinitions(
    projectPath: string,
    query: string,
    subProject?: string,
  ) {
    const symbolInfo = await this.findSymbol(
      projectPath,
      query,
      subProject,
      true, // strict
      true, // includeProps
      false, // includeUsages
    );

    const analysisPath = this.getAnalysisPath(projectPath, subProject);
    const results = [];

    for (const def of symbolInfo.definitions) {
      let props = def.props || [];
      if (props.length === 0 && def.file && analysisPath) {
        const fullPath = path.resolve(
          analysisPath,
          def.file.startsWith("/") ? def.file.slice(1) : def.file,
        );
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          props = extractPropsFromSource(content);
        }
      }
      results.push({ name: def.name, file: def.file, props });
    }

    return results;
  }

  async findFiles(projectPath: string, pattern: string, subProject?: string) {
    const project = await this.openProject(projectPath, subProject);

    const rows = project.db!.db.prepare("SELECT path FROM files").all() as {
      path: string;
    }[];
    const files =
      rows.length > 0
        ? rows.map((r) => r.path)
        : Object.keys(project.graph?.files || {});

    const isGlob = /[*?[\]]/.test(pattern);
    if (isGlob) {
      const results = files.filter(
        (p) =>
          minimatch(p, pattern, { dot: true, nocase: true }) ||
          minimatch(path.basename(p), pattern, { dot: true, nocase: true }),
      );
      return results.sort();
    }

    const regex = new RegExp(pattern, "i");
    const results = files.filter(
      (p) => regex.test(p) || regex.test(path.basename(p)),
    );
    return results.sort();
  }

  async getFileImports(
    projectPath: string,
    filePath: string,
    subProject?: string,
  ) {
    const project = await this.openProject(projectPath, subProject);

    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;

    const rows = project
      .db!.db.prepare(
        `SELECT e.name, e.data_json
         FROM entities e
         JOIN scopes s ON e.scope_id = s.id
         JOIN files f ON s.file_id = f.id
         WHERE f.path = ? AND e.kind = 'import'`,
      )
      .all(normalizedPath) as { name: string; data_json: string | null }[];

    if (rows.length > 0) {
      const imports: Record<string, unknown> = {};
      for (const row of rows) {
        if (row.name) {
          imports[row.name] = JSON.parse(row.data_json || "{}");
        }
      }
      return imports;
    }

    const file = project.graph?.files?.[normalizedPath];
    if (!file) throw new Error(`File not found: ${normalizedPath}`);
    return file.import;
  }

  async getComponentHierarchy(
    projectPath: string,
    componentName: string,
    subProject?: string,
    depth: number = 2,
  ): Promise<
    | {
        component: string;
        hierarchies: ComponentHierarchyNode[];
        renderedBy: { id: string; name: string; file: string }[];
      }
    | { error: string; hint?: string }
  > {
    const project = await this.openProject(projectPath, subProject);

    // Find the starting component(s)
    const startComponents = project
      .db!.db.prepare(
        `
        SELECT s.*, f.path as file, e.line, e.column, e.kind, e.type
        FROM symbols s
        JOIN entities e ON s.entity_id = e.id
        JOIN scopes sc ON e.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.name = ? AND e.kind = 'component'
      `,
      )

      .all(componentName) as ExtendedSymbolRow[];

    if (startComponents.length === 0) {
      return {
        error: `Component "${componentName}" not found.`,
        hint: `The component may be in an external monorepo package, or registered under a different name. Use 'get_symbol_info' with usages=false to find it, or 'grep_search' to locate references.`,
      };
    }

    const buildHierarchy = (
      symbolId: string,
      currentDepth: number,
      visited: Set<string>,
    ): ComponentHierarchyNode => {
      const sym = project
        .db!.db.prepare(`SELECT * FROM symbols WHERE id = ?`)
        .get(symbolId) as SymbolRow | undefined;
      if (!sym || currentDepth > depth || visited.has(symbolId)) {
        return {
          id: symbolId,
          name: sym?.name || "unknown",
          children: [],
          status: "limit-or-circular",
        };
      }
      visited.add(symbolId);

      const children = project
        .db!.db.prepare(
          `SELECT r.*, f.path as file FROM renders r JOIN files f ON r.file_id = f.id WHERE parent_entity_id = (SELECT entity_id FROM symbols WHERE id = ?)`,
        )
        .all(symbolId) as ExtendedRenderRow[];

      return {
        id: sym.id,
        name: sym.name,
        children: children.map((c) => {
          if (c.symbol_id) {
            return buildHierarchy(
              c.symbol_id,
              currentDepth + 1,
              new Set(visited),
            );
          }
          return {
            name: c.tag,
            status: "unresolved",
            kind: c.kind,
            index: c.render_index,
          };
        }),
      };
    };

    const renderedBy = project
      .db!.db.prepare(
        `
      SELECT DISTINCT s.id, s.name, f.path as file 
      FROM relations rel
      JOIN entities e_parent ON rel.to_id = e_parent.id
      LEFT JOIN symbols s ON s.entity_id = e_parent.id
      JOIN scopes sc ON e_parent.scope_id = sc.id
      JOIN files f ON sc.file_id = f.id
      WHERE rel.from_id = (SELECT entity_id FROM symbols WHERE name = ? LIMIT 1)
        AND rel.kind = 'render'
        AND e_parent.kind = 'component'
    `,
      )
      .all(componentName) as ExtendedSymbolRow[];

    return {
      component: componentName,
      hierarchies: startComponents.map((c) =>
        buildHierarchy(c.id, 0, new Set()),
      ),
      renderedBy: renderedBy.map((s) => ({
        id: s.id,
        name: s.name,
        file: s.file,
      })),
    };
  }

  async getRelations(
    projectPath: string,
    symbolId: string,
    subProject?: string,
    kind?: string,
    direction: "outgoing" | "incoming" | "both" = "both",
  ) {
    const project = await this.openProject(projectPath, subProject);

    const symbol = project
      .db!.db.prepare(
        `
      SELECT s.id, s.name, e.id as entity_id
      FROM symbols s
      JOIN entities e ON s.entity_id = e.id
      WHERE s.id = ?
    `,
      )
      .get(symbolId) as
      | { id: string; name: string; entity_id: string }
      | undefined;

    if (!symbol) {
      return { error: `Symbol "${symbolId}" not found.` };
    }

    const kindFilter = kind ? "AND r.kind = ?" : "";
    const kindParams = kind ? [kind] : [];

    const queryEdge = (selectCols: string, joinCol: string, dirLabel: string) =>
      project
        .db!.db.prepare(
          `
        SELECT r.kind, r.line, r.column, r.data_json,
               ${selectCols}.id as other_id,
               ${selectCols}.name as other_name,
               f.path as file,
               e_other.kind as other_kind,
               e_other.type as other_type
        FROM relations r
        JOIN entities e_other ON r.${joinCol} = e_other.id
        JOIN scopes sc_other ON e_other.scope_id = sc_other.id
        JOIN files f ON sc_other.file_id = f.id
        LEFT JOIN symbols ${selectCols} ON ${selectCols}.entity_id = e_other.id
        WHERE r.${dirLabel === "outgoing" ? "from_id" : "to_id"} = ? ${kindFilter}
        ORDER BY r.kind, r.line
      `,
        )
        .all(symbol.entity_id, ...kindParams) as {
        kind: string;
        line: number;
        column: number;
        data_json: string | null;
        other_id: string;
        other_name: string | null;
        file: string;
        other_kind: string;
        other_type: string;
      }[];

    const outgoing =
      direction !== "incoming"
        ? queryEdge("s_to", "to_id", "outgoing").map((e) => ({
            kind: e.kind,
            toName: e.other_name || "anonymous",
            toId: e.other_id,
            toKind: e.other_kind,
            toType: e.other_type,
            file: e.file,
            line: e.line,
            column: e.column,
          }))
        : [];

    const incoming =
      direction !== "outgoing"
        ? queryEdge("s_from", "from_id", "incoming").map((e) => ({
            kind: e.kind,
            fromName: e.other_name || "anonymous",
            fromId: e.other_id,
            fromKind: e.other_kind,
            fromType: e.other_type,
            file: e.file,
            line: e.line,
            column: e.column,
          }))
        : [];

    return {
      symbolId: symbol.id,
      symbolName: symbol.name,
      totalOutgoing: outgoing.length,
      totalIncoming: incoming.length,
      ...(outgoing.length > 0 ? { outgoing } : {}),
      ...(incoming.length > 0 ? { incoming } : {}),
    };
  }

  async traceDataFlow(
    projectPath: string,
    componentName: string,
    fieldPath: string,
    subProject?: string,
    maxDepth: number = 3,
  ) {
    const project = await this.openProject(projectPath, subProject);

    const findEntitiesStmt = project.db!.db.prepare(`
      SELECT e.id, s.id as symbol_id, f.path as file
      FROM entities e
      JOIN scopes sc ON e.scope_id = sc.id
      JOIN files f ON sc.file_id = f.id
      LEFT JOIN symbols s ON s.entity_id = e.id
      WHERE s.name = ? AND e.kind = 'component'
    `);

    const findParentStmt = project.db!.db.prepare(`
      SELECT DISTINCT rel.to_id as parent_entity_id,
             e_parent.name as parent_name,
             f_parent.path as parent_file
      FROM relations rel
      JOIN entities e_parent ON rel.to_id = e_parent.id
      JOIN scopes sc_parent ON e_parent.scope_id = sc_parent.id
      JOIN files f_parent ON sc_parent.file_id = f_parent.id
      WHERE rel.from_id = ? AND rel.kind = 'render'
    `);

    const findParentByRenderStmt = project.db!.db.prepare(`
      SELECT DISTINCT e_from.id as parent_entity_id,
             e_from.name as parent_name,
             f_from.path as parent_file
      FROM relations rel
      JOIN entities e_from ON rel.from_id = e_from.id
      JOIN scopes sc_from ON e_from.scope_id = sc_from.id
      JOIN files f_from ON sc_from.file_id = f_from.id
      WHERE rel.kind = 'usage-render-call'
        AND json_extract(rel.data_json, '$.displayLabel') = ?
    `);

    const findRenderStmt = project.db!.db.prepare(`
      SELECT r.*
      FROM renders r
      WHERE r.parent_entity_id = ? AND r.tag = ?
      LIMIT 1
    `);

    const hasPropStmt = project.db!.db.prepare(`
      SELECT 1 FROM entities e
      JOIN scopes sc ON e.scope_id = sc.id
      WHERE sc.entity_id = ? AND e.kind = 'prop' AND e.name = ?
      LIMIT 1
    `);

    interface TraceResult {
      chain: {
        step: number;
        component: string;
        file: string;
        renderLoc?: { line: number; column: number };
        expression?: { type: string; name: string; refType?: string };
      }[];
      depth: number;
      fieldFound: boolean;
    }

    const entities = findEntitiesStmt.all(componentName) as {
      id: string;
      symbol_id: string;
      file: string;
    }[];
    if (entities.length === 0) {
      return { error: `Component "${componentName}" not found.` };
    }

    const traceFrom = (startEntity: {
      id: string;
      file: string;
    }): TraceResult => {
      const chain: TraceResult["chain"] = [];
      let currentEntityId = startEntity.id;
      let currentEntityFile = startEntity.file;
      let currentName = componentName;
      let currentField = fieldPath;
      let currentDepth = 0;
      let fieldFound = false;

      while (currentDepth < maxDepth) {
        const parents = findParentStmt.all(currentEntityId) as {
          parent_entity_id: string;
          parent_name: string;
          parent_file: string;
        }[];

        let allParents = [...parents];

        // Fallback: renders table when graph edges don't resolve
        if (allParents.length === 0) {
          const renderParents = findParentByRenderStmt.all(currentName) as {
            parent_entity_id: string;
            parent_name: string;
            parent_file: string;
          }[];
          allParents = renderParents.filter(
            (p) => p.parent_file !== currentEntityFile,
          );
        }

        if (allParents.length === 0) {
          chain.push({
            step: currentDepth + 1,
            component: currentName,
            file: currentEntityFile,
          });
          break;
        }

        let found = false;
        for (const parent of allParents) {
          const renders = findRenderStmt.all(
            parent.parent_entity_id,
            currentName,
          ) as RenderRow[];
          for (const render of renders) {
            if (!render.data_json) continue;
            const data = JSON.parse(render.data_json);
            const deps: Array<{
              name: string;
              value: { type: string; name: string; refType?: string };
              valueId?: string;
            }> = data.dependencies || [];
            const dep = deps.find((d) => d.name === currentField);
            if (dep) {
              fieldFound = true;
              const expression = {
                type: dep.value.type,
                name: dep.value.name,
                refType: dep.value.refType,
              };
              chain.push({
                step: currentDepth + 1,
                component: currentName,
                file: currentEntityFile,
                renderLoc: {
                  line: render.line || 0,
                  column: render.column || 0,
                },
                expression,
              });

              // Recurse to parent if expression references a parent prop
              if (
                expression.type === "ref" &&
                expression.refType === "named" &&
                currentDepth + 1 < maxDepth
              ) {
                const hasProp = hasPropStmt.get(
                  parent.parent_entity_id,
                  expression.name,
                ) as { "1": number } | undefined;
                if (hasProp) {
                  currentEntityId = parent.parent_entity_id;
                  currentEntityFile = parent.parent_file;
                  currentName = parent.parent_name;
                  currentField = expression.name;
                  currentDepth++;
                  found = true;
                  break;
                }
              }
              found = true;
              break;
            }
          }
          if (found) break;
        }

        if (!found) {
          chain.push({
            step: currentDepth + 1,
            component: currentName,
            file: currentEntityFile,
          });
        }
        break;
      }

      return { chain, depth: currentDepth, fieldFound };
    };

    const results = entities.map((e) => traceFrom(e));
    results.sort((a, b) => {
      if (a.fieldFound !== b.fieldFound) return b.fieldFound ? 1 : -1;
      return b.depth - a.depth;
    });

    const best = results[0] || { chain: [], depth: 0, fieldFound: false };

    return {
      component: componentName,
      field: fieldPath,
      chain: best.chain,
      note:
        best.chain.length > 0
          ? "Further resolution may require reading source at the final render location."
          : "No render parent chain found for this component.",
    };
  }

  async getWorkspaceInfo(projectPath: string, subProject?: string) {
    const analysisRoot = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const workspaceDbPath = path.join(
      analysisRoot,
      ".nexiq",
      "workspace.sqlite",
    );

    if (!fs.existsSync(workspaceDbPath)) {
      // Also check for a central DB in the cache directory
      const cacheDbPath = path.join(
        analysisRoot,
        ".nexiq",
        "cache",
        "central.sqlite",
      );
      if (fs.existsSync(cacheDbPath)) {
        return this._queryWorkspaceDb(cacheDbPath);
      }
      return {
        isMonorepo: false,
        packages: [],
        note: "No workspace database found. This may not be a monorepo.",
      };
    }

    return this._queryWorkspaceDb(workspaceDbPath);
  }

  private _queryWorkspaceDb(workspaceDbPath: string) {
    const db = new Database(workspaceDbPath, { readonly: true });
    try {
      const packages = db
        .prepare(
          `
        SELECT wp.package_id, wp.name, wp.path, wp.db_path,
               COALESCE(prs.files_total, 0) as file_count,
               COALESCE(prs.status, 'unknown') as analysis_status
        FROM workspace_packages wp
        LEFT JOIN package_run_summaries prs ON wp.package_id = prs.package_id
        ORDER BY wp.name
      `,
        )
        .all() as Array<{
        package_id: string;
        name: string;
        path: string;
        db_path: string;
        file_count: number;
        analysis_status: string;
      }>;

      return {
        isMonorepo: packages.length > 0,
        packages: packages.map((p) => ({
          packageId: p.package_id,
          name: p.name,
          path: p.path,
          fileCount: p.file_count,
          analysisStatus: p.analysis_status,
        })),
      };
    } finally {
      db.close();
    }
  }

  async searchWorkspaceSymbol(
    projectPath: string,
    symbol: string,
    subProject?: string,
    packageName?: string,
  ) {
    const workspaceDbPath = this._findWorkspaceDb(projectPath, subProject);
    if (!workspaceDbPath) {
      return {
        found: false,
        matches: [],
        note: "No workspace database found. This project may not have been analyzed as a monorepo.",
      };
    }

    const db = new Database(workspaceDbPath, { readonly: true });
    try {
      const packageFilter = packageName ? "AND package_name = ?" : "";
      const packageParams = packageName ? [packageName] : [];

      const matches = db
        .prepare(
          `
        SELECT export_name, export_type, export_kind, package_name, file_path, is_default
        FROM package_export_index
        WHERE export_name = ? OR export_name LIKE ? ${packageFilter}
        ORDER BY package_name, file_path
      `,
        )
        .all(symbol, `%${symbol}%`, ...packageParams) as Array<{
        export_name: string;
        export_type: string;
        export_kind: string;
        package_name: string;
        file_path: string;
        is_default: number;
      }>;

      return {
        found: matches.length > 0,
        totalPackagesSearched: db
          .prepare("SELECT COUNT(*) as cnt FROM workspace_packages")
          .get() as { cnt: number },
        matches: matches.map((m) => ({
          exportName: m.export_name,
          exportType: m.export_type,
          exportKind: m.export_kind,
          packageName: m.package_name,
          filePath: m.file_path,
          isDefault: m.is_default === 1,
        })),
      } as {
        found: boolean;
        matches: unknown[];
        totalPackagesSearched: { cnt: number };
      };
    } finally {
      db.close();
    }
  }

  async getPackageImports(
    projectPath: string,
    filePath: string,
    subProject?: string,
  ) {
    const project = await this.openProject(projectPath, subProject);
    const workspaceDbPath = this._findWorkspaceDb(projectPath, subProject);

    // Get local imports from the per-package DB
    const localImports = project
      .db!.db.prepare(
        `
      SELECT e.name, e.data_json, e.line, e.column
      FROM entities e
      JOIN scopes sc ON e.scope_id = sc.id
      JOIN files f ON sc.file_id = f.id
      WHERE f.path = ? AND e.kind = 'import'
      ORDER BY e.line
    `,
      )
      .all(filePath) as Array<{
      name: string;
      data_json: string | null;
      line: number;
      column: number;
    }>;

    const imports = localImports.map((imp) => {
      const data = imp.data_json ? JSON.parse(imp.data_json) : {};
      return {
        localName: imp.name,
        importedName: data.importedName || null,
        sourceModule: data.source || null,
        importType: data.type || "named",
        line: imp.line,
        column: imp.column,
      } as Record<string, unknown>;
    });

    // Enrich with workspace info if available
    if (workspaceDbPath) {
      const db = new Database(workspaceDbPath, { readonly: true });
      try {
        const deferred = db
          .prepare(
            `
          SELECT source_module, source_package_name, source_subpath,
                 imported_name, import_type, local_name
          FROM deferred_external_imports
          WHERE file_path = ?
        `,
          )
          .all(filePath) as Array<{
          source_module: string;
          source_package_name: string;
          source_subpath: string | null;
          imported_name: string | null;
          import_type: string;
          local_name: string;
        }>;

        if (deferred.length > 0) {
          const deferredMap = new Map(deferred.map((d) => [d.local_name, d]));
          for (const imp of imports) {
            const match = deferredMap.get(imp.localName as string);
            if (match) {
              (imp as Record<string, unknown>).resolvedToPackage =
                match.source_package_name;
              (imp as Record<string, unknown>).sourceSubpath =
                match.source_subpath;
            }
          }
        }
      } finally {
        db.close();
      }
    }

    return {
      file: filePath,
      totalImports: imports.length,
      imports,
    };
  }

  private _findWorkspaceDb(
    projectPath: string,
    subProject?: string,
  ): string | null {
    const analysisRoot = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const candidates = [
      path.join(analysisRoot, ".nexiq", "workspace.sqlite"),
      path.join(analysisRoot, ".nexiq", "cache", "central.sqlite"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  async getSymbolLocation(
    projectPath: string,
    query: string,
    subProject?: string,
  ): Promise<
    {
      id: string;
      name: string;
      file: string;
      loc: { line: number; column: number };
      kind: string;
      type: string;
    }[]
  > {
    const project = await this.openProject(projectPath, subProject);

    const symbols = project
      .db!.db.prepare(
        `
        SELECT s.id, s.name, f.path as file, e.line, e.column, e.kind, e.type 
        FROM symbols s
        JOIN entities e ON s.entity_id = e.id
        JOIN scopes sc ON e.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.name = ?
      `,
      )

      .all(query) as ExtendedSymbolRow[];
    return symbols.map((s) => ({
      id: s.id,
      name: s.name,
      file: s.file,
      loc: { line: s.line || 0, column: s.column || 0 },
      kind: s.kind,
      type: s.type, // Keep database type, UI expects this as symbol type
    }));
  }

  async getSymbolContent(
    projectPath: string,
    query: string,
    subProject?: string,
    contextLines: number = 0,
  ): Promise<
    | {
        id: string;
        name: string;
        file: string;
        loc: { line: number; column: number };
        kind: string;
        type: string;
        content?: string;
        error?: string;
      }[]
    | { error: string }
  > {
    const locations = await this.getSymbolLocation(
      projectPath,
      query,
      subProject,
    );
    if (locations.length === 0)
      return { error: `Symbol "${query}" not found.` };

    const analysisPath = this.getAnalysisPath(projectPath, subProject);
    const results: {
      id: string;
      name: string;
      file: string;
      loc: { line: number; column: number };
      kind: string;
      type: string;
      content?: string;
      error?: string;
    }[] = [];

    for (const locInfo of locations) {
      const fullPath = path.resolve(
        analysisPath,
        locInfo.file.startsWith("/") ? locInfo.file.slice(1) : locInfo.file,
      );
      if (!fs.existsSync(fullPath)) {
        results.push({ ...locInfo, error: "File not found on disk." });
        continue;
      }

      const fileContent = fs.readFileSync(fullPath, "utf-8");
      const lines = fileContent.split("\n");
      const lineIdx = locInfo.loc.line - 1;

      // Scan backward from symbol to find preceding interface/type declarations
      const scanBoundary = Math.max(0, lineIdx - contextLines);
      let contentStart = scanBoundary;
      for (let i = lineIdx - 1; i >= scanBoundary; i--) {
        const line = lines[i]!.trim();
        if (
          line.startsWith("export interface") ||
          line.startsWith("interface") ||
          line.startsWith("export type") ||
          line.startsWith("type ")
        ) {
          contentStart = i;
        }
      }

      const end = Math.min(lines.length, lineIdx + contextLines + 1);

      results.push({
        ...locInfo,
        content: lines.slice(contentStart, end).join("\n"),
      });
    }

    return results;
  }

  async addLabel(
    projectPath: string,
    id: string,
    label: string,
    subProject?: string,
  ): Promise<string[]> {
    const project = await this.openProject(projectPath, subProject);
    const graph = project.graph!;
    if (!graph.labels) graph.labels = {};
    if (!graph.labels[id]) graph.labels[id] = [];
    if (!graph.labels[id].includes(label)) {
      graph.labels[id].push(label);
      this._saveCache(project);
    }
    return graph.labels[id];
  }

  async removeLabel(
    projectPath: string,
    id: string,
    label: string,
    subProject?: string,
  ): Promise<string[]> {
    const project = await this.openProject(projectPath, subProject);
    if (!project.graph || !project.graph.labels) return [];
    if (project.graph.labels[id]) {
      project.graph.labels[id] = project.graph.labels[id].filter(
        (l) => l !== label,
      );
      if (project.graph.labels[id].length === 0)
        delete project.graph.labels[id];
      this._saveCache(project);
    }
    return project.graph.labels[id] || [];
  }

  async getLabels(
    projectPath: string,
    subProject?: string,
  ): Promise<Record<string, string[]>> {
    const project = await this.openProject(projectPath, subProject);
    return project.graph?.labels || {};
  }

  async findEntitiesByLabel(
    projectPath: string,
    label: string,
    subProject?: string,
  ): Promise<string[]> {
    const project = await this.openProject(projectPath, subProject);
    if (!project.graph || !project.graph.labels) return [];
    const ids: string[] = [];
    for (const [id, labels] of Object.entries(project.graph.labels)) {
      if (labels.includes(label)) ids.push(id);
    }
    return ids;
  }

  async listDirectory(
    projectPath: string,
    dirPath: string,
    subProject?: string,
  ) {
    const project = await this.openProject(projectPath, subProject);
    const normalizedDir = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;

    const allFiles: string[] = [];
    const rows = project
      .db!.db.prepare(
        `SELECT path FROM files WHERE path LIKE ? || '%' ORDER BY path`,
      )
      .all(normalizedDir) as { path: string }[];
    if (rows.length > 0) {
      allFiles.push(...rows.map((r) => r.path));
    } else {
      const graphFiles = project.graph?.files;
      if (graphFiles) {
        for (const filePath of Object.keys(graphFiles)) {
          if (filePath.startsWith(normalizedDir)) {
            allFiles.push(filePath);
          }
        }
      }
    }

    const filesInDir = new Set<string>();
    const subDirs = new Set<string>();
    for (const filePath of allFiles) {
      const relative = filePath.slice(normalizedDir.length).replace(/^\//, "");
      const parts = relative.split("/");
      if (parts.length === 1 && parts[0] !== "") filesInDir.add(parts[0]!);
      else if (parts.length > 1) subDirs.add(parts[0]!);
    }
    return {
      directories: Array.from(subDirs).sort(),
      files: Array.from(filesInDir).sort(),
    };
  }

  async getFileOutline(
    projectPath: string,
    filePath: string,
    subProject?: string,
  ) {
    const project = await this.openProject(projectPath, subProject);
    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;

    const rows = project
      .db!.db.prepare(
        `SELECT e.id, e.name, e.kind, e.type, e.line
         FROM entities e
         JOIN scopes s ON e.scope_id = s.id
         JOIN files f ON s.file_id = f.id
         WHERE f.path = ? AND e.kind != 'import' AND e.name IS NOT NULL
         ORDER BY e.line ASC`,
      )
      .all(normalizedPath) as {
      id: string;
      name: string;
      kind: string;
      type: string;
      line: number;
    }[];

    if (rows.length > 0) {
      return rows
        .filter((r) => !getDisplayName(r.name).startsWith("jsx@"))
        .map((r) => ({
          id: r.id,
          name: getDisplayName(r.name),
          kind: r.kind,
          type: r.type,
          line: r.line || 0,
        }));
    }

    const file = project.graph?.files?.[normalizedPath];
    if (!file) throw new Error(`File not found: ${normalizedPath}`);
    const outline = Object.values(file.var || {})
      .filter((v) => !getDisplayName(v.name).startsWith("jsx@"))
      .map((v) => ({
        id: v.id,
        name: getDisplayName(v.name),
        kind: v.kind,
        type: v.type,
        line: v.loc.line,
      }));
    return outline.sort((a, b) => a.line - b.line);
  }

  async readFile(
    projectPath: string,
    filePath: string,
    subProject?: string,
    startLine?: number,
    endLine?: number,
  ) {
    const analysisPath = subProject
      ? path.join(projectPath, subProject.replace(/^\/+/, ""))
      : projectPath;
    const fullPath = path.resolve(
      analysisPath,
      filePath.startsWith("/") ? filePath.slice(1) : filePath,
    );
    if (!fs.existsSync(fullPath))
      throw new Error(`File not found: ${filePath}`);
    const content = fs.readFileSync(fullPath, "utf-8");
    if (startLine != null) {
      const lines = content.split("\n");
      const from = Math.max(0, startLine - 1);
      const to =
        endLine != null ? Math.min(lines.length, endLine) : lines.length;
      return lines.slice(from, to).join("\n") + "\n";
    }
    return content;
  }

  async grepSearch(
    projectPath: string,
    pattern: string,
    subProject?: string,
    exclude?: string[],
  ): Promise<{ file: string; line: number; content: string }[]> {
    const project = await this.openProject(projectPath, subProject);
    const results: { file: string; line: number; content: string }[] = [];
    const regex = new RegExp(pattern, "i");
    const analysisPath = this.getAnalysisPath(projectPath, subProject);

    const isExcluded = (filePath: string) => {
      if (!exclude || exclude.length === 0) return false;
      return exclude.some(
        (pattern) =>
          minimatch(filePath, pattern, { dot: true, nocase: true }) ||
          minimatch(path.basename(filePath), pattern, {
            dot: true,
            nocase: true,
          }),
      );
    };

    const isSourceFile = (name: string) =>
      /\.(tsx?|jsx?|mjs|cjs|mts|cts|js|ts|json|md|css|scss|html|vue|svelte|astro)$/i.test(
        name,
      );

    const walkDir = (dir: string, rootRel: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = rootRel ? `${rootRel}/${entry.name}` : `/${entry.name}`;

        if (isExcluded(relPath) || isExcluded(entry.name)) continue;

        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (entry.isFile() && isSourceFile(entry.name)) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push({
                  file: relPath,
                  line: i + 1,
                  content: lines[i].trim(),
                });
                if (results.length >= 100) return;
              }
            }
          } catch {
            // Skip binary or unreadable files
          }
        }
        if (results.length >= 100) return;
      }
    };

    walkDir(analysisPath, "");
    return results;
  }

  async runShellCommand(
    projectPath: string,
    command: string,
    subProject?: string,
  ): Promise<{
    stdout?: string;
    stderr?: string;
    error?: string;
    exitCode: number;
  }> {
    const analysisPath = this.getAnalysisPath(projectPath, subProject);
    const dangerous = [
      "rm -rf",
      "mkfs",
      "dd if=",
      "> /dev/",
      "shutdown",
      "reboot",
    ];
    if (dangerous.some((c) => command.includes(c)))
      throw new Error(`Command "${command}" is restricted.`);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: analysisPath,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (e: unknown) {
      const err = e as {
        message: string;
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      return {
        error: err.message,
        stdout: err.stdout,
        stderr: err.stderr,
        exitCode: err.code ?? 1,
      };
    }
  }

  private _saveCache(project: ProjectInfo) {
    if (process.env.MODE === "production") {
      return;
    }
    const { cacheFile } = this.getProjectStoragePaths(
      project.projectPath,
      project.subProject,
    );
    this.safeWriteFileSync(cacheFile, JSON.stringify(project.graph, null, 2));
  }

  async checkProjectStatus(directoryPath: string): Promise<ProjectStatus> {
    const status: ProjectStatus = {
      hasConfig: false,
      isMonorepo: false,
      projectType: "unknown",
      config: null,
      subProjects: [],
    };

    try {
      const configPath = path.join(directoryPath, "nexiq.config.json");
      if (fs.existsSync(configPath)) {
        status.hasConfig = true;
        try {
          status.config = JSON.parse(
            fs.readFileSync(configPath, "utf-8"),
          ) as NexiqConfig;
        } catch (e: unknown) {
          console.error("Error reading config", e);
        }
      }

      const packageJsonPath = path.join(directoryPath, "package.json");
      const workspacePatterns = getWorkspacePatterns(directoryPath);

      if (workspacePatterns.length > 0) {
        status.isMonorepo = true;
      } else if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf-8"),
          ) as PackageJson;
          if (pkg.workspaces) {
            status.isMonorepo = true;
          }
        } catch {
          // ignore
        }
      }

      if (status.isMonorepo && workspacePatterns.length > 0) {
        try {
          const subProjects: SubProject[] = [];
          const entries = await discoverWorkspacePackages(directoryPath);
          for (const entry of entries) {
            subProjects.push({
              name: entry.name,
              path: entry.path,
            });
          }
          status.subProjects = subProjects;
        } catch (e: unknown) {
          console.error("Error resolving workspaces", e);
        }
      }

      if (
        fs.existsSync(path.join(directoryPath, "vite.config.ts")) ||
        fs.existsSync(path.join(directoryPath, "vite.config.js"))
      ) {
        status.projectType = "vite";
      } else if (fs.existsSync(path.join(directoryPath, "next.config.js"))) {
        status.projectType = "next";
      }
    } catch (error) {
      console.error("Error checking project status:", error);
    }

    return status;
  }

  async saveProjectConfig(
    directoryPath: string,
    config: NexiqConfig,
  ): Promise<boolean> {
    try {
      const configPath = path.join(directoryPath, "nexiq.config.json");
      let oldConfig: NexiqConfig | null = null;
      if (fs.existsSync(configPath)) {
        try {
          oldConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (e: unknown) {
          console.error("Failed to read old config", e);
        }
      }

      const configContent = JSON.stringify(config, null, 2);
      this.safeWriteFileSync(configPath, configContent);

      const patternsChanged =
        JSON.stringify(oldConfig?.ignorePatterns) !==
        JSON.stringify(config.ignorePatterns);

      if (patternsChanged) {
        const { cacheDir } = this.getProjectStoragePaths(directoryPath);
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir);
          for (const file of files) {
            if (file.endsWith(".json")) {
              fs.unlinkSync(path.join(cacheDir, file));
            }
          }
          console.log("Ignore patterns changed, cleared cache.");
        }
      }

      return true;
    } catch (error) {
      console.error("Error saving config:", error);
      return false;
    }
  }

  async gitStatus(projectRoot: string): Promise<GitStatus> {
    const git = simpleGit(projectRoot);
    const status = await git.status();

    return {
      current: status.current,
      tracking: status.tracking,
      detached: status.detached,
      files: status.files.map((f) => ({
        path: f.path,
        index: f.index,
        working_dir: f.working_dir,
      })),
      staged: status.staged,
    };
  }

  async gitLog(
    projectRoot: string,
    options: number | { limit?: number; path?: string } = 50,
  ): Promise<GitCommit[]> {
    const git = simpleGit(projectRoot);

    let limit: number;
    let pathFilter: string | undefined;

    if (typeof options === "number") {
      limit = options;
    } else {
      limit = options.limit || 50;
      pathFilter = options.path;
    }

    const logOptions: LogOptions = { maxCount: limit };
    if (pathFilter) {
      logOptions.file = pathFilter;
    }

    const log = await git.log(logOptions);

    return log.all.map((commit) => ({
      hash: commit.hash,
      date: commit.date,
      message: commit.message,
      author_name: commit.author_name,
      author_email: commit.author_email,
    }));
  }

  async gitDiff(
    projectRoot: string,
    options: {
      file?: string;
      commit?: string;
      baseCommit?: string;
      staged?: boolean;
    },
  ): Promise<GitFileDiff[]> {
    const git = simpleGit(projectRoot);

    let rawDiff: string;
    const sanitizedFile = options.file?.startsWith("/")
      ? options.file.slice(1)
      : options.file;

    if (options.baseCommit && options.commit) {
      const args: string[] = [options.baseCommit, options.commit];
      if (sanitizedFile) {
        args.push("--", sanitizedFile);
      }
      rawDiff = await git.diff(args);
    } else if (options.commit && !options.staged) {
      const args: string[] = [options.commit];
      if (sanitizedFile) {
        args.push("--", sanitizedFile);
      }
      rawDiff = await git.show(args);
    } else {
      const args: string[] = [];
      if (options.staged) {
        args.push("--staged");
      }
      if (sanitizedFile) {
        args.push("--", sanitizedFile);
      }
      rawDiff = await git.diff(args);
    }

    return parseRawDiff(rawDiff, sanitizedFile);
  }

  async gitAnalyzeCommit(
    projectRoot: string,
    commitHash: string,
    subProject?: string,
  ): Promise<{ sqlitePath: string }> {
    const git = simpleGit(projectRoot);
    const resolvedHash = await git.revparse([commitHash]);

    const relativeSubPath = subProject
      ? path.isAbsolute(subProject)
        ? path.relative(projectRoot, subProject)
        : subProject
      : undefined;

    const cacheKey = relativeSubPath
      ? `${resolvedHash}-${relativeSubPath.replace(/[/\\]/g, "_")}`
      : resolvedHash;
    const commitCacheDir = path.join(projectRoot, ".nexiq", "cache", "commits");
    const sqlitePath = path.join(commitCacheDir, `${cacheKey}.sqlite`);

    if (fs.existsSync(sqlitePath)) {
      return { sqlitePath };
    }

    if (!fs.existsSync(commitCacheDir)) {
      fs.mkdirSync(commitCacheDir, { recursive: true });
    }

    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    try {
      await new Promise<void>((resolve, reject) => {
        exec(
          `git archive ${resolvedHash} | tar -x -C "${tempDir.name}"`,
          { cwd: projectRoot },
          (error) => {
            if (error) reject(error);
            else resolve();
          },
        );
      });

      const analysisPath = relativeSubPath
        ? path.join(tempDir.name, relativeSubPath)
        : tempDir.name;

      const configPath = path.join(projectRoot, "nexiq.config.json");
      let ignorePatterns: string[] | undefined = undefined;
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          ignorePatterns = config.ignorePatterns;
        } catch (e: unknown) {
          console.warn("Failed to load config for git analysis", e);
        }
      }

      await analyzeProject(analysisPath, undefined, ignorePatterns, sqlitePath);
      return { sqlitePath };
    } finally {
      tempDir.removeCallback();
    }
  }

  async getProjectIcon(projectRoot: string): Promise<string | null> {
    try {
      const localIcons = [
        "favicon.ico",
        "logo.svg",
        "logo.png",
        "vite.svg",
        "public/favicon.ico",
        "public/logo.svg",
        "public/logo.png",
        "public/vite.svg",
      ];

      for (const icon of localIcons) {
        const iconPath = path.join(projectRoot, icon);
        if (fs.existsSync(iconPath)) {
          const buffer = fs.readFileSync(iconPath);
          const ext = path.extname(icon).toLowerCase();
          const mimeType =
            ext === ".svg"
              ? "image/svg+xml"
              : ext === ".ico"
                ? "image/x-icon"
                : `image/${ext.slice(1)}`;
          return `data:${mimeType};base64,${buffer.toString("base64")}`;
        }
      }

      if (fs.existsSync(path.join(projectRoot, ".git"))) {
        const git = simpleGit(projectRoot);
        try {
          const remotes = await git.getRemotes(true);
          const origin = remotes.find((r) => r.name === "origin") || remotes[0];
          if (origin && origin.refs.fetch) {
            const url = origin.refs.fetch;
            const match = url.match(/github\.com[/:]([^/]+)\//);
            if (match && match[1]) {
              const owner = match[1];
              return `https://github.com/${owner}.png`;
            }
          }
        } catch (e: unknown) {
          console.warn("Failed to get git remotes", e);
        }
      }

      return null;
    } catch (e: unknown) {
      console.error("Failed to get project icon", e);
      return null;
    }
  }

  async writeFile(
    projectRoot: string,
    filePath: string,
    content: string,
  ): Promise<boolean> {
    const safePath = filePath.replace(/^\//, "");
    const absolutePath = path.resolve(projectRoot, safePath);
    if (!absolutePath.startsWith(path.resolve(projectRoot))) {
      throw new Error("Path is outside of project root");
    }

    try {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, "utf-8");
      return true;
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error);
      return false;
    }
  }

  async replaceFileContent(
    projectRoot: string,
    filePath: string,
    oldString: string,
    newString: string,
  ): Promise<boolean> {
    const safePath = filePath.replace(/^\//, "");
    const absolutePath = path.resolve(projectRoot, safePath);
    if (!absolutePath.startsWith(path.resolve(projectRoot))) {
      throw new Error("Path is outside of project root");
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const content = fs.readFileSync(absolutePath, "utf-8");
      if (!content.includes(oldString)) {
        throw new Error(`Old string not found in ${filePath}`);
      }
      const newContent = content.replace(oldString, newString);
      fs.writeFileSync(absolutePath, newContent, "utf-8");
      return true;
    } catch (error) {
      console.error(`Error replacing content in ${filePath}:`, error);
      throw error;
    }
  }

  async multiReplaceFileContent(
    projectRoot: string,
    filePath: string,
    replacements: { oldString: string; newString: string }[],
  ): Promise<boolean> {
    const safePath = filePath.replace(/^\//, "");
    const absolutePath = path.resolve(projectRoot, safePath);
    if (!absolutePath.startsWith(path.resolve(projectRoot))) {
      throw new Error("Path is outside of project root");
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      let content = fs.readFileSync(absolutePath, "utf-8");
      for (const { oldString, newString } of replacements) {
        if (!content.includes(oldString)) {
          throw new Error(`Old string not found in ${filePath}`);
        }
        content = content.replace(oldString, newString);
      }
      fs.writeFileSync(absolutePath, content, "utf-8");
      return true;
    } catch (error) {
      console.error(`Error in multi-replace for ${filePath}:`, error);
      throw error;
    }
  }

  async closeAll() {
    for (const project of this.projects.values()) {
      if (project.subscription) await project.subscription.unsubscribe();

      if (project.db) project.db.close();
    }
    this.projects.clear();
  }

  private getAnalysisPath(projectPath: string, subProject?: string): string {
    projectPath = this.ensureDirectory(projectPath);
    if (!subProject) return projectPath;
    if (path.isAbsolute(subProject)) {
      // If it's inside projectPath, we can still use it.
      if (subProject.startsWith(projectPath)) return subProject;
      // Fallback for cases like "/src" which are absolute but we want relative
      return path.join(projectPath, subProject.replace(/^\/+/, ""));
    }
    return path.join(projectPath, subProject.replace(/^\/+/, ""));
  }

  private getProjectStoragePaths(
    projectPath: string,
    subProject?: string,
    subProjects?: string[],
  ) {
    const analysisPath = this.getAnalysisPath(projectPath, subProject);
    const isMultiProject =
      (subProjects && subProjects.length > 0) ||
      (subProject && subProject.includes(","));

    // For monorepos/multi-project, we store in the workspace root.
    const cacheRoot = isMultiProject ? projectPath : analysisPath;
    const cacheDir = path.join(cacheRoot, ".nexiq", "cache");

    // Create a stable hash of the selection
    const pathHash = crypto
      .createHash("sha256")
      .update(analysisPath)
      .digest("hex")
      .slice(0, 8);

    // Ensure safe filename length
    let safeBaseName = "workspace";
    if (!isMultiProject) {
      const base = path.basename(analysisPath);
      safeBaseName = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    }

    return {
      analysisPath,
      cacheRoot,
      cacheDir,
      cacheFile: path.join(cacheDir, `${safeBaseName}-${pathHash}.json`),
      sqlitePath: path.join(cacheDir, `${safeBaseName}-${pathHash}.sqlite`),
      pathHash,
      isMultiProject,
    };
  }
}

function extractPropsFromSource(
  content: string,
): { name: string; type: string; kind: string }[] {
  const props: { name: string; type: string; kind: string }[] = [];
  const lines = content.split("\n");
  let inInterface = false;
  let interfaceDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inInterface) {
      if (
        /^(export\s+)?interface\s+Props/.test(line) ||
        /^(export\s+)?type\s+Props\s*=/.test(line)
      ) {
        inInterface = true;
        interfaceDepth = line.includes("{")
          ? (line.match(/{/g) || []).length
          : 0;
        if (interfaceDepth === 0) interfaceDepth = 1;
      }
      continue;
    }

    interfaceDepth += (line.match(/{/g) || []).length;
    interfaceDepth -= (line.match(/}/g) || []).length;

    if (interfaceDepth <= 0) {
      inInterface = false;
      interfaceDepth = 0;
      continue;
    }

    const propMatch = line.match(/^\s*(\w[\w\d_]*)\??\s*:/);
    if (propMatch) {
      const name = propMatch[1];
      if (!props.some((p) => p.name === name)) {
        props.push({ name, type: "any", kind: "prop" });
      }
    }
  }

  return props;
}
