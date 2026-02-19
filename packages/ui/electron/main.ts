import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "node:fs";
import { store } from "./store";
import fg from "fast-glob";
import yaml from "js-yaml";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec } from "node:child_process";
import os from "node:os";
import * as watcher from "@parcel/watcher";

import tmp from "tmp";
import { simpleGit, type LogOptions } from "simple-git";
import { analyzeProject } from "analyser";

import type {
  AppStateData,
  GlobalSettings,
  PackageJson,
  PnpmWorkspace,
  ProjectStatus,
  ReactMapConfig,
  SubProject,
} from "./types";
import type {
  JsonData,
  ComponentFileVar,
  EffectInfo,
  GitStatus,
  GitCommit,
  GitFileDiff,
  GitDiffHunk,
  PropData,
  UIStateMap,
  UIItemState,
} from "shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

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

const windowProjects = new Map<number, string | null>();
const projectWatchers = new Map<string, watcher.AsyncSubscription>();
let isQuitting = false;

async function stopWatcher(projectPath: string) {
  const subscription = projectWatchers.get(projectPath);
  if (subscription) {
    await subscription.unsubscribe();
    projectWatchers.delete(projectPath);
    console.log(`Stopped watching: ${projectPath}`);
  }
}

async function startWatcher(projectPath: string) {
  if (projectWatchers.has(projectPath)) return;

  const configPath = path.join(projectPath, "react.map.config.json");
  let ignorePatterns: string[] = [
    "node_modules",
    ".git",
    ".react-map",
    "dist",
    "build",
    ".next",
    ".vite",
  ];
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.ignorePatterns) {
        // @parcel/watcher ignores are slightly different, they work best with folder names or simple patterns
        const customIgnores = config.ignorePatterns.map((p: string) =>
          p.replace(/^\*\*\/|\/\*\*$/g, ""),
        );
        ignorePatterns = [...ignorePatterns, ...customIgnores];
      }
    } catch (e) {
      console.warn("Failed to load config for watcher", e);
    }
  }

  console.log(
    `Starting watcher for ${projectPath} with ignores:`,
    ignorePatterns,
  );

  const debouncedReload = debounce(() => {
    console.log(`Changes detected in ${projectPath}, notifying windows...`);
    for (const [windowId, p] of windowProjects.entries()) {
      if (p === projectPath) {
        const win = BrowserWindow.fromId(windowId);
        if (win) {
          win.webContents.send("reload-project");
        }
      }
    }
  }, 1000);

  try {
    const subscription = await watcher.subscribe(
      projectPath,
      (err, events) => {
        if (err) {
          console.error(`Watcher error for ${projectPath}:`, err);
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
          debouncedReload();
        }
      },
      {
        ignore: ignorePatterns,
      },
    );

    projectWatchers.set(projectPath, subscription);
    console.log(`Started watching: ${projectPath}`);
  } catch (error) {
    console.error(`Failed to start watcher for ${projectPath}:`, error);
  }
}

async function updateOpenProjects() {
  const projects = Array.from(windowProjects.values()).map((p) => p || "");
  store.setOpenProjects(projects);

  const globalConfig = store.getGlobalConfig();
  const autoReload = globalConfig.autoReload;

  // Manage watchers
  const activeProjects = new Set(projects.filter(Boolean));
  for (const projectPath of projectWatchers.keys()) {
    if (!activeProjects.has(projectPath) || !autoReload) {
      await stopWatcher(projectPath);
    }
  }

  if (autoReload) {
    for (const projectPath of activeProjects) {
      await startWatcher(projectPath);
    }
  }
}

