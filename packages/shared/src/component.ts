import type { TypeDataDeclare } from "./types/index.js";
import type { TypeData } from "./types/primitive.js";

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

export interface State extends ComponentLoc {
  id: string;
  value: string;
  setter?: string;
}

export type ComponentInfoRenderDependency = {
  id: string;
  value: string;
};

export interface ComponentInfoRender extends ComponentLoc {
  id: string;
  dependencies: ComponentInfoRenderDependency[];
  isDependency?: boolean;
}

export interface EffectInfo extends ComponentLoc {
  id: string;
  scope?: VariableScope;
  dependencies: string[];
}

export interface PropData {
  name: string;
  type: string;
}

export type HookInfo = {
  id: string;
  name: string;
  file: string;
  states: Record<string, State>;
  props: PropData[];
  hooks: string[];
  effects: Record<string, EffectInfo>;
};

export interface ComponentInfo {
  file: string;
  componentType: "Function" | "Class";
  states: Record<string, State>;
  hooks: string[];
  props: PropData[];
  propType?: TypeData;
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

export interface VariableScope {
  start: VariableLoc;
  end: VariableLoc;
}

interface ComponentFileVarBaseType {
  type: "function" | "data";
  scope?: VariableScope;
}

export interface ComponentFileVarBaseTypeFunction
  extends ComponentFileVarBaseType {
  type: "function";
  scope: VariableScope;
}

export interface ComponentFileVarBaseTypeData extends ComponentFileVarBaseType {
  type: "data";
}

export type ComponentFileVarDependencyType =
  | ComponentFileVarBaseTypeFunction
  | ComponentFileVarBaseTypeData;

export type ComponentFileVarBase = ComponentLoc &
  ComponentFileVarDependencyType & {
    id: string;
    name: string;
    variableType: "component" | "normal" | "hook";
    dependencies: Record<string, ComponentFileVarDependency>;
    var: Record<string, ComponentFileVar>;
  };

export type ComponentFileVarComponent = ComponentFileVarBase &
  ComponentInfo &
  HookInfo & {
    variableType: "component";
  };

export type ComponentFileVarHook = ComponentFileVarBase &
  HookInfo & {
    variableType: "hook";
  };

export type ComponentFileVarNormal = ComponentFileVarBase & {
  type: "function" | "data";
  components: Record<string, ComponentInfoRender>;
  variableType: "normal";
};

export type ComponentFileVar =
  | ComponentFileVarComponent
  | ComponentFileVarNormal
  | ComponentFileVarHook;

export type ComponentFile = {
  path: string;
  import: Record<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
  tsTypes: Record<string, TypeDataDeclare>;
  var: Record<string, ComponentFileVar>;
};
