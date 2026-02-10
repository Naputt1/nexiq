import { app, BrowserWindow, ipcMain, dialog } from "electron";
import fs from "node:fs";
import { store } from "./store";
import fg from "fast-glob";
import yaml from "js-yaml";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec } from "node:child_process";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tmp = require("tmp");
import { simpleGit } from "simple-git";

import type {
  AppStateData,
  PackageJson,
  PnpmWorkspace,
  ProjectStatus,
  ReactMapConfig,
} from "./types";
import type {
  JsonData,
  ComponentFileVar,
  ComponentInfoRender,
  EffectInfo,
  GitStatus,
  GitCommit,
  GitFileDiff,
  GitDiffHunk,
  PropData,
} from "shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.webContents.openDevTools();

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  win.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const ctrlOrCmd = input.control || input.meta;
    const shift = input.shift;

    // Ctrl + Shift + R → reload the whole app
    if (ctrlOrCmd && shift && key === "r") {
      event.preventDefault();
      console.log("Reloading the whole app");
      win!.webContents.reload();
      return;
    }

    // Ctrl + R → reload the current project
    if (ctrlOrCmd && !shift && key === "r") {
      event.preventDefault();
      console.log("Reloading current project");
      win?.webContents.send("reload-project");
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);

ipcMain.handle("run-cli", async (_, command: string) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error.message);
      else resolve(stdout || stderr);
    });
  });
});

let firstOpen = true;
ipcMain.handle("open-vscode", async (_, path: string) => {
  return new Promise((resolve, reject) => {
    let cmd = `code -g ${path}`;

    if (firstOpen) {
      // handle for windows and linux
      if (os.platform() === "darwin") {
        // cmd = `open -a "Visual Studio Code" --args -g ${path}`;
        cmd += `\nosascript -e 'tell application "Visual Studio Code" to activate'`;
      }
      firstOpen = false;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error.message);
      else resolve(stdout || stderr);
    });
  });
});

ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ["openDirectory"],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("get-recent-projects", () => {
  return store.getRecentProjects();
});

ipcMain.handle("get-last-project", () => {
  return store.getLastProject();
});

ipcMain.handle("set-last-project", (_, path: string | null) => {
  store.setLastProject(path);
});

ipcMain.handle("check-project-status", async (_, directoryPath: string) => {
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
      } catch (e) {
        console.error("Error reading config", e);
      }
    }

    const pnpmWorkspace = path.join(directoryPath, "pnpm-workspace.yaml");
    // const lernaJson = path.join(directoryPath, "lerna.json"); // TODO: support lerna if needed
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
      } catch (e) {
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
      // Resolve packages
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

        for (const entry of entries) {
          try {
            const pkg = JSON.parse(
              fs.readFileSync(entry, "utf-8"),
            ) as PackageJson;
            // We only care about packages that look like apps (vite/next) or have main/module?
            // For now, list all.
            status.subProjects.push({
              name: pkg.name || path.basename(path.dirname(entry)),
              path: path.dirname(entry),
            });
          } catch {
            // ignore
          }
        }
      } catch (e) {
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
});

