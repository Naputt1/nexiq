export interface ReactMapConfig {
  entry?: string;
  aliases?: Record<string, string>;
  extensions?: string[];
  dependencyDepth?: number;
  analysisPath?: string;
}

export interface PnpmWorkspace {
  packages?: string[];
}

export interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

export interface SubProject {
  name: string;
  path: string;
}

export interface ProjectStatus {
  hasConfig: boolean;
  isMonorepo: boolean;
  projectType: "vite" | "next" | "unknown";
  config: ReactMapConfig | null;
  subProjects: SubProject[];
}
