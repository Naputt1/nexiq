/// <reference types="vite-plugin-electron/electron-env" />

import { JsonData, GitStatus, GitCommit, GitFileDiff, UIStateMap } from "shared";
import {
  AppStateData,
  IpcEvents,
  ProjectStatus,
  ReactMapConfig,
  GlobalSettings,
} from "../electron/types";
import type { GraphData } from "./graph/hook";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
    }
  }

  interface Window {
    reactMapGraph: GraphData;
    reactMapSearch: (value: string) => void;
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
      invoke(
        channel: "read-graph-data",
        projectRoot: string,
        analysisPath?: string,
      ): Promise<JsonData | null>;
      invoke(
        channel: "read-state",
        projectRoot: string,
      ): Promise<AppStateData | null>;
      invoke(
        channel: "save-state",
        projectRoot: string,
        state: AppStateData,
      ): Promise<boolean>;
      invoke(channel: "git-status", projectRoot: string): Promise<GitStatus>;
      invoke(
        channel: "git-log",
        projectRoot: string,
        options?: number | { limit?: number; path?: string },
      ): Promise<GitCommit[]>;
      invoke(
        channel: "git-stage",
        projectRoot: string,
        files: string[],
      ): Promise<void>;
      invoke(
        channel: "git-unstage",
        projectRoot: string,
        files: string[],
      ): Promise<void>;
      invoke(
        channel: "git-diff",
        projectRoot: string,
        options: {
          file?: string;
          commit?: string;
          staged?: boolean;
          baseCommit?: string;
        },
      ): Promise<GitFileDiff[]>;
      invoke(
        channel: "git-analyze-commit",
        projectRoot: string,
        commitHash: string,
        subPath?: string,
      ): Promise<JsonData>;
      invoke(
        channel: "analyze-diff",
        dataA: JsonData,
        dataB: JsonData,
      ): Promise<JsonData>;
      on<K extends keyof IpcEvents>(
        channel: K,
        listener: (payload: IpcEvents[K]) => void,
      ): () => void;
      send(channel: string, ...args: unknown[]): void;
      invoke(channel: "get-last-project"): Promise<string | null>;
      invoke(
        channel: "set-last-project",
        path: string | null,
      ): Promise<boolean>;
      invoke(
        channel: "update-graph-position",
        projectRoot: string,
        analysisPath: string,
        positions: UIStateMap,
        contextId?: string,
      ): Promise<boolean>;
      invoke(
        channel: "get-project-icon",
        projectRoot: string,
      ): Promise<string | null>;
      invoke(channel: "get-global-config"): Promise<GlobalSettings>;
      invoke(
        channel: "save-global-config",
        config: GlobalSettings,
      ): Promise<boolean>;
      invoke(
        channel: "save-state",
        projectRoot: string,
        state: AppStateData,
      ): Promise<boolean>;
    };
  }
}

export {};
