import fs from "node:fs";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "analyser";
import type { JsonData, ComponentFileVar } from "shared";
import type { Extension } from "@react-map/extension-sdk";
import { pathToFileURL } from "node:url";
import { getDisplayName } from "shared";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ProjectInfo {
  projectPath: string;
  subProject?: string;
  graph?: JsonData;
  subscription?: watcher.AsyncSubscription;
  extensions: Extension[];
}

export interface SymbolSearchResult {
  type: "definition" | "usage";
  kind?: string;
  name: string;
  file: string;
  loc: { line: number; column: number };
  props?: any[];
  in?: string; // Context where it's used
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
      // Fallback to a temporary directory if project root is read-only
    }

    // Use a hash of the path to avoid collisions for projects with same basename
    const pathHash = Buffer.from(analysisPath).toString("hex").slice(0, 8);
    const cacheFile = path.join(
      cacheDir,
      `${path.basename(analysisPath)}-${pathHash}.json`,
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
        // Try to resolve from monorepo extensions directory first if it exists
        // This is a bit of a heuristic for this specific project structure
        // In production, we might look in node_modules or a global extensions path
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
          // Fallback to normal import which might look in node_modules
          loaded = await import(name);
        }

        const extension = Object.values(
          loaded as Record<string, unknown>,
        ).find(
          (val: unknown) => val && typeof val === "object" && "id" in val,
        ) as Extension;

        if (extension) {
          extensions.push(extension);
          console.error(`Loaded extension: ${extension.id} from ${name}`);
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        console.error(`Failed to load extension ${name}:`, errorMessage);
      }
    }

    console.error(`Analyzing project: ${analysisPath}`);
    const graph = analyzeProject(analysisPath, cacheFile, ignorePatterns);

    // Save initial graph to cache
    fs.writeFileSync(cacheFile, JSON.stringify(graph, null, 2));

    const projectInfo: ProjectInfo = {
      projectPath,
      subProject,
      graph,
      extensions,
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
              );
              fs.writeFileSync(
                cacheFile,
                JSON.stringify(projectInfo.graph, null, 2),
              );
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
  ): Promise<SymbolSearchResult[]> {
    // ... (existing implementation)
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) {
      throw new Error("Project not open or graph not available.");
    }

    const graph = project.graph;
    const results: SymbolSearchResult[] = [];

    // 1. Find the symbol's definition
    let targetDef: { file: string; id: string; name: string } | null = null;

    for (const [filePath, file] of Object.entries(graph.files)) {
      for (const variable of Object.values(
        file.var as Record<string, ComponentFileVar>,
      )) {
        const displayName = getDisplayName(variable.name);
        if (displayName === query) {
          targetDef = { file: filePath, id: variable.id, name: displayName };
          results.push({
            type: "definition",
            kind: variable.kind,
            name: displayName,
            file: filePath,
            loc: variable.loc,
            props: (variable as any).props,
          });
        }
      }
    }

    if (!targetDef) {
      // If no exact match, try partial match for definitions
      for (const [filePath, file] of Object.entries(graph.files)) {
        for (const variable of Object.values(
          file.var as Record<string, ComponentFileVar>,
        )) {
          const displayName = getDisplayName(variable.name);
          if (displayName.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              type: "definition",
              kind: variable.kind,
              name: displayName,
              file: filePath,
              loc: variable.loc,
              props: (variable as any).props,
            });
          }
        }
      }
      return results;
    }

    // 2. Find usages of the identified symbol
    const resolvePath = (source: string, fromFile: string): string => {
      if (source.startsWith(".") || source.startsWith("..")) {
        const dir = path.dirname(fromFile);
        const resolved = path.join(dir, source);
        return path.normalize(resolved);
      }
      // Handle aliases if needed (we should ideally get these from the graph or config)
      return source;
    };

    const isMatch = (importedSource: string, targetFile: string): boolean => {
      const resolved = resolvePath(importedSource, targetFile);
      // Strip extensions for comparison
      const strip = (p: string) => p.replace(/\.(tsx|ts|jsx|js)$/, "");
      return strip(resolved) === strip(targetFile);
    };

    for (const [filePath, file] of Object.entries(graph.files)) {
      // Check if this file imports the symbol
      let isImported = filePath === targetDef.file;
      let localName = targetDef.name;

      if (!isImported) {
        const imports = (file as any).import || {};
        for (const imp of Object.values(imports)) {
          const i = imp as any;
          const sourceMatches = i.source && (
            i.source === targetDef.file || 
            i.source === targetDef.file.replace(/\.(tsx|ts|jsx|js)$/, "") ||
            isMatch(i.source, targetDef.file)
          );

          if (sourceMatches) {
            if (i.type === "default" || i.importedName === targetDef.name) {
              isImported = true;
              localName = i.localName;
              break;
            }
          }
        }
      }

      if (isImported) {
        for (const variable of Object.values(
          (file as any).var as Record<string, ComponentFileVar>,
        )) {
          // Check renders
          if ((variable as any).renders) {
            for (const render of Object.values((variable as any).renders)) {
              if ((render as any).name === localName) {
                results.push({
                  type: "usage",
                  kind: "render",
                  name: localName,
                  file: filePath,
                  loc: (render as any).loc,
                  in: getDisplayName(variable.name),
                });
              }
            }
          }
          // Check hooks
          if ((variable as any).hooks) {
            for (const hookName of (variable as any).hooks) {
              if (hookName === localName) {
                results.push({
                  type: "usage",
                  kind: "hook-call",
                  name: localName,
                  file: filePath,
                  loc: variable.loc,
                  in: getDisplayName(variable.name),
                });
              }
            }
          }
          // Check dependencies
          if (variable.dependencies) {
            for (const dep of Object.values(variable.dependencies)) {
              if (dep.name === localName) {
                results.push({
                  type: "usage",
                  kind: "dependency",
                  name: localName,
                  file: filePath,
                  loc: variable.loc,
                  in: getDisplayName(variable.name),
                });
              }
            }
          }
        }
      }
    }

    return results;
  }

  async getComponentHierarchy(
    projectPath: string,
    componentName: string,
    subProject?: string,
    depth: number = 2,
  ): Promise<any> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) {
      throw new Error("Project not open or graph not available.");
    }

    const graph = project.graph;
    
    // Find the starting component(s)
    const startComponents: any[] = [];
    for (const file of Object.values(graph.files)) {
      for (const variable of Object.values((file as any).var)) {
        if (getDisplayName((variable as any).name) === componentName) {
          startComponents.push(variable);
        }
      }
    }

    if (startComponents.length === 0) {
      return { error: `Component "${componentName}" not found.` };
    }

    const buildHierarchy = (comp: any, currentDepth: number, visited: Set<string>): any => {
      if (currentDepth > depth || visited.has(comp.id)) {
        return { id: comp.id, name: getDisplayName(comp.name), status: "depth-limit-or-circular" };
      }
      visited.add(comp.id);

      const result: any = {
        id: comp.id,
        name: getDisplayName(comp.name),
        renders: [],
      };

      if (comp.renders) {
        for (const render of Object.values(comp.renders as Record<string, any>)) {
          // Resolve render tag to a component if possible
          let childComp: any = null;
          // Search for component by ID or Name
          for (const f of Object.values(graph.files)) {
            const v = (f as any).var[render.id];
            if (v) {
              childComp = v;
              break;
            }
          }

          if (childComp) {
            result.renders.push(buildHierarchy(childComp, currentDepth + 1, new Set(visited)));
          } else {
            result.renders.push({ name: render.tag, status: "unresolved" });
          }
        }
      }

      return result;
    };

    const findRendersOf = (name: string): any[] => {
      const renderedBy: any[] = [];
      for (const file of Object.values(graph.files)) {
        for (const variable of Object.values((file as any).var)) {
          const v = variable as any;
          if (v.renders) {
            for (const render of Object.values(v.renders as Record<string, any>)) {
              if (render.tag === name) {
                renderedBy.push({
                  id: v.id,
                  name: getDisplayName(v.name),
                  file: v.file,
                });
                break;
              }
            }
          }
        }
      }
      return renderedBy;
    };

    return {
      component: componentName,
      hierarchies: startComponents.map(c => buildHierarchy(c, 0, new Set())),
      renderedBy: findRendersOf(componentName),
    };
  }

  async getSymbolLocation(
    projectPath: string,
    query: string,
    subProject?: string,
  ): Promise<any> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) {
      throw new Error("Project not open or graph not available.");
    }

    const results: any[] = [];
    for (const [filePath, file] of Object.entries(project.graph.files)) {
      for (const variable of Object.values(
        file.var as Record<string, ComponentFileVar>,
      )) {
        const displayName = getDisplayName(variable.name);
        if (displayName === query) {
          results.push({
            name: displayName,
            file: filePath,
            loc: variable.loc,
            scope: (variable as any).scope,
            kind: variable.kind,
            type: variable.type,
          });
        }
      }
    }

    return results;
  }

  async getSymbolContent(
    projectPath: string,
    query: string,
    subProject?: string,
  ): Promise<any> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) {
      throw new Error("Project not open or graph not available.");
    }

    const locations = await this.getSymbolLocation(projectPath, query, subProject);
    if (locations.length === 0) {
      return { error: `Symbol "${query}" not found.` };
    }

    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;

    const results: any[] = [];
    for (const locInfo of locations) {
      const fullPath = path.resolve(analysisPath, locInfo.file.startsWith("/") ? locInfo.file.slice(1) : locInfo.file);
      if (!fs.existsSync(fullPath)) {
        results.push({ ...locInfo, error: "File not found on disk." });
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      let symbolContent = "";
      if (locInfo.scope) {
        const startLine = locInfo.scope.start.line - 1;
        const endLine = locInfo.scope.end.line - 1;
        symbolContent = lines.slice(startLine, endLine + 1).join("\n");
      } else {
        const line = locInfo.loc.line - 1;
        symbolContent = lines[line] || "";
      }

      results.push({
        ...locInfo,
        content: symbolContent,
      });
    }

    return results;
  }

  async updateGraphPosition(
    projectPath: string,
    subProject: string | undefined,
    positions: any,
    contextId?: string,
  ): Promise<boolean> {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) return false;

    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const cacheDir = path.join(analysisPath, ".react-map", "cache");
    const pathHash = Buffer.from(analysisPath).toString("hex").slice(0, 8);
    const cacheFile = path.join(
      cacheDir,
      `${path.basename(analysisPath)}-${pathHash}.json`,
    );

    try {
      // Helper to apply positions recursively
      const applyUIState = (item: any, stateMap: any) => {
        const state = stateMap[item.id];
        if (state) {
          if (!item.ui) item.ui = { x: 0, y: 0 };
          item.ui.x = state.x;
          item.ui.y = state.y;
          if (state.radius !== undefined) item.ui.radius = state.radius;
          if (state.collapsedRadius !== undefined)
            item.ui.collapsedRadius = state.collapsedRadius;
          if (state.expandedRadius !== undefined)
            item.ui.expandedRadius = state.expandedRadius;
          if (state.collapsed !== undefined) item.ui.collapsed = state.collapsed;

          const isCombo =
            item.kind === "component" ||
            (item.kind === "hook" && item.type === "function");

          if (contextId && item.id === contextId) {
            item.ui.isLayoutCalculated = true;
          } else if (contextId === "root") {
            if (!isCombo) item.ui.isLayoutCalculated = true;
          } else if (contextId) {
            if (!isCombo) item.ui.isLayoutCalculated = true;
          } else if (state.isLayoutCalculated !== undefined) {
            item.ui.isLayoutCalculated = state.isLayoutCalculated;
          }
        }

        // Apply to sub-items
        const renderComboId = `${item.id}-render`;
        const renderPrefix = `${item.id}-render-`;
        const varPrefix = `${item.id}:`;

        for (const [id, subState] of Object.entries(stateMap)) {
          const s = subState as any;
          if (
            id === renderComboId ||
            id.startsWith(renderPrefix) ||
            id.startsWith(varPrefix)
          ) {
            if (!item.ui) item.ui = { x: 0, y: 0 };

            if (id === renderComboId || id.startsWith(renderPrefix)) {
              if (!item.ui.renders) item.ui.renders = {};
              item.ui.renders[id] = {
                x: s.x,
                y: s.y,
                radius: s.radius,
                collapsedRadius: s.collapsedRadius,
                expandedRadius: s.expandedRadius,
                isLayoutCalculated:
                  contextId === id ? true : s.isLayoutCalculated,
                collapsed: s.collapsed,
              };
            } else {
              if (!item.ui.vars) item.ui.vars = {};
              item.ui.vars[id] = {
                x: s.x,
                y: s.y,
                radius: s.radius,
                collapsedRadius: s.collapsedRadius,
                expandedRadius: s.expandedRadius,
                isLayoutCalculated:
                  contextId === id ? true : s.isLayoutCalculated,
                collapsed: s.collapsed,
              };
            }
          }
        }

        if (item.var) {
          for (const v of Object.values(item.var)) {
            applyUIState(v, stateMap);
          }
        }
      };

      for (const file of Object.values(project.graph.files)) {
        for (const variable of Object.values(file.var)) {
          applyUIState(variable, positions);
        }
      }

      this._saveCache(project);
      return true;
    } catch (e) {
      console.error("Failed to update graph positions", e);
      return false;
    }
  }

  private _saveCache(project: ProjectInfo) {
    const analysisPath = project.subProject
      ? path.resolve(project.projectPath, project.subProject)
      : project.projectPath;
    const cacheDir = path.join(analysisPath, ".react-map", "cache");
    const pathHash = Buffer.from(analysisPath).toString("hex").slice(0, 8);
    const cacheFile = path.join(
      cacheDir,
      `${path.basename(analysisPath)}-${pathHash}.json`,
    );
    fs.writeFileSync(cacheFile, JSON.stringify(project.graph, null, 2));
  }

  async addLabel(projectPath: string, id: string, label: string, subProject?: string) {
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

  async removeLabel(projectPath: string, id: string, label: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph || !project.graph.labels) return [];

    if (project.graph.labels[id]) {
      project.graph.labels[id] = project.graph.labels[id].filter(l => l !== label);
      if (project.graph.labels[id].length === 0) delete project.graph.labels[id];
      this._saveCache(project);
    }
    return project.graph.labels[id] || [];
  }

  async getLabels(projectPath: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    return project?.graph?.labels || {};
  }

  async findEntitiesByLabel(projectPath: string, label: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph || !project.graph.labels) return [];

    const ids: string[] = [];
    for (const [id, labels] of Object.entries(project.graph.labels)) {
      if (labels.includes(label)) ids.push(id);
    }
    return ids;
  }

  async listDirectory(projectPath: string, dirPath: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) throw new Error("Project not open.");

    const normalizedDir = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;
    const filesInDir = new Set<string>();
    const subDirs = new Set<string>();

    for (const filePath of Object.keys(project.graph.files)) {
      if (filePath.startsWith(normalizedDir)) {
        const relative = filePath.slice(normalizedDir.length).replace(/^\//, "");
        const parts = relative.split("/");
        if (parts.length === 1 && parts[0] !== "") {
          filesInDir.add(parts[0]!);
        } else if (parts.length > 1) {
          subDirs.add(parts[0]!);
        }
      }
    }

    return {
      directories: Array.from(subDirs).sort(),
      files: Array.from(filesInDir).sort(),
    };
  }

  async getFileOutline(projectPath: string, filePath: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) throw new Error("Project not open.");

    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
    const file = project.graph.files[normalizedPath];
    if (!file) throw new Error(`File not found: ${normalizedPath}`);

    const outline = Object.values(file.var).map(v => {
      const item: any = {
        id: v.id,
        name: getDisplayName(v.name),
        kind: v.kind,
        type: v.type,
        line: v.loc.line,
      };

      if (v.type === "function") {
        const rv = v as any;
        if (rv.var) {
          const internalVars = Object.values(rv.var as Record<string, ComponentFileVar>);
          item.internal = internalVars.map(iv => ({
            id: iv.id,
            name: getDisplayName(iv.name),
            kind: iv.kind,
            type: iv.type,
            line: iv.loc.line
          }));
        }
        
        if (v.kind === "component" || v.kind === "hook") {
          item.renders = Object.values(rv.renders || {}).map((r: any) => ({ tag: r.tag, line: r.loc.line }));
        }
      }

      return item;
    });

    return outline.sort((a, b) => a.line - b.line);
  }

  async readFile(projectPath: string, filePath: string, subProject?: string) {
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const fullPath = path.resolve(analysisPath, filePath.startsWith("/") ? filePath.slice(1) : filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return fs.readFileSync(fullPath, "utf-8");
  }

  async grepSearch(projectPath: string, pattern: string, subProject?: string) {
    const project = this.getProject(projectPath, subProject);
    if (!project || !project.graph) throw new Error("Project not open or graph not available. Call open_project first.");

    const results: any[] = [];
    const regex = new RegExp(pattern, "i");
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;

    for (const filePath of Object.keys(project.graph.files)) {
      const fullPath = path.resolve(analysisPath, filePath.startsWith("/") ? filePath.slice(1) : filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            results.push({
              file: filePath,
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      }
      if (results.length > 100) break; // Limit results
    }

    return results;
  }

  async runShellCommand(projectPath: string, command: string, subProject?: string) {
    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;

    // Safety check: basic blacklist of dangerous commands
    const dangerousCommands = ["rm -rf", "mkfs", "dd if=", "> /dev/", "shutdown", "reboot"];
    if (dangerousCommands.some(c => command.includes(c))) {
      throw new Error(`Command "${command}" is restricted for safety reasons.`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, { 
        cwd: analysisPath,
        timeout: 30000, // 30s timeout
        maxBuffer: 1024 * 1024 // 1MB buffer
      });
      return { stdout, stderr };
    } catch (e: any) {
      return { 
        error: e.message,
        stdout: e.stdout,
        stderr: e.stderr 
      };
    }
  }

  async saveAppState(projectPath: string, state: any): Promise<boolean> {
    try {
      const dotDir = path.join(projectPath, ".react-map");
      if (!fs.existsSync(dotDir)) {
        fs.mkdirSync(dotDir, { recursive: true });
      }

      const statePath = path.join(dotDir, "state.json");
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      console.error("Error saving state.json", error);
      return false;
    }
  }

  async readAppState(projectPath: string): Promise<any> {
    const statePath = path.join(projectPath, ".react-map", "state.json");
    if (fs.existsSync(statePath)) {
      try {
        return JSON.parse(fs.readFileSync(statePath, "utf-8"));
      } catch (e) {
        console.error("Error reading state.json", e);
      }
    }
    return null;
  }

  async closeAll() {
    for (const project of this.projects.values()) {
      if (project.subscription) {
        await project.subscription.unsubscribe();
      }
    }
    this.projects.clear();
  }
}
