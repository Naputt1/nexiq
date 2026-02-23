import type {
  ReactMapConfig,
  SubProject,
  CustomColors,
  ProjectStatus,
  AppStateData,
  GraphViewType,
} from "shared";

export type {
  ReactMapConfig,
  SubProject,
  CustomColors,
  ProjectStatus,
  AppStateData,
  GraphViewType,
};

export interface PnpmWorkspace {
  packages?: string[];
}

export interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

export interface IpcEvents {
  "main-process-message": string;
  "reload-project": void;
  "git-status-changed": void;
}

export interface GlobalSettings {
  theme: "dark" | "light";
  customColors?: CustomColors;
  autoReload?: boolean;
}