function createWindow(projectPath?: string, forceEmpty: boolean = false) {
  if (projectPath) {
    for (const [id, path] of windowProjects.entries()) {
      if (path === projectPath) {
        const existingWindow = BrowserWindow.fromId(id);
        if (existingWindow) {
          existingWindow.focus();
          return existingWindow;
        }
      }
    }
  }

  const window = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  window.maximize();

  windowProjects.set(window.id, projectPath || null);
  updateOpenProjects();

  window.on("closed", () => {
    if (!isQuitting) {
      windowProjects.delete(window.id);
      updateOpenProjects();
    }
  });

  if (VITE_DEV_SERVER_URL) {
    window.webContents.openDevTools();
  }

  // Test active push message to Renderer-process.
  window.webContents.on("did-finish-load", () => {
    window.webContents.send(
      "main-process-message",
      new Date().toLocaleString(),
    );
  });

  window.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const ctrlOrCmd = input.control || input.meta;
    const shift = input.shift;

    // Ctrl + Shift + R → reload the whole app
    if (ctrlOrCmd && shift && key === "r") {
      event.preventDefault();
      console.log("Reloading the whole app");
      window.webContents.reload();
      return;
    }

    // Ctrl + R → reload the current project
    if (ctrlOrCmd && !shift && key === "r") {
      event.preventDefault();
      console.log("Reloading current project");
      window.webContents.send("reload-project");
    }

    // Ctrl + Shift + N → new window
    if (ctrlOrCmd && shift && key === "n") {
      event.preventDefault();
      createWindow(undefined, true);
    }
  });

  if (VITE_DEV_SERVER_URL) {
    let url = VITE_DEV_SERVER_URL;
    const params = new URLSearchParams();
    if (projectPath) {
      params.append("projectPath", projectPath);
    } else if (forceEmpty) {
      params.append("empty", "true");
    }

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    window.loadURL(url);
  } else {
    const indexPath = path.join(RENDERER_DIST, "index.html");
    const params = new URLSearchParams();
    if (projectPath) {
      params.append("projectPath", projectPath);
    } else if (forceEmpty) {
      params.append("empty", "true");
    }

    const queryString = params.toString();
    if (queryString) {
      window.loadURL(`file://${indexPath}#/?${queryString}`);
    } else {
      window.loadFile(indexPath);
    }
  }

  return window;
}

function createMenu() {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ] as MenuItemConstructorOptions[],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            createWindow(undefined, true);
          },
        },
        { type: "separator" },
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const result = await dialog.showOpenDialog(focusedWindow!, {
              properties: ["openDirectory"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              createWindow(result.filePaths[0]);
            }
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] as MenuItemConstructorOptions[])
          : ([{ role: "close" }] as MenuItemConstructorOptions[])),
      ] as MenuItemConstructorOptions[],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle SIGINT and SIGTERM for better dev experience (Ctrl+C)
process.on("SIGINT", () => {
  app.quit();
});

process.on("SIGTERM", () => {
  app.quit();
});

app.on("before-quit", async () => {
  isQuitting = true;
  for (const projectPath of projectWatchers.keys()) {
    await stopWatcher(projectPath);
  }
  updateOpenProjects();
});

app.on("will-quit", async () => {
  isQuitting = true;
  for (const projectPath of projectWatchers.keys()) {
    await stopWatcher(projectPath);
  }
  updateOpenProjects();
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  createMenu();

  if (process.platform === "darwin") {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: "New Window",
        click() {
          createWindow(undefined, true);
        },
      },
    ]);
    app.dock?.setMenu(dockMenu);
  }

  const openProjects = store.getOpenProjects();
  if (openProjects.length > 0) {
    openProjects.forEach((project) => {
      if (project === "" || fs.existsSync(project)) {
        createWindow(project || undefined);
      }
    });
  } else {
    createWindow();
  }
});

ipcMain.handle("run-cli", async (_: IpcMainInvokeEvent, command: string) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error.message);
      else resolve(stdout || stderr);
    });
  });
});

