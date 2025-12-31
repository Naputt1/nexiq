import type { ComponentFile } from "./component.js";

export type DataEdge = {
  from: string;
  to: string;
  label: string;
};

export type JsonData = {
  src: string;
  edges: DataEdge[];
  files: Record<string, ComponentFile>;
};

export * from "./types/index.js";
export * from "./component.js";
