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
  labels?: Record<string, string[]>;
  diff?: AnalyzedDiff;
};

export interface BenchmarkToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface BenchmarkStep {
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  toolCalls?: BenchmarkToolCall[];
  toolCallId?: string;
  toolName?: string;
  tokens: number;
}

export interface BenchmarkResult {
  scenarioId: string;
  projectName: string;
  approach: "baseline" | "react-map-cold" | "react-map-warm";
  testType: "single-prompt" | "planning";
  model: string;
  success: boolean;
  totalTokens: number;
  toolCallsCount: number;
  latencyMs: number;
  steps: BenchmarkStep[];
}

export * from "./types/index.js";
export * from "./component.js";
export * from "./utils.js";