ipcMain.handle(
  "save-project-config",
  async (
    _,
    {
      config,
      directoryPath,
    }: { config: ReactMapConfig; directoryPath: string },
  ) => {
    try {
      const configPath = path.join(directoryPath, "react.map.config.json");
      const dotDir = path.join(directoryPath, ".react-map");

      if (!fs.existsSync(dotDir)) {
        fs.mkdirSync(dotDir, { recursive: true });
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      store.addRecentProject(directoryPath);
      return true;
    } catch (error) {
      console.error("Error saving config:", error);
      throw error;
    }
  },
);

let currentProject: string | null = null;

ipcMain.handle("set-project", (_, path: string) => {
  currentProject = path;
});

ipcMain.handle("get-project", () => {
  return currentProject;
});

ipcMain.handle(
  "git-status",
  async (_, projectRoot: string): Promise<GitStatus> => {
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
  },
);

ipcMain.handle(
  "git-log",
  async (_, projectRoot: string, limit: number = 50): Promise<GitCommit[]> => {
    const git = simpleGit(projectRoot);
    const log = await git.log({ maxCount: limit });

    return log.all.map((commit) => ({
      hash: commit.hash,
      date: commit.date,
      message: commit.message,
      author_name: commit.author_name,
      author_email: commit.author_email,
    }));
  },
);

ipcMain.handle("git-stage", async (_, projectRoot: string, files: string[]) => {
  const git = simpleGit(projectRoot);
  await git.add(files);
});

ipcMain.handle(
  "git-unstage",
  async (_, projectRoot: string, files: string[]) => {
    const git = simpleGit(projectRoot);
    await git.reset(["HEAD", ...files]);
  },
);

ipcMain.handle(
  "git-diff",
  async (
    _,
    projectRoot: string,
    options: {
      file?: string;
      commit?: string;
      baseCommit?: string;
      staged?: boolean;
    },
  ): Promise<GitFileDiff[]> => {
    const git = simpleGit(projectRoot);

    let rawDiff: string;
    const sanitizedFile = options.file?.startsWith("/")
      ? options.file.slice(1)
      : options.file;

    if (options.baseCommit && options.commit) {
      // Diff between two specific points
      const args: string[] = [options.baseCommit, options.commit];
      if (sanitizedFile) {
        args.push("--", sanitizedFile);
      }
      rawDiff = await git.diff(args);
    } else if (options.commit && !options.staged) {
      // Use git show for specific commits to correctly handle root commits
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
  },
);

function parseRawDiff(rawDiff: string, filterFile?: string): GitFileDiff[] {
  const files: GitFileDiff[] = [];
  if (!rawDiff) return files;

  const fileDiffs = rawDiff.split(/^diff --git /m).slice(1);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split("\n");
    const header = lines[0];
    const pathMatch = header.match(/a\/(.*) b\/(.*)/);
    if (!pathMatch) continue;

    const filePath = pathMatch[2];
    if (filterFile && filePath !== filterFile) continue;

    const hunks: GitDiffHunk[] = [];
    let currentHunk: GitDiffHunk | null = null;

    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (hunkMatch) {
          oldLineNum = parseInt(hunkMatch[1]);
          newLineNum = parseInt(hunkMatch[3]);
          currentHunk = {
            content: line,
            lines: [],
            oldStart: oldLineNum,
            oldLines: parseInt(hunkMatch[2] || "1"),
            newStart: newLineNum,
            newLines: parseInt(hunkMatch[4] || "1"),
          };
          hunks.push(currentHunk);
        }
      } else if (currentHunk) {
        if (line.startsWith("+")) {
          currentHunk.lines.push({
            type: "added",
            content: line.substring(1),
            newLineNumber: newLineNum++,
          });
        } else if (line.startsWith("-")) {
          currentHunk.lines.push({
            type: "deleted",
            content: line.substring(1),
            oldLineNumber: oldLineNum++,
          });
        } else if (line.startsWith(" ")) {
          currentHunk.lines.push({
            type: "normal",
            content: line.substring(1),
            oldLineNumber: oldLineNum++,
            newLineNumber: newLineNum++,
          });
        }
      }
    }

    files.push({
      path: filePath,
      hunks,
    });
  }

  return files;
}

import { analyzeProject } from "analyser";

