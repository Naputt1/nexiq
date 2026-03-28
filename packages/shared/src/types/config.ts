export type AppTheme = "dark" | "light";

export interface SubProject {
  name: string;
  path: string;
}

export interface NexiqConfig {
  entry?: string;
  aliases?: Record<string, string>;
  extensions?: string[];
  dependencyDepth?: number;
  analysisPath?: string;
  analysisPaths?: string[];
  ignorePatterns?: string[];
  ignoreSubProjects?: string[];
}
