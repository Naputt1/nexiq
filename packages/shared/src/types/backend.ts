import type { JsonData } from "../index.js";
import type {
  ProjectStatus,
  GitStatus,
  GitCommit,
  GitFileDiff,
  ReactMapConfig,
  AppStateData,
  UIStateMap,
} from "./index.js";

export interface BackendRequestMap {
  check_project_status: {
    payload: { projectPath: string };
    response: ProjectStatus;
  };
  save_project_config: {
    payload: { projectPath: string; config: ReactMapConfig };
    response: { success: boolean };
  };
  get_project_icon: {
    payload: { projectPath: string };
    response: string | null;
  };
  git_status: {
    payload: { projectPath: string };
    response: GitStatus;
  };
  git_log: {
    payload: { projectPath: string; options: any };
    response: GitCommit[];
  };
  git_diff: {
    payload: { projectPath: string; options: any };
    response: GitFileDiff[];
  };
  git_analyze_commit: {
    payload: { projectPath: string; commitHash: string; subPath?: string };
    response: JsonData;
  };
  open_project: {
    payload: { projectPath: string; subProject?: string };
    response: void;
  };
  get_graph_data: {
    payload: { projectPath: string; subProject?: string };
    response: JsonData;
  };
  read_state: {
    payload: { projectPath: string };
    response: unknown;
  };
  save_state: {
    payload: { projectPath: string; state: AppStateData };
    response: boolean;
  };
  update_graph_position: {
    payload: {
      projectPath: string;
      subProject?: string;
      positions: UIStateMap;
      contextId?: string;
    };
    response: boolean;
  };
  call_tool: {
    payload: { name: string; arguments: Record<string, unknown> };
    response: any;
  };
}

export type BackendMessageType = keyof BackendRequestMap;