async function performAnalysis(analysisPath: string, projectPath: string) {
  const targetPath = analysisPath;
  const configRoot = projectPath || analysisPath;
  const name = path.basename(targetPath);
  const outputPath = path.join(
    configRoot,
    ".react-map",
    "cache",
    `${name}.json`,
  );

  // Ensure output dir exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log("Running analysis on:", targetPath, "into:", outputPath);

  try {
    const graph = analyzeProject(targetPath, outputPath);

    // Merge with existing position data if available
    if (fs.existsSync(outputPath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(outputPath, "utf-8"));

        // Helper to recurse and map positions
        const positionMap = new Map<
          string,
          { x: number; y: number; isLayoutCalculated?: boolean }
        >();

        // traverse existingData
        const traverse = (container: JsonData | null) => {
          if (!container) return;
          const files = container.files || {};
          for (const file of Object.values(files)) {
            for (const variable of Object.values(file.var || {})) {
              collectPos(variable);
            }
          }
        };

        const collectPos = (item: ComponentFileVar) => {
          if (item.ui?.x !== undefined && item.ui?.y !== undefined) {
            positionMap.set(item.id, {
              x: item.ui.x,
              y: item.ui.y,
              isLayoutCalculated: item.ui.isLayoutCalculated,
            });
          }

          // Collect renders and effects positions
          if (item.ui?.renders) {
            for (const [id, pos] of Object.entries(item.ui.renders)) {
              positionMap.set(id, {
                x: pos.x,
                y: pos.y,
                isLayoutCalculated: true,
              });
            }
          }

          if ("var" in item && item.var) {
            for (const v of Object.values(item.var)) {
              collectPos(v);
            }
          }
        };

        traverse(existingData);

        // Now apply to new graph
        const applyPos = (item: ComponentFileVar) => {
          const pos = positionMap.get(item.id);
          if (pos) {
            if (!item.ui) item.ui = { x: 0, y: 0 };
            item.ui.x = pos.x;
            item.ui.y = pos.y;
            item.ui.isLayoutCalculated = pos.isLayoutCalculated;
          }

          // Apply renders and effects positions
          const renders = "renders" in item ? item.renders : undefined;
          const effects = "effects" in item ? item.effects : undefined;

          if (renders || effects) {
            if (!item.ui) item.ui = { x: 0, y: 0 };
            if (!item.ui.renders) item.ui.renders = {};

            const applyItems = (
              items: Record<string, ComponentInfoRender | EffectInfo>,
            ) => {
              for (const r of Object.values(items)) {
                const rPos = positionMap.get(r.id);
                if (rPos) {
                  item.ui!.renders![r.id] = {
                    x: rPos.x,
                    y: rPos.y,
                  };
                }
              }
            };

            if (renders) applyItems(renders);
            if (effects) applyItems(effects);

            // Special handle for the render combo itself
            const renderComboId = `${item.id}-render`;
            const rcPos = positionMap.get(renderComboId);
            if (rcPos) {
              item.ui!.renders![renderComboId] = {
                x: rcPos.x,
                y: rcPos.y,
              };
            }
          }

          if ("var" in item && item.var) {
            for (const v of Object.values(item.var)) {
              applyPos(v);
            }
          }
        };

        const traverseApply = (container: JsonData | null) => {
          if (!container) return;
          const files = container.files || {};
          for (const file of Object.values(files)) {
            for (const variable of Object.values(file.var || {})) {
              applyPos(variable);
            }
          }
        };

        traverseApply(graph as unknown as JsonData);
      } catch (e) {
        console.error("Failed to merge positions", e);
      }
    }

    fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));
    console.log("Analysis success, written to:", outputPath);
    return graph;
  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
}

ipcMain.handle(
  "analyze-project",
  async (_, analysisPath: string, projectPath: string) => {
    await performAnalysis(analysisPath, projectPath);
    return path.basename(analysisPath);
  },
);

ipcMain.handle(
  "read-graph-data",
  async (_, projectRoot: string, analysisPath?: string) => {
    const targetPath = analysisPath || currentProject || projectRoot;
    if (!targetPath) return null;

    const name = path.basename(targetPath);
    const graphPath = path.join(
      projectRoot,
      ".react-map",
      "cache",
      `${name}.json`,
    );

    console.log("Reading graph data from:", graphPath);

    if (fs.existsSync(graphPath)) {
      return JSON.parse(fs.readFileSync(graphPath, "utf-8"));
    }

    // If file doesn't exist, trigger analysis
    return performAnalysis(targetPath, projectRoot);
  },
);

