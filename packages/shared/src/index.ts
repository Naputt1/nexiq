import type {
  ComponentFile,
  ComponentFileVar,
  PropData,
  EffectInfo,
} from "./component.js";

export type DataEdge = {
  from: string;
  to: string;
  label: string;
};

export type AnalyzedDiff = {
  added: string[];
  modified: string[];
  deleted: string[];
  deletedObjects?: Record<string, ComponentFileVar | PropData | EffectInfo>;
};

export type JsonData = {
  src: string;
  edges: DataEdge[];
  files: Record<string, ComponentFile>;
  diff?: AnalyzedDiff;
};

export * from "./types/index.js";
export * from "./component.js";
export * from "./utils.js";
