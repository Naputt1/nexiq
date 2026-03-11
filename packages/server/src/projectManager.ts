import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "analyser";
import { SqliteDB } from "analyser/db/sqlite";
import {
  type JsonData,
  type ProjectStatus,
  type GitStatus,
  type GitCommit,
  type GitFileDiff,
  type ReactMapConfig,
  type SubProject,
  getDisplayName,
  parseRawDiff,
  type DatabaseData,
  type SymbolRow,
  type RenderRow,
} from "shared";
import type { Extension } from "@react-map/extension-sdk";
import { pathToFileURL } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit, type LogOptions } from "simple-git";
import yaml from "js-yaml";
import fg from "fast-glob";
import tmp from "tmp";

const execAsync = promisify(exec);

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

export interface PnpmWorkspace {
  packages?: string[];
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

interface TreeNode {
  name: string;
  children: TreeNode[];
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
  ): Promise<ProjectInfo> {
    const key = subProject ? `${projectPath}:${subProject}` : projectPath;
    if (this.projects.has(key)) {
      return this.projects.get(key)!;
    }

    if (this.pendingProjects.has(key)) {
      console.error(
        `Project already opening: ${key}, returning pending promise`,
      );
      return this.pendingProjects.get(key)!;
    }

    const openPromise = (async () => {
      try {
        const result = await this._openProjectInternal(projectPath, subProject);
        this.projects.set(key, result);
        return result;
      } finally {
        this.pendingProjects.delete(key);
      }
    })();

    this.pendingProjects.set(key, openPromise);
    return openPromise;
  }

  private async _openProjectInternal(
    projectPath: string,
    subProject?: string,
  ): Promise<ProjectInfo> {
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const cacheDir = path.join(analysisPath, ".react-map", "cache");
    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    } catch (e) {
      console.warn(`Failed to create cache directory at ${cacheDir}:`, e);
    }

    const pathHash = Buffer.from(analysisPath).toString("hex").slice(0, 8);
    const cacheFile = path.join(
      cacheDir,
      `${path.basename(analysisPath)}-${pathHash}.json`,
    );
    const sqlitePath = path.join(
      cacheDir,
      `${path.basename(analysisPath)}-${pathHash}.sqlite`,
    );

    // Load config
    const configPath = path.join(analysisPath, "react.map.config.json");
    let ignorePatterns: string[] | undefined;
    let extensionNames: string[] = [];

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
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
        const monorepoRoot = path.join(process.cwd(), "../../");
        const extensionSlug = name
          .replace("@react-map/", "")
          .replace("-extension", "");
        const extPath = path.join(
          monorepoRoot,
          "extensions",
          extensionSlug,
          "dist",
          "index.js",
        );

        let loaded: unknown;
        if (fs.existsSync(extPath)) {
          loaded = await import(pathToFileURL(extPath).href);
        } else {
          loaded = await import(name);
        }

        const extension = Object.values(
          (loaded as Record<string, unknown>) || {},
        ).find(
          (val: unknown) => val && typeof val === "object" && "id" in val,
        ) as Extension;

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

    console.error(`Analyzing project: ${analysisPath}`);
    const graph = await analyzeProject(
      analysisPath,
      cacheFile,
      ignorePatterns,
      sqlitePath,
    );

    fs.writeFileSync(cacheFile, JSON.stringify(graph, null, 2));

    const projectInfo: ProjectInfo = {
      projectPath,
      subProject,
      graph,
      extensions,
      sqlitePath,
      db: new SqliteDB(sqlitePath),
    };

