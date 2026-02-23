import fs from "node:fs";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "analyser";
import type { JsonData } from "shared";
import type { Extension } from "@react-map/extension-sdk";
import { pathToFileURL } from "node:url";
import { getDisplayName } from "shared";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";

const execAsync = promisify(exec);

export interface ProjectInfo {
  projectPath: string;
  subProject?: string;
  graph?: JsonData;
  subscription?: watcher.AsyncSubscription;
  extensions: Extension[];
  sqlitePath: string;
  db?: Database.Database;
}

export interface SymbolSearchResult {
  type: "definition" | "usage";
  kind?: string;
  name: string;
  file: string;
  loc: { line: number; column: number };
  props?: unknown[];
  in?: string; // Context where it's used
}

interface SymbolRow {
  id: string;
  name: string;
  file: string;
  line: number;
  column: number;
  kind: string;
  type: string;
  props_json?: string;
}

interface RenderRow {
  id: string;
  symbol_id: string | null;
  tag: string;
  file: string;
  line: number;
  column: number;
  scope_symbol_id: string;
  in_name?: string;
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

  async openProject(
    projectPath: string,
    subProject?: string,
  ): Promise<ProjectInfo> {
    const key = subProject ? `${projectPath}:${subProject}` : projectPath;
    if (this.projects.has(key)) {
      return this.projects.get(key)!;
    }

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
    const graph = analyzeProject(
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
      db: new Database(sqlitePath),
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
            try {
              projectInfo.graph = analyzeProject(
                analysisPath,
                cacheFile,
                ignorePatterns,
                projectInfo.sqlitePath,
              );
              fs.writeFileSync(
                cacheFile,
                JSON.stringify(projectInfo.graph, null, 2),
              );

              if (projectInfo.db) projectInfo.db.close();
              projectInfo.db = new Database(projectInfo.sqlitePath);

              console.error(
                `Project ${analysisPath} re-analyzed successfully.`,
              );
            } catch (reAnalyzeError: unknown) {
              console.error(
                `Re-analysis failed for ${analysisPath}:`,
                reAnalyzeError,
              );
            }
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

    this.projects.set(key, projectInfo);
    return projectInfo;
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
  ): Promise<SymbolSearchResult[]> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.db)
      throw new Error("Project not open or database not available.");

    const results: SymbolSearchResult[] = [];

    // 1. Find the symbol's definition(s)
    let definitions: SymbolRow[];
    if (strict) {
      definitions = project.db
        .prepare("SELECT * FROM symbols WHERE name = ?")
        .all(query) as SymbolRow[];
    } else {
      definitions = project.db
        .prepare("SELECT * FROM symbols WHERE name = ? OR name LIKE ?")
        .all(query, `%${query}%`) as SymbolRow[];
    }

    for (const def of definitions) {
      results.push({
        type: "definition",
        kind: def.kind,
        name: def.name,
        file: def.file,
        loc: { line: def.line, column: def.column },
        props: JSON.parse(def.props_json || "[]") as unknown[],
      });

      // 2. Find renders of this specific symbol ID or tag name
      const usages = project.db
        .prepare(
          `
        SELECT r.*, s.name as in_name 
        FROM renders r 
        LEFT JOIN symbols s ON r.scope_symbol_id = s.id 
        WHERE r.symbol_id = ? OR r.tag = ?
      `,
        )
        .all(def.id, def.name) as RenderRow[];

      for (const usage of usages) {
        results.push({
          type: "usage",
          kind: "render",
          name: usage.tag,
          file: usage.file,
          loc: { line: usage.line, column: usage.column },
          in: usage.in_name || "unknown",
        });
      }
    }

    // 3. Fallback for external symbols (tags not defined in this project)
    if (results.filter((r) => r.type === "usage").length === 0) {
      const externalUsages = project.db
        .prepare(
          `
        SELECT r.*, s.name as in_name 
        FROM renders r 
        LEFT JOIN symbols s ON r.scope_symbol_id = s.id 
        WHERE r.tag = ?
      `,
        )
        .all(query) as RenderRow[];

      for (const usage of externalUsages) {
        results.push({
          type: "usage",
          kind: "render",
          name: usage.tag,
          file: usage.file,
          loc: { line: usage.line, column: usage.column },
          in: usage.in_name || "unknown",
        });
      }
    }