ipcMain.handle(
  "git-analyze-commit",
  async (
    _,
    projectRoot: string,
    commitHash: string,
    subPath?: string,
  ): Promise<JsonData> => {
    const cacheKey = subPath
      ? `${commitHash}-${subPath.replace(/\//g, "_")}`
      : commitHash;
    const commitCacheDir = path.join(
      projectRoot,
      ".react-map",
      "cache",
      "commits",
    );
    const cachePath = path.join(commitCacheDir, `${cacheKey}.json`);

    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    }

    if (!fs.existsSync(commitCacheDir)) {
      fs.mkdirSync(commitCacheDir, { recursive: true });
    }

    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    try {
      // Use git archive to get a clean snapshot of the commit
      await new Promise<void>((resolve, reject) => {
        exec(
          `git archive ${commitHash} | tar -x -C "${tempDir.name}"`,
          { cwd: projectRoot },
          (error) => {
            if (error) reject(error);
            else resolve();
          },
        );
      });

      const analysisPath = subPath
        ? path.join(tempDir.name, subPath)
        : tempDir.name;

      const graph = analyzeProject(analysisPath);
      fs.writeFileSync(cachePath, JSON.stringify(graph, null, 2));
      return graph as unknown as JsonData;
    } catch (e) {
      console.error("Failed to analyze commit", commitHash, e);
      throw e;
    } finally {
      tempDir.removeCallback();
    }
  },
);

ipcMain.handle(
  "analyze-diff",
  async (_, dataA: JsonData, dataB: JsonData): Promise<JsonData> => {
    const mapA = new Map<string, string>(); // id -> hash
    const mapB = new Map<string, string>();

    const collectVars = (data: JsonData, map: Map<string, string>) => {
      const traverseProps = (props: PropData[]) => {
        for (const p of props) {
          map.set(p.id, p.hash ?? "");
          if (p.props) {
            traverseProps(p.props);
          }
        }
      };

      const traverse = (vars: Record<string, ComponentFileVar>) => {
        for (const v of Object.values(vars)) {
          map.set(v.id, v.hash ?? "");

          if ("props" in v && v.props) {
            traverseProps(v.props);
          }

          if ("effects" in v && v.effects) {
            for (const effect of Object.values(v.effects)) {
              map.set(effect.id, "");
            }
          }

          if ("renders" in v && v.renders) {
            for (const render of Object.values(v.renders)) {
              map.set(render.id, "");
            }
          }

          if ("var" in v && v.var) {
            traverse(v.var);
          }
        }
      };

      for (const file of Object.values(data.files)) {
        if (file.var) traverse(file.var);
      }
    };

    collectVars(dataA, mapA);
    collectVars(dataB, mapB);

    const added: string[] = [];
    const modified: string[] = [];
    const deletedObjects: Record<
      string,
      ComponentFileVar | PropData | EffectInfo
    > = {};

    for (const [id, hashB] of mapB.entries()) {
      if (!mapA.has(id)) {
        added.push(id);
      } else if (mapA.get(id) !== hashB) {
        modified.push(id);
      }
    }

    const deletedIds = new Set<string>();
    for (const id of mapA.keys()) {
      if (!mapB.has(id)) {
        deletedIds.add(id);
      }
    }

    if (deletedIds.size > 0) {
      const collectDeletedObjects = (
        data: JsonData,
        targetIds: Set<string>,
      ) => {
        const traverseProps = (props: PropData[], v: ComponentFileVar) => {
          for (const p of props) {
            if (targetIds.has(p.id)) {
              p.file = v.file;
              deletedObjects[`${v.id}:${p.id}`] = p;
            }
            if (p.props) {
              traverseProps(p.props, v);
            }
          }
        };

        const traverse = (
          vars: Record<string, ComponentFileVar>,
          parent?: string,
        ) => {
          for (const v of Object.values(vars)) {
            if (targetIds.has(v.id)) {
              const id = `${parent ? `${parent}:` : ""}${v.id}`;
              deletedObjects[id] = v;
            }
            if ("props" in v && v.props) {
              traverseProps(v.props, v);
            }
            if ("effects" in v && v.effects) {
              for (const effect of Object.values(v.effects)) {
                if (targetIds.has(effect.id)) {
                  //TODO: refactor to use same id format as other vars/props
                  deletedObjects[effect.id] = {
                    ...effect,
                    file: v.file,
                    kind: "effect",
                  } as EffectInfo;
                }
              }
            }
            if ("var" in v && v.var) {
              traverse(v.var, v.id);
            }
          }
        };

        for (const file of Object.values(data.files)) {
          if (file.var) traverse(file.var);
        }
      };

      collectDeletedObjects(dataA, deletedIds);
    }

    return {
      ...dataB,
      diff: {
        added,
        modified,
        deleted: Array.from(deletedIds),
        deletedObjects,
      },
    };
  },
);