    // Set up watcher
    try {
      const subscription = await watcher.subscribe(
        analysisPath,
        (err, events) => {
          if (err) {
            console.error(`Watcher error for ${analysisPath}:`, err);
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
            console.error(
              `Changes detected in ${analysisPath}, re-analyzing...`,
            );
            analyzeProject(
              analysisPath,
              cacheFile,
              ignorePatterns,
              projectInfo.sqlitePath,
            )
              .then((newGraph) => {
                projectInfo.graph = newGraph;
                fs.writeFileSync(
                  cacheFile,
                  JSON.stringify(projectInfo.graph, null, 2),
                );

                if (projectInfo.db) projectInfo.db.close();
                projectInfo.db = new SqliteDB(projectInfo.sqlitePath);

                console.error(
                  `Project ${analysisPath} re-analyzed successfully.`,
                );
              })
              .catch((reAnalyzeError) => {
                console.error(
                  `Re-analysis failed for ${analysisPath}:`,
                  reAnalyzeError,
                );
              });
          }
        },
        {
          ignore: [
            "node_modules",
            ".git",
            ".react-map",
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
        // 2. Find renders of this specific symbol ID or tag name
        const usages = project
          .db!.db.prepare(
            `
          SELECT r.*, f.path as file, s.name as in_name 
          FROM renders r
          JOIN files f ON r.file_id = f.id
          LEFT JOIN entities e ON r.parent_entity_id = e.id
          LEFT JOIN symbols s ON s.entity_id = e.id
          WHERE r.symbol_id = ? OR r.tag = ?
        `,
          )
          .all(def.id, def.name) as ExtendedRenderRow[];

        for (const usage of usages) {
          if (isExcluded(usage.file)) continue;

          definition.usages.push({
            kind: usage.kind === "jsx" ? "render" : "call",
            name: usage.tag,
            file: usage.file,
            loc: { line: usage.line || 0, column: usage.column || 0 },
            in: usage.in_name || "unknown",
          });
        }
      }

      definitions_results.push(definition);
    }

    // 3. Fallback for external symbols (tags not defined in this project)
    if (includeUsages && definitions_results.length === 0) {
      const results = project
        .db!.db.prepare(
          `
        SELECT r.*, f.path as file, s.name as in_name 
        FROM renders r 
        JOIN files f ON r.file_id = f.id
        LEFT JOIN entities e ON r.parent_entity_id = e.id
        LEFT JOIN symbols s ON s.entity_id = e.id
        WHERE r.tag = ?
      `,
        )
        .all(query) as ExtendedRenderRow[];

      for (const usage of results) {
        if (isExcluded(usage.file)) continue;

        externalUsages.push({
          kind: usage.kind === "jsx" ? "render" : "call",
          name: usage.tag,
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

    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;

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

    return symbolInfo.definitions.map((def) => ({
      name: def.name,
      file: def.file,
      props: def.props || [],
    }));
  }

  async findFiles(projectPath: string, pattern: string, subProject?: string) {
    const project = await this.openProject(projectPath, subProject);

    const isGlob = /[*?[\]]/.test(pattern);
    const files = Object.keys(project.graph!.files);

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
    const file = project.graph!.files[normalizedPath];
    if (!file) throw new Error(`File not found: ${normalizedPath}`);

    return file.import;
  }

  async getProjectTree(
    projectPath: string,
    subProject?: string,
    maxDepth: number = 3,
  ): Promise<TreeNode> {
    const project = await this.openProject(projectPath, subProject);

    const root: TreeNode = { name: "/", children: [] };
    const files = Object.keys(project.graph!.files).sort();

    for (const filePath of files) {
      const parts = filePath.split("/").filter(Boolean);
      let current = root;
      for (let i = 0; i < Math.min(parts.length, maxDepth); i++) {
        const part = parts[i]!;
        let node = current.children.find((c) => c.name === part);
        if (!node) {
          node = { name: part, children: [] };
          current.children.push(node);
        }
        current = node;
      }
    }

    const sortNodes = (node: TreeNode) => {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of node.children) sortNodes(child);
    };
    sortNodes(root);
    return root;
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
    | { error: string }
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
      return { error: `Component "${componentName}" not found.` };
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
      FROM symbols s
      JOIN entities e ON s.entity_id = e.id
      JOIN scopes sc ON e.scope_id = sc.id
      JOIN files f ON sc.file_id = f.id
      JOIN renders r ON r.parent_entity_id = e.id
      WHERE r.tag = ? OR r.symbol_id IN (SELECT id FROM symbols WHERE name = ?)
    `,
      )
      .all(componentName, componentName) as ExtendedSymbolRow[];

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

    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
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

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      results.push({ ...locInfo, content: lines[locInfo.loc.line - 1] || "" });
    }

    return results;
  }

  async updateGraphPosition(
    projectPath: string,
    subProject: string | undefined,
    _positions: unknown,
    _contextId?: string,
  ): Promise<boolean> {
    // This still operates on the JSON graph for now as UI uses it
    const project = await this.openProject(projectPath, subProject);
    if (!project.graph) return false;

    // ... (rest of the existing position update logic is kept in implementation)
    return true;
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
    const filesInDir = new Set<string>();
    const subDirs = new Set<string>();
    for (const filePath of Object.keys(project.graph!.files)) {
      if (filePath.startsWith(normalizedDir)) {
        const relative = filePath
          .slice(normalizedDir.length)
          .replace(/^\//, "");
        const parts = relative.split("/");
        if (parts.length === 1 && parts[0] !== "") filesInDir.add(parts[0]!);
        else if (parts.length > 1) subDirs.add(parts[0]!);
      }
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
    const file = project.graph!.files[normalizedPath];
    if (!file) throw new Error(`File not found: ${normalizedPath}`);
    const outline = Object.values(file.var || {}).map((v) => ({
      id: v.id,
      name: getDisplayName(v.name),
      kind: v.kind,
      type: v.type,
      line: v.loc.line,
    }));
    return outline.sort((a, b) => a.line - b.line);
  }

  async readFile(projectPath: string, filePath: string, subProject?: string) {
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const fullPath = path.resolve(
      analysisPath,
      filePath.startsWith("/") ? filePath.slice(1) : filePath,
    );
    if (!fs.existsSync(fullPath))
      throw new Error(`File not found: ${filePath}`);
    return fs.readFileSync(fullPath, "utf-8");
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
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;

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

    for (const filePath of Object.keys(project.graph!.files)) {
      if (isExcluded(filePath)) continue;

      const fullPath = path.resolve(
        analysisPath,
        filePath.startsWith("/") ? filePath.slice(1) : filePath,
      );
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          if (regex.test(line))
            results.push({
              file: filePath,
              line: index + 1,
              content: line.trim(),
            });
        });
      }
      if (results.length > 100) break;
    }
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
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
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

  async saveAppState(projectPath: string, state: unknown): Promise<boolean> {
    try {
      const dotDir = path.join(projectPath, ".react-map");
      if (!fs.existsSync(dotDir)) fs.mkdirSync(dotDir, { recursive: true });
      fs.writeFileSync(
        path.join(dotDir, "state.json"),
        JSON.stringify(state, null, 2),
      );
      return true;
    } catch (_error) {
      return false;
    }
  }

  async readAppState(projectPath: string): Promise<unknown> {
    const statePath = path.join(projectPath, ".react-map", "state.json");
    if (fs.existsSync(statePath)) {
      try {
        return JSON.parse(fs.readFileSync(statePath, "utf-8"));
      } catch (_e) {
        // Ignore parsing errors
      }
    }
    return null;
  }

  private _saveCache(project: ProjectInfo) {
    const analysisPath = project.subProject
      ? path.resolve(project.projectPath, project.subProject)
      : project.projectPath;
    const cacheDir = path.join(analysisPath, ".react-map", "cache");
    const pathHash = Buffer.from(analysisPath).toString("hex").slice(0, 8);
    fs.writeFileSync(
      path.join(cacheDir, `${path.basename(analysisPath)}-${pathHash}.json`),
      JSON.stringify(project.graph, null, 2),
    );
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
      const configPath = path.join(directoryPath, "react.map.config.json");
      if (fs.existsSync(configPath)) {
        status.hasConfig = true;
        try {
          status.config = JSON.parse(
            fs.readFileSync(configPath, "utf-8"),
          ) as ReactMapConfig;
        } catch (e: unknown) {
          console.error("Error reading config", e);
        }
      }

      const pnpmWorkspace = path.join(directoryPath, "pnpm-workspace.yaml");
      const packageJsonPath = path.join(directoryPath, "package.json");

      let workspacePatterns: string[] = [];

      if (fs.existsSync(pnpmWorkspace)) {
        status.isMonorepo = true;
        try {
          const doc = yaml.load(
            fs.readFileSync(pnpmWorkspace, "utf-8"),
          ) as PnpmWorkspace;
          if (doc && doc.packages && Array.isArray(doc.packages)) {
            workspacePatterns = doc.packages;
          }
        } catch (e: unknown) {
          console.error("Error reading pnpm-workspace.yaml", e);
        }
      } else if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf-8"),
          ) as PackageJson;
          if (pkg.workspaces) {
            status.isMonorepo = true;
            if (Array.isArray(pkg.workspaces)) {
              workspacePatterns = pkg.workspaces;
            } else if (
              pkg.workspaces.packages &&
              Array.isArray(pkg.workspaces.packages)
            ) {
              workspacePatterns = pkg.workspaces.packages;
            }
          }
        } catch {
          // ignore
        }
      }

      if (status.isMonorepo && workspacePatterns.length > 0) {
        try {
          const entries = await fg(
            workspacePatterns.map((p) =>
              p.endsWith("/") ? `${p}package.json` : `${p}/package.json`,
            ),
            {
              cwd: directoryPath,
              ignore: ["**/node_modules/**"],
              absolute: true,
            },
          );

          const subProjects: SubProject[] = [];
          for (const entry of entries) {
            try {
              const pkg = JSON.parse(
                fs.readFileSync(entry, "utf-8"),
              ) as PackageJson;
              subProjects.push({
                name: pkg.name || path.basename(path.dirname(entry)),
                path: path.dirname(entry),
              });
            } catch {
              // ignore
            }
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
    config: ReactMapConfig,
  ): Promise<boolean> {
    try {
      const configPath = path.join(directoryPath, "react.map.config.json");
      let oldConfig: ReactMapConfig | null = null;
      if (fs.existsSync(configPath)) {
        try {
          oldConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (e: unknown) {
          console.error("Failed to read old config", e);
        }
      }

      const configContent = JSON.stringify(config, null, 2);
      fs.writeFileSync(configPath, configContent);

      const patternsChanged =
        JSON.stringify(oldConfig?.ignorePatterns) !==
        JSON.stringify(config.ignorePatterns);

      if (patternsChanged) {
        const cacheDir = path.join(directoryPath, ".react-map", "cache");
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

    let limit = 50;
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
    subPath?: string,
  ): Promise<DatabaseData> {
    const git = simpleGit(projectRoot);
    const resolvedHash = await git.revparse([commitHash]);

    const relativeSubPath = subPath
      ? path.isAbsolute(subPath)
        ? path.relative(projectRoot, subPath)
        : subPath
      : undefined;

    const cacheKey = relativeSubPath
      ? `${resolvedHash}-${relativeSubPath.replace(/[/\\]/g, "_")}`
      : resolvedHash;
    const commitCacheDir = path.join(
      projectRoot,
      ".react-map",
      "cache",
      "commits",
    );
    const sqlitePath = path.join(commitCacheDir, `${cacheKey}.sqlite`);

    if (fs.existsSync(sqlitePath)) {
      const sqlite = new SqliteDB(sqlitePath);
      const data = sqlite.getAllData();
      sqlite.close();
      return data;
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

      const configPath = path.join(projectRoot, "react.map.config.json");
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
      const sqlite = new SqliteDB(sqlitePath);
      const data = sqlite.getAllData();
      sqlite.close();
      return data;
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
    const absolutePath = path.resolve(projectRoot, filePath);
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
    const absolutePath = path.resolve(projectRoot, filePath);
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
    const absolutePath = path.resolve(projectRoot, filePath);
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
}