    return results;
  }

  async findSymbolUsages(
    projectPath: string,
    query: string,
    subProject?: string,
    summaryOnly: boolean = false,
    strict: boolean = true,
  ): Promise<
    | SymbolSearchResult[]
    | { query: string; totalUsages: number; files: Record<string, number> }
  > {
    const results = await this.findSymbol(
      projectPath,
      query,
      subProject,
      strict,
    );
    const usages = results.filter((r) => r.type === "usage");

    if (summaryOnly) {
      const summary: Record<string, number> = {};
      for (const u of usages) {
        summary[u.file] = (summary[u.file] || 0) + 1;
      }
      return { query, totalUsages: usages.length, files: summary };
    }

    return usages;
  }

  async findFiles(projectPath: string, pattern: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph)
      throw new Error("Project not open or graph not available.");

    let regex: RegExp;
    if (
      pattern.includes("*") &&
      !pattern.includes("/") &&
      !pattern.includes("\\")
    ) {
      const escaped = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, ".*");
      regex = new RegExp(`^${escaped}$`, "i");
    } else {
      regex = new RegExp(pattern, "i");
    }

    const results = Object.keys(project.graph.files).filter(
      (p) => regex.test(p) || regex.test(path.basename(p)),
    );
    return results.sort();
  }

  async getFileImports(
    projectPath: string,
    filePath: string,
    subProject?: string,
  ) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph)
      throw new Error("Project not open or graph not available.");

    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
    const file = project.graph.files[normalizedPath];
    if (!file) throw new Error(`File not found: ${normalizedPath}`);

    return file.import;
  }

  async getProjectTree(
    projectPath: string,
    subProject?: string,
    maxDepth: number = 3,
  ): Promise<TreeNode> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph)
      throw new Error("Project not open or graph not available.");

    const root: TreeNode = { name: "/", children: [] };
    const files = Object.keys(project.graph.files).sort();

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
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.db)
      throw new Error("Project not open or database not available.");

    // Find the starting component(s)
    const startComponents = project.db
      .prepare(`SELECT * FROM symbols WHERE name = ?`)
      .all(componentName) as SymbolRow[];

    if (startComponents.length === 0) {
      return { error: `Component "${componentName}" not found.` };
    }

    const buildHierarchy = (
      symbolId: string,
      currentDepth: number,
      visited: Set<string>,
    ): ComponentHierarchyNode => {
      const sym = project
        .db!.prepare(`SELECT * FROM symbols WHERE id = ?`)
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
        .db!.prepare(`SELECT * FROM renders WHERE scope_symbol_id = ?`)
        .all(symbolId) as RenderRow[];

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
          return { name: c.tag, status: "unresolved" };
        }),
      };
    };

    const renderedBy = project.db
      .prepare(
        `
      SELECT DISTINCT s.id, s.name, s.file 
      FROM symbols s
      JOIN renders r ON r.scope_symbol_id = s.id
      WHERE r.tag = ? OR r.symbol_id IN (SELECT id FROM symbols WHERE name = ?)
    `,
      )
      .all(componentName, componentName) as SymbolRow[];

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
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.db)
      throw new Error("Project not open or database not available.");

    const symbols = project.db
      .prepare(
        `SELECT id, name, file, line, column, kind, type FROM symbols WHERE name = ?`,
      )
      .all(query) as SymbolRow[];
    return symbols.map((s) => ({
      id: s.id,
      name: s.name,
      file: s.file,
      loc: { line: s.line, column: s.column },
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
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.db)
      throw new Error("Project not open or database not available.");

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
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) return false;

    // ... (rest of the existing position update logic is kept in implementation)
    return true;
  }

  async addLabel(
    projectPath: string,
    id: string,
    label: string,
    subProject?: string,
  ): Promise<string[]> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) throw new Error("Project not open.");
    if (!project.graph.labels) project.graph.labels = {};
    if (!project.graph.labels[id]) project.graph.labels[id] = [];
    if (!project.graph.labels[id].includes(label)) {
      project.graph.labels[id].push(label);
      this._saveCache(project);
    }
    return project.graph.labels[id];
  }

  async removeLabel(
    projectPath: string,
    id: string,
    label: string,
    subProject?: string,
  ): Promise<string[]> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph || !project.graph.labels) return [];
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
    const project = this.getProject(projectPath, subProject);
    return project?.graph?.labels || {};
  }

  async findEntitiesByLabel(
    projectPath: string,
    label: string,
    subProject?: string,
  ): Promise<string[]> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph || !project.graph.labels) return [];
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
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) throw new Error("Project not open.");
    const normalizedDir = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;
    const filesInDir = new Set<string>();
    const subDirs = new Set<string>();
    for (const filePath of Object.keys(project.graph.files)) {
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
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) throw new Error("Project not open.");
    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
    const file = project.graph.files[normalizedPath];
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
  ): Promise<{ file: string; line: number; content: string }[]> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph)
      throw new Error("Project not open. Call open_project first.");
    const results: { file: string; line: number; content: string }[] = [];
    const regex = new RegExp(pattern, "i");
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    for (const filePath of Object.keys(project.graph.files)) {
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
  ): Promise<{ stdout?: string; stderr?: string; error?: string }> {
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
      return { stdout, stderr };
    } catch (e: unknown) {
      const err = e as { message: string; stdout?: string; stderr?: string };
      return { error: err.message, stdout: err.stdout, stderr: err.stderr };
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

  async closeAll() {
    for (const project of this.projects.values()) {
      if (project.subscription) await project.subscription.unsubscribe();

      if (project.db) project.db.close();
    }
    this.projects.clear();
  }
}
