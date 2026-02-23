import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  type IpcMainInvokeEvent,
} from "electron";
import { store } from "./store";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec } from "node:child_process";
import os from "node:os";

import { WebSocket, type MessageEvent } from "ws";
import { spawn, ChildProcess } from "node:child_process";

const BACKEND_PORT = 3030;
let backendProcess: ChildProcess | null = null;
let backendWs: WebSocket | null = null;

async function startBackend() {
  if (backendProcess) return;

  const serverDist = path.join(
    process.env.APP_ROOT!,
    "..",
    "server",
    "dist",
    "index.js",
  );
  console.log(`Starting backend from: ${serverDist}`);

  backendProcess = spawn("node", [serverDist], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      PORT: BACKEND_PORT.toString(),
      NODE_ENV: VITE_DEV_SERVER_URL ? "development" : "production",
    },
  });

  backendProcess.on("error", (err) => {
    console.error("Failed to start backend process:", err);
  });

  backendProcess.on("exit", (code) => {
    console.log(`Backend process exited with code ${code}`);
    backendProcess = null;
  });

  // Wait a bit for the server to start
  await new Promise((resolve) => setTimeout(resolve, 2000));
  connectToBackend();
}

function connectToBackend() {
  if (backendWs) return;

  backendWs = new WebSocket(`ws://localhost:${BACKEND_PORT}`);

  backendWs.on("open", () => {
    console.log("Connected to shared backend");
  });

  backendWs.on("message", (data) => {
    try {
      JSON.parse(data.toString());
      // Handle messages from backend (e.g., project_opened, graph_data)
      // This will need to be integrated with the window management logic
    } catch (e: unknown) {
      console.error("Error handling backend message", e);
    }
  });

  backendWs.on("error", (err) => {
    console.warn("Backend connection error, retrying in 5s...", err.message);
    backendWs = null;
    setTimeout(connectToBackend, 5000);
  });

  backendWs.on("close", () => {
    console.log("Backend connection closed");
    backendWs = null;
  });
}

async function requestBackend<K extends BackendMessageType>(
  type: K,
  payload: BackendRequestMap[K]["payload"],
  timeoutMs: number = 30000,
): Promise<BackendRequestMap[K]["response"]> {
  if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
    throw new Error("Backend not connected");
  }

  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(7);
    const timeout = setTimeout(() => {
      backendWs!.removeEventListener("message", onMessage);
      reject(new Error(`Timeout waiting for backend response: ${type}`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      try {
        const {
          type: responseType,
          payload: responsePayload,
          requestId: responseId,
        } = JSON.parse(event.data.toString());
        if (responseId !== requestId) return;

        clearTimeout(timeout);
        backendWs!.removeEventListener("message", onMessage);

        if (responseType === "error") {
          reject(new Error(responsePayload.message || "Unknown backend error"));
        } else {
          resolve(responsePayload);
        }
      } catch {
        // Ignore parsing errors for other messages
      }
    };

    backendWs!.addEventListener("message", onMessage);
    backendWs!.send(JSON.stringify({ type, payload, requestId }));
  });
}

import type { AppStateData, GlobalSettings } from "./types";
import type {
  JsonData,
  GitStatus,
  GitCommit,
  GitFileDiff,
  UIStateMap,
  PropData,
  ComponentFileVar,
  EffectInfo,
  ReactMapConfig,
  BackendRequestMap,
  BackendMessageType,
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

const windowProjects = new Map<number, string | null>();
let isQuitting = false;

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
  store.setOpenProjects(
    Array.from(windowProjects.values()).map((p) => p || ""),
  );

  window.on("closed", () => {
    if (!isQuitting) {
      windowProjects.delete(window.id);
      store.setOpenProjects(
        Array.from(windowProjects.values()).map((p) => p || ""),
      );
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
  store.setOpenProjects(
    Array.from(windowProjects.values()).map((p) => p || ""),
  );
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

app.on("will-quit", async () => {
  isQuitting = true;
  store.setOpenProjects(
    Array.from(windowProjects.values()).map((p) => p || ""),
  );
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
  startBackend();

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
      createWindow(project || undefined);
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
      store.setOpenProjects(
        Array.from(windowProjects.values()).map((p) => p || ""),
      );
    }
    return false;
  },
);

ipcMain.handle(
  "check-project-status",
  async (_: IpcMainInvokeEvent, directoryPath: string) => {
    return requestBackend("check_project_status", {
      projectPath: directoryPath,
    });
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
    const result = await requestBackend("save_project_config", {
      projectPath: directoryPath,
      config,
    });
    if (result.success) {
      store.addRecentProject(directoryPath);
    }
    return result.success;
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
    return requestBackend("git_status", {
      projectPath: projectRoot,
    });
  },
);

ipcMain.handle(
  "git-log",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    options: number | { limit?: number; path?: string } = 50,
  ): Promise<GitCommit[]> => {
    return requestBackend("git_log", {
      projectPath: projectRoot,
      options,
    });
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
    return requestBackend("git_diff", {
      projectPath: projectRoot,
      options,
    });
  },
);

ipcMain.handle(
  "analyze-project",
  async (_: IpcMainInvokeEvent, analysisPath: string, projectPath: string) => {
    await requestBackend("open_project", {
      projectPath,
      subProject: analysisPath === projectPath ? undefined : analysisPath,
    });
    return path.basename(analysisPath);
  },
);

ipcMain.handle(
  "read-graph-data",
  async (_: IpcMainInvokeEvent, projectRoot: string, analysisPath?: string) => {
    const targetPath = analysisPath || projectRoot;
    if (!targetPath) return null;

    return requestBackend("get_graph_data", {
      projectPath: projectRoot,
      subProject: analysisPath === projectRoot ? undefined : analysisPath,
    });
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
    return requestBackend("git_analyze_commit", {
      projectPath: projectRoot,
      commitHash,
      subPath,
    });
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

          if ("children" in v && v.children) {
            for (const render of Object.values(v.children)) {
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
    return requestBackend("read_state", { projectPath: projectRoot });
  },
);

ipcMain.handle(
  "save-state",
  async (_: IpcMainInvokeEvent, projectRoot: string, state: AppStateData) => {
    return requestBackend("save_state", {
      projectPath: projectRoot,
      state,
    });
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
    return requestBackend("update_graph_position", {
      projectPath: projectRoot,
      subProject: analysisPath === projectRoot ? undefined : analysisPath,
      positions,
      contextId,
    });
  },
);

ipcMain.handle(
  "get-project-icon",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
  ): Promise<string | null> => {
    return requestBackend("get_project_icon", {
      projectPath: projectRoot,
    });
  },
);

ipcMain.handle("get-global-config", async () => {
  return store.getGlobalConfig();
});

ipcMain.handle(
  "save-global-config",
  async (_: IpcMainInvokeEvent, config: GlobalSettings) => {
    store.saveGlobalConfig(config);
    return true;
  },
);
