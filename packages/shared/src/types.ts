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

export type ComponentInfoRenderDependency = {
  id: string;
  value: string;
};

export interface ComponentInfoRender extends ComponentLoc {
  id: string;
  dependencies: ComponentInfoRenderDependency[];
  isDependency?: boolean;
}

export interface ComponentInfo {
  file: string;
  type: "Function" | "Class";
  states: State[];
  hooks: string[];
  props: string[];
  contexts: string[];
  renders: Record<string, ComponentInfoRender>;
}

export interface ComponentFileVarDependency {
  id: string;
  name: string;
}

export interface VariableLoc {
  line: number;
  column: number;
}

export interface ComponentLoc {
  loc: VariableLoc;
}

interface ComponentFileVarBase extends ComponentLoc {
  id: string;
  name: string;
  isComponent: boolean;
  dependencies: Record<string, ComponentFileVarDependency>;
  var: Record<string, ComponentFileVar>;
}

export interface ComponentFileVarComponent
  extends ComponentFileVarBase,
    ComponentInfo {
  isComponent: true;
}

export interface ComponentFileVarNormal extends ComponentFileVarBase {
  isComponent: false;
  type: "function" | "data";
  components: Record<string, ComponentInfoRender>;
}

export type ComponentFileVar =
  | ComponentFileVarComponent
  | ComponentFileVarNormal;

export type ComponentFile = {
  path: string;
  import: Record<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
  var: Record<string, ComponentFileVar>;
};

export interface State extends ComponentLoc {
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
  edges: DataEdge[];
  files: Record<string, ComponentFile>;
  ids: Record<string, string>;
  keys: string[];
};
