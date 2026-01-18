export interface ProjectConfig {
  entry?: string;
  aliases?: Record<string, string>;
  extensions?: string[];
  dependencyDepth?: number;
  analysisPath?: string;
}

export interface ProjectStatus {
  hasConfig: boolean;
  isMonorepo: boolean;
  projectType: "vite" | "next" | "unknown";
  config: ProjectConfig | null;
  subProjects?: { name: string; path: string }[];
}

export interface RecentProject {
  path: string;
  lastOpened?: number; // Optional if we want to track timestamp later
}