let firstOpen = true;
ipcMain.handle("open-vscode", async (_: IpcMainInvokeEvent, path: string) => {
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

ipcMain.handle("select-directory", async (event: IpcMainInvokeEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
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

ipcMain.handle(
  "set-last-project",
  (event: IpcMainInvokeEvent, path: string | null) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (path) {
        // Check if already open in ANOTHER window
        for (const [id, p] of windowProjects.entries()) {
          if (p === path && id !== window.id) {
            const existingWindow = BrowserWindow.fromId(id);
            if (existingWindow) {
              existingWindow.focus();
              window.close();
              return true;
            }
          }
        }
        windowProjects.set(window.id, path);
      } else {
        windowProjects.delete(window.id);
      }
      updateOpenProjects();
    }
    return false;
  },
);

ipcMain.handle(
  "check-project-status",
  async (_: IpcMainInvokeEvent, directoryPath: string) => {
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

          const subProjects: SubProject[] = [];
          for (const entry of entries) {
            try {
              const pkg = JSON.parse(
                fs.readFileSync(entry, "utf-8"),
              ) as PackageJson;
              // We only care about packages that look like apps (vite/next) or have main/module?
              // For now, list all.
              subProjects.push({
                name: pkg.name || path.basename(path.dirname(entry)),
                path: path.dirname(entry),
              });
            } catch {
              // ignore
            }
          }

          // Discovery logic for subprojects...
          // (Existing code for finding subprojects)

          // DO NOT filter subprojects here anymore, so they show up in Settings
          // status.subProjects = subProjects.filter(...)
          status.subProjects = subProjects;
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
  },
);

ipcMain.handle(
  "save-project-config",
  async (
    _: IpcMainInvokeEvent,
    {
      config,
      directoryPath,
    }: { config: ReactMapConfig; directoryPath: string },
  ) => {
    try {
      // Load existing config to check if ignorePatterns changed
      const configPath = path.join(directoryPath, "react.map.config.json");
      let oldConfig: ReactMapConfig | null = null;
      if (fs.existsSync(configPath)) {
        try {
          oldConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (e) {
          console.error("Failed to read old config", e);
        }
      }

      const configContent = JSON.stringify(config, null, 2);
      fs.writeFileSync(configPath, configContent);
      store.addRecentProject(directoryPath);

      // If ignorePatterns changed, clear the analysis cache to force re-analysis
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
  },
);

ipcMain.handle("set-project", (_: IpcMainInvokeEvent, _path: string) => {
  // We can store it per-window if needed, but for now we'll rely on the renderer
  // and query params for the initial path.
  // If we need to track current project in main, we should use a Map<windowId, path>
});

ipcMain.handle(
  "git-status",
  async (_: IpcMainInvokeEvent, projectRoot: string): Promise<GitStatus> => {
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
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    options: number | { limit?: number; path?: string } = 50,
  ): Promise<GitCommit[]> => {
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
  },
);

ipcMain.handle(
  "git-stage",
  async (_: IpcMainInvokeEvent, projectRoot: string, files: string[]) => {
    const git = simpleGit(projectRoot);
    await git.add(files);
  },
);

ipcMain.handle(
  "git-unstage",
  async (_: IpcMainInvokeEvent, projectRoot: string, files: string[]) => {
    const git = simpleGit(projectRoot);
    await git.reset(["HEAD", ...files]);
  },
);

ipcMain.handle(
  "git-diff",
  async (
    _: IpcMainInvokeEvent,
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

async function performAnalysis(analysisPath: string, projectPath: string) {
  const targetPath = analysisPath;

  // Ensure configRoot is correct: if analysisPath is not under projectPath, use analysisPath as configRoot
  let configRoot = projectPath || analysisPath;
  if (projectPath && analysisPath !== projectPath) {
    const relative = path.relative(projectPath, analysisPath);
    const isUnder =
      relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    if (!isUnder) {
      configRoot = analysisPath;
    }
  }

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
    const configPath = path.join(configRoot, "react.map.config.json");
    let ignorePatterns: string[] | undefined = undefined;
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        ignorePatterns = config.ignorePatterns;
      } catch (e) {
        console.warn("Failed to load config for analysis", e);
      }
    }

    const graph = analyzeProject(targetPath, outputPath, ignorePatterns);

    // Merge with existing position data if available
    if (fs.existsSync(outputPath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(outputPath, "utf-8"));

        // Helper to recurse and map positions
        const positionMap = new Map<string, UIItemState>();

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
          if (item.ui) {
            positionMap.set(item.id, {
              x: item.ui.x,
              y: item.ui.y,
              radius: item.ui.radius,
              collapsedRadius: item.ui.collapsedRadius,
              expandedRadius: item.ui.expandedRadius,
              isLayoutCalculated: item.ui.isLayoutCalculated,
              collapsed: item.ui.collapsed,
            });

            // Collect renders and effects positions
            if (item.ui.renders) {
              for (const [id, pos] of Object.entries(item.ui.renders)) {
                positionMap.set(id, pos);
              }
            }

            // Collect virtual variables positions
            if (item.ui.vars) {
              for (const [id, pos] of Object.entries(item.ui.vars)) {
                positionMap.set(id, pos);
              }
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
            Object.assign(item.ui, pos);
          }

          // Apply to sub-items (renders, effects, virtual vars)
          const renderComboId = `${item.id}-render`;
          const renderPrefix = `${item.id}-render-`;
          const varPrefix = `${item.id}:`;

          for (const [id, subPos] of positionMap.entries()) {
            if (
              id === renderComboId ||
              id.startsWith(renderPrefix) ||
              id.startsWith(varPrefix)
            ) {
              if (!item.ui) item.ui = { x: 0, y: 0 };

              if (id === renderComboId || id.startsWith(renderPrefix)) {
                if (!item.ui.renders) item.ui.renders = {};
                item.ui.renders[id] = subPos;
              } else {
                if (!item.ui.vars) item.ui.vars = {};
                item.ui.vars[id] = subPos;
              }
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

        traverseApply(graph);
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
  async (_: IpcMainInvokeEvent, analysisPath: string, projectPath: string) => {
    await performAnalysis(analysisPath, projectPath);
    return path.basename(analysisPath);
  },
);

ipcMain.handle(
  "read-graph-data",
  async (_: IpcMainInvokeEvent, projectRoot: string, analysisPath?: string) => {
    const targetPath = analysisPath || projectRoot;
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
    _: IpcMainInvokeEvent,
    projectRoot: string,
    commitHash: string,
    subPath?: string,
  ): Promise<JsonData> => {
    const git = simpleGit(projectRoot);

    const resolvedHash = await git.revparse([commitHash]);

    // Ensure subPath is relative for cache key
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

      // Load ignore patterns from the project root config to apply to Git analysis
      const configPath = path.join(projectRoot, "react.map.config.json");
      let ignorePatterns: string[] | undefined = undefined;
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          ignorePatterns = config.ignorePatterns;
        } catch (e) {
          console.warn("Failed to load config for git analysis", e);
        }
      }

      const graph = analyzeProject(analysisPath, undefined, ignorePatterns);
      fs.writeFileSync(cachePath, JSON.stringify(graph, null, 2));
      return graph;
    } finally {
      tempDir.removeCallback();
    }
  },
);

ipcMain.handle(
  "analyze-diff",
  async (
    _: IpcMainInvokeEvent,
    dataA: JsonData,
    dataB: JsonData,
  ): Promise<JsonData> => {
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
            if (v.type === "jsx") {
              // JSX variables have ComponentInfoRenderDependency[] which don't need prop traversal for hash
              for (const p of v.props) {
                map.set(p.id, "");
              }
            } else {
              traverseProps(v.props as PropData[]);
            }
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
              deletedObjects[p.id] = p;
            }
            if (p.props) {
              traverseProps(p.props, v);
            }
          }
        };

        const traverse = (vars: Record<string, ComponentFileVar>) => {
          for (const v of Object.values(vars)) {
            if (targetIds.has(v.id)) {
              deletedObjects[v.id] = v;
            }
            if ("props" in v && v.props) {
              if (v.type === "jsx") {
                for (const p of v.props) {
                  if (targetIds.has(p.id)) {
                    // PropData and ComponentInfoRenderDependency are slightly different but we treat them as ChangeItemType conceptually
                    const pWithFile = {
                      ...p,
                      file: v.file,
                    } as unknown as PropData;
                    deletedObjects[p.id] = pWithFile;
                  }
                }
              } else {
                traverseProps(v.props as PropData[], v);
              }
            }
            if ("effects" in v && v.effects) {
              for (const effect of Object.values(v.effects)) {
                if (targetIds.has(effect.id)) {
                  deletedObjects[effect.id] = {
                    ...effect,
                    file: v.file,
                    kind: "effect",
                  } as EffectInfo;
                }
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

ipcMain.handle(
  "read-state",
  async (_: IpcMainInvokeEvent, projectRoot: string) => {
    const statePath = path.join(projectRoot, ".react-map", "state.json");
    if (fs.existsSync(statePath)) {
      try {
        return JSON.parse(fs.readFileSync(statePath, "utf-8"));
      } catch (e) {
        console.error("Error reading state.json", e);
      }
    }
    return null;
  },
);

ipcMain.handle(
  "save-state",
  async (_: IpcMainInvokeEvent, projectRoot: string, state: AppStateData) => {
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
    _: IpcMainInvokeEvent,
    projectRoot: string,
    analysisPath: string,
    positions: UIStateMap,
    contextId?: string,
  ) => {
    const targetPath = analysisPath;

    // Ensure configRoot is correct: if analysisPath is not under projectRoot, use analysisPath as configRoot
    let configRoot = projectRoot || analysisPath;
    if (projectRoot && analysisPath !== projectRoot) {
      const relative = path.relative(projectRoot, analysisPath);
      const isUnder =
        relative && !relative.startsWith("..") && !path.isAbsolute(relative);
      if (!isUnder) {
        configRoot = analysisPath;
      }
    }

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

      const applyUIState = (item: ComponentFileVar, stateMap: UIStateMap) => {
        const state = stateMap[item.id];
        if (state) {
          if (!item.ui) item.ui = { x: 0, y: 0 };
          item.ui.x = state.x;
          item.ui.y = state.y;

          if (state.radius !== undefined) {
            item.ui.radius = state.radius;
          }
          if (state.collapsedRadius !== undefined) {
            item.ui.collapsedRadius = state.collapsedRadius;
          }
          if (state.expandedRadius !== undefined) {
            item.ui.expandedRadius = state.expandedRadius;
          }
          if (state.collapsed !== undefined) {
            item.ui.collapsed = state.collapsed;
          }

          const isCombo =
            item.kind === "component" ||
            (item.kind === "hook" && item.type === "function");

          // Handle layout status
          if (contextId && item.id === contextId) {
            item.ui.isLayoutCalculated = true;
          } else if (contextId === "root") {
            if (!isCombo) item.ui.isLayoutCalculated = true;
          } else if (contextId) {
            // Child of a combo layout
            if (!isCombo) item.ui.isLayoutCalculated = true;
          } else if (state.isLayoutCalculated !== undefined) {
            // Full save from UI: trust the UI state
            item.ui.isLayoutCalculated = state.isLayoutCalculated;
          }
        }

        // Apply to sub-items (renders, effects, virtual vars)
        // We look for any keys in stateMap that are prefixed with this item's ID followed by a separator
        const renderComboId = `${item.id}-render`;
        const renderPrefix = `${item.id}-render-`;
        const varPrefix = `${item.id}:`;

        for (const [id, subState] of Object.entries(stateMap)) {
          if (
            id === renderComboId ||
            id.startsWith(renderPrefix) ||
            id.startsWith(varPrefix)
          ) {
            if (!item.ui) item.ui = { x: 0, y: 0 };

            // Render/Effect nodes
            if (id === renderComboId || id.startsWith(renderPrefix)) {
              if (!item.ui.renders) item.ui.renders = {};
              item.ui.renders[id] = {
                x: subState.x,
                y: subState.y,
                radius: subState.radius,
                collapsedRadius: subState.collapsedRadius,
                expandedRadius: subState.expandedRadius,
                isLayoutCalculated:
                  contextId === id ? true : subState.isLayoutCalculated,
                collapsed: subState.collapsed,
              };
            } else {
              // Virtual variables (destructuring)
              if (!item.ui.vars) item.ui.vars = {};
              item.ui.vars[id] = {
                x: subState.x,
                y: subState.y,
                radius: subState.radius,
                collapsedRadius: subState.collapsedRadius,
                expandedRadius: subState.expandedRadius,
                isLayoutCalculated:
                  contextId === id ? true : subState.isLayoutCalculated,
                collapsed: subState.collapsed,
              };
            }
          }
        }

        // Recurse into children
        if ("var" in item && item.var) {
          for (const v of Object.values(item.var)) {
            applyUIState(v, stateMap);
          }
        }
      };

      for (const file of Object.values(graphData.files)) {
        for (const variable of Object.values(file.var)) {
          applyUIState(variable, positions);
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

ipcMain.handle(
  "get-project-icon",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
  ): Promise<string | null> => {
    try {
      // 1. Check for local icons
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

      // 2. Check for GitHub remote
      if (fs.existsSync(path.join(projectRoot, ".git"))) {
        const git = simpleGit(projectRoot);
        try {
          const remotes = await git.getRemotes(true);
          const origin = remotes.find((r) => r.name === "origin") || remotes[0];
          if (origin && origin.refs.fetch) {
            const url = origin.refs.fetch;
            // Match github.com/owner/repo or github.com:owner/repo
            const match = url.match(/github\.com[/:]([^/]+)\//);
            if (match && match[1]) {
              const owner = match[1];
              return `https://github.com/${owner}.png`;
            }
          }
        } catch (e) {
          console.warn("Failed to get git remotes", e);
        }
      }

      return null;
    } catch (e) {
      console.error("Failed to get project icon", e);
      return null;
    }
  },
);

ipcMain.handle("get-global-config", async () => {
  return store.getGlobalConfig();
});

ipcMain.handle(
  "save-global-config",
  async (_: IpcMainInvokeEvent, config: GlobalSettings) => {
    store.saveGlobalConfig(config);
    updateOpenProjects();
    return true;
  },
);
