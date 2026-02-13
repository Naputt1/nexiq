import type { ReactMapConfig, SubProject, CustomColors } from "shared";

export type { ReactMapConfig, SubProject, CustomColors };

export interface PnpmWorkspace {
  packages?: string[];
}

export interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

export interface ProjectStatus {
  hasConfig: boolean;
  isMonorepo: boolean;
  projectType: "vite" | "next" | "unknown";
  config: ReactMapConfig | null;
  subProjects: SubProject[];
}

export interface IpcEvents {
  "main-process-message": string;
  "reload-project": void;
  "git-status-changed": void;
}

export interface AppStateData {
  selectedSubProject: string | null;
  centeredItemId: string | null;
  selectedId: string | null;
  isSidebarOpen: boolean;
  activeTab: "projects" | "git";
  selectedCommit: string | null;
  viewport?: { x: number; y: number; zoom: number } | null;
}
export interface GlobalSettings {
  theme: "dark" | "light";
  customColors?: CustomColors;
}