ipcMain.handle("read-state", async (_, projectRoot: string) => {
  const statePath = path.join(projectRoot, ".react-map", "state.json");
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf-8"));
    } catch (e) {
      console.error("Error reading state.json", e);
    }
  }
  return null;
});

ipcMain.handle(
  "save-state",
  async (_, projectRoot: string, state: AppStateData) => {
    try {
      const dotDir = path.join(projectRoot, ".react-map");
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
  },
);

ipcMain.handle(
  "update-graph-position",
  async (
    _,
    projectRoot: string,
    analysisPath: string,
    positions: Record<string, { x: number; y: number; radius?: number }>,
    contextId?: string,
  ) => {
    const targetPath = analysisPath;
    const configRoot = projectRoot || analysisPath;
    const name = path.basename(targetPath);
    const graphPath = path.join(
      configRoot,
      ".react-map",
      "cache",
      `${name}.json`,
    );

    if (!fs.existsSync(graphPath)) return false;

    try {
      const graphData = JSON.parse(
        fs.readFileSync(graphPath, "utf-8"),
      ) as JsonData;

      // Helper to update position recursively
      const updatePos = (item: ComponentFileVar) => {
        if (positions[item.id]) {
          if (!item.ui) item.ui = { x: 0, y: 0 };
          item.ui.x = positions[item.id].x;
          item.ui.y = positions[item.id].y;

          // If this item is the context combo, it means its children layout is done
          if (contextId && item.id === contextId) {
            item.ui.isLayoutCalculated = true;
          } else if (contextId === "root") {
            // For root layout, only nodes (non-combos) are "calculated" in terms of their final pos
            if (item.kind !== "component" && item.kind !== "hook") {
              item.ui.isLayoutCalculated = true;
            }
          } else if (!contextId) {
            // Full state save from UI: everything is calculated
            item.ui.isLayoutCalculated = true;
          } else {
            // If it's a child being positioned by a combo layout, it's "calculated"
            item.ui.isLayoutCalculated = true;
          }

          if (positions[item.id].radius !== undefined) {
            item.ui.radius = positions[item.id].radius;
          }
        }

        // Update renders positions on the parent component/hook
        const renders = "renders" in item ? item.renders : undefined;
        if (renders) {
          for (const render of Object.values(renders)) {
            // Use the composite ID that matches the UI node
            const compositeId = `${item.id}-render-${render.id}`;
            const pos = positions[compositeId];

            if (pos) {
              if (!item.ui) item.ui = { x: 0, y: 0 };
              if (!item.ui.renders) item.ui.renders = {};
              item.ui.renders[render.id] = {
                x: pos.x,
                y: pos.y,
                radius: pos.radius,
              };
            }
          }

          // Handle the render combo itself
          const renderComboId = `${item.id}-render`;
          if (positions[renderComboId]) {
            if (!item.ui) item.ui = { x: 0, y: 0 };
            if (!item.ui.renders) item.ui.renders = {};
            item.ui.renders[renderComboId] = {
              x: positions[renderComboId].x,
              y: positions[renderComboId].y,
              radius: positions[renderComboId].radius,
            };
          }
        }

        // Handle effect nodes (stored in parent's ui.renders for now as effects don't have their own ui property)
        const effects = "effects" in item ? item.effects : undefined;
        if (effects) {
          for (const effect of Object.values(effects)) {
            const pos = positions[effect.id];
            if (pos) {
              if (!item.ui) item.ui = { x: 0, y: 0 };
              if (!item.ui.renders) item.ui.renders = {};
              item.ui.renders[effect.id] = {
                x: pos.x,
                y: pos.y,
                radius: pos.radius,
              };
            }
          }
        }

        if ("var" in item && item.var) {
          for (const v of Object.values(item.var)) {
            updatePos(v);
          }
        }
      };

      for (const file of Object.values(graphData.files)) {
        for (const variable of Object.values(file.var)) {
          updatePos(variable);
        }
      }

      fs.writeFileSync(graphPath, JSON.stringify(graphData, null, 2));
      return true;
    } catch (e) {
      console.error("Failed to update graph positions", e);
      return false;
    }
  },
);
