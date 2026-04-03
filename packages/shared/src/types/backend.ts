import type {
  ProjectStatus,
  GitStatus,
  GitCommit,
  GitFileDiff,
  NexiqConfig,
  AppStateData,
} from "./index.ts";

export interface BackendRequestMap {
  check_project_status: {
    payload: { projectPath: string };
    response: ProjectStatus;
  };
  save_project_config: {
    payload: { projectPath: string; config: NexiqConfig };
    response: { success: boolean };
  };
  get_project_icon: {
    payload: { projectPath: string };
    response: { icon: string } | null;
  };
  git_status: {
    payload: { projectPath: string };
    response: GitStatus;
  };
  git_log: {
    payload: {
      projectPath: string;
      options: number | { limit?: number; path?: string };
    };
    response: GitCommit[];
  };
  git_diff: {
    payload: {
      projectPath: string;
      options: {
        file?: string;
        commit?: string;
        baseCommit?: string;
        staged?: boolean;
      };
    };
    response: GitFileDiff[];
  };
  git_analyze_commit: {
    payload: { projectPath: string; commitHash: string; subPath?: string };
    response: { sqlitePath: string };
  };
  open_project: {
    payload: {
      projectPath: string;
      subProject?: string;
      subProjects?: string[];
    };
    response: { sqlitePath: string };
  };
  read_state: {
    payload: { projectPath: string };
    response: unknown;
  };
  save_state: {
    payload: { projectPath: string; state: AppStateData };
    response: boolean;
  };
  call_tool: {
    payload: { name: string; arguments: Record<string, unknown> };
    response: unknown;
  };
  chunked_response: {
    payload: {
      chunk: string;
      index: number;
      total: number;
      originalType: string;
    };
    response: void;
  };
}

export type BackendMessageType = keyof BackendRequestMap;
