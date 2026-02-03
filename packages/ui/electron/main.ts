import { app, BrowserWindow, ipcMain, dialog } from "electron";
import fs from "node:fs";
import { store } from "./store";
import fg from "fast-glob";
import yaml from "js-yaml";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec } from "node:child_process";
import os from "os";
import type {
  AppStateData,
  PackageJson,
  PnpmWorkspace,
  ProjectStatus,
  ReactMapConfig,
} from "./types";
import { type JsonData, type ComponentFileVar } from "shared";

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

import { analyzeProject } from "analyser";

ipcMain.handle(
  "analyze-project",
  async (_, analysisPath: string, projectPath: string) => {
    const targetPath = analysisPath;
    const configRoot = projectPath || analysisPath;
    const name = path.basename(targetPath);
    const outputPath = path.join(configRoot, ".react-map", `${name}.json`);

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
          const positionMap = new Map<string, { x: number; y: number }>();

          // Wait, the output of analyzeProject is 'graph', but here we read the JSON.
          // The JSON structure depends on what analyzeProject returns.
          // Based on hook.ts, we have graphData.nodes, graphData.combos in the flattened structure usually?
          // But analyzeProject returns a structure that hook.ts parses into flat arrays or nested?
          // hook.ts: loadData parses it.
          // line 167: for (const file of Object.values(graphData.files))
          // line 168:   for (const variable of Object.values(file.var))
          // It seems the stored JSON has `files` and nested `var`.

          // Let's traverse the new graph and apply positions from existingData.

          // We need to traverse efficiently.
          // Let's build a map of IDs to positions from existingData first.

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
              positionMap.set(item.id, { x: item.ui.x, y: item.ui.y });
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
              item.ui.isLayoutCalculated = true; // Mark as calculated
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
      return name;
    } catch (error) {
      console.error("Analysis failed:", error);
      throw error;
    }
  },
);

ipcMain.handle(
  "read-graph-data",
  async (_, projectRoot: string, analysisPath?: string) => {
    const targetPath = analysisPath || currentProject || projectRoot;
    if (!targetPath) return null;

    const name = path.basename(targetPath);
    const graphPath = path.join(projectRoot, ".react-map", `${name}.json`);

    console.log("Reading graph data from:", graphPath);

    if (fs.existsSync(graphPath)) {
      return JSON.parse(fs.readFileSync(graphPath, "utf-8"));
    }
    return null;
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
  ) => {
    const targetPath = analysisPath;
    const configRoot = projectRoot || analysisPath;
    const name = path.basename(targetPath);
    const graphPath = path.join(configRoot, ".react-map", `${name}.json`);

    if (!fs.existsSync(graphPath)) return false;

    try {
      const graphData = JSON.parse(fs.readFileSync(graphPath, "utf-8")) as JsonData;

      // Helper to update position recursively
      const updatePos = (item: ComponentFileVar) => {
        if (positions[item.id]) {
          if (!item.ui) item.ui = { x: 0, y: 0 };
          item.ui.x = positions[item.id].x;
          item.ui.y = positions[item.id].y;
          if (positions[item.id].radius !== undefined) {
            item.ui.radius = positions[item.id].radius;
          }
        }

        // Update renders positions on the parent component/hook
        if ("renders" in item && item.renders) {
          for (const render of Object.values(item.renders)) {
            // Check both original ID and the composite ID used in the UI
            const compositeId = `${item.id}-render-${render.id}`;
            const pos = positions[render.id] || positions[compositeId];

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
        if ("effects" in item && item.effects) {
          for (const effect of Object.values(item.effects)) {
            if (positions[effect.id]) {
              if (!item.ui) item.ui = { x: 0, y: 0 };
              if (!item.ui.renders) item.ui.renders = {};
              item.ui.renders[effect.id] = {
                x: positions[effect.id].x,
                y: positions[effect.id].y,
                radius: positions[effect.id].radius,
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
