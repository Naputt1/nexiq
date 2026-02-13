export type AppTheme = "dark" | "light";

export interface CustomColors {
  nodeHighlight?: string;
  comboHighlight?: string;
  arrowColor?: string;
  labelColor?: string;
  gitAdded?: string;
  gitModified?: string;
  gitDeleted?: string;
  // Node types
  stateNode?: string;
  memoNode?: string;
  callbackNode?: string;
  refNode?: string;
  effectNode?: string;
  propNode?: string;
  componentNode?: string;
  hookNode?: string;
  renderNode?: string;
  // Type highlighting
  typeKeyword?: string;
  typeLiteral?: string;
  typeString?: string;
  typeNumber?: string;
  typeBoolean?: string;
  typePunctuation?: string;
  typeReference?: string;
  typeComponent?: string;
  typeDefault?: string;
  // UI Specific
  genericsColor?: string;
}

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
