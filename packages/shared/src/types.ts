export type ComponentFileImport = {
  localName: string;
  importedName: string | null;
  source: string;
  type: "default" | "named" | "namespace" | "type";
  importKind: "value" | "type";
};

export type ComponentFileExport = {
  id: string;
  name: string;
  type: "default" | "named" | "namespace" | "type";
  exportKind: "value" | "type" | "component" | "function" | "class";
};

export type ComponentFile = {
  path: string;
  import: Record<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
};

export interface State {
  value: string;
  setter?: string;
}

export type HookInfo = {
  id: string;
  name: string;
  file: string;
  states: State[];
  props: string[];
};

export interface ComponentInfo {
  id: string;
  name: string;
  file: string;
  type: "Function" | "Class";
  states: State[];
  hooks: string[];
  props: string[];
  contexts: string[];
  renders: string[];
}

export type DataEdge = {
  from: string;
  to: string;
  label: string;
};

export interface Data {
  nodes: {
    id: string;
    label: string;
    type: string;
    file: string;
  }[];
  edges: DataEdge[];
}

export type JsonData = {
  src: string;
  nodes: Record<string, ComponentInfo>;
  edges: DataEdge[];
  files: Record<string, ComponentFile>;
  ids: Record<string, string>;
  keys: string[];
};
