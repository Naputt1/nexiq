export interface SubProject {
  name: string;
  path: string;
}

export interface ReactMapConfig {
  entry?: string;
  aliases?: Record<string, string>;
  extensions?: string[];
  dependencyDepth?: number;
  analysisPath?: string;
  ignorePatterns?: string[];
  ignoreSubProjects?: string[];
}
