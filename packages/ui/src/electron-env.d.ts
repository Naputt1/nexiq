/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="vite-plugin-electron/electron-env" />

import { ProjectStatus, ReactMapConfig } from "../electron/types";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
    }
  }

  interface Window {
    ipcRenderer: {
      invoke(channel: "run-cli", command: string): Promise<string>;
      invoke(channel: "open-vscode", path: string): Promise<string>;
      invoke(channel: "select-directory"): Promise<string | null>;
      invoke(channel: "get-recent-projects"): Promise<string[]>;
      invoke(
        channel: "check-project-status",
        directoryPath: string,
      ): Promise<ProjectStatus>;
      invoke(
        channel: "save-project-config",
        args: { config: ReactMapConfig; directoryPath: string },
      ): Promise<boolean>;
      invoke(channel: "set-project", path: string): Promise<void>;
      invoke(channel: "get-project"): Promise<string | null>;
      invoke(
        channel: "analyze-project",
        analysisPath: string,
        projectPath: string,
      ): Promise<string>;
      invoke(channel: "read-graph-data", projectPath?: string): Promise<any>;
      on(
        channel: string,
        listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void,
      ): void;
      off(
        channel: string,
        listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void,
      ): void;
      send(channel: string, ...args: any[]): void;
    };
  }
}

export {};
