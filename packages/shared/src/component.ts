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

export type VarType = "function" | "data" | "jsx";
export type VarKind = "component" | "normal" | "hook" | "memo";

interface ComponentFileVarBaseType<TType extends VarType> {
  id: string;
  name: string;
  type: TType;
  dependencies: Record<string, ComponentFileVarDependency>;
}

export type ComponentFileVarBase<
  TType extends VarType,
  TKind extends VarKind,
> = ComponentLoc &
  ComponentFileVarBaseType<TType> & {
    kind: TKind;
  };

export interface ComponentFileVarBaseTypeFunction<
  TKind extends VarKind,
> extends ComponentFileVarBase<"function", TKind> {
  type: "function";
  scope: VariableScope;
  var: Record<string, ComponentFileVar>;
}

export interface ComponentFileVarBaseTypeData<
  TKind extends VarKind,
> extends ComponentFileVarBase<"data", TKind> {
  type: "data";
}

export type ComponentFileVarDependencyType<TKind extends VarKind> =
  | ComponentFileVarBaseTypeFunction<TKind>
  | ComponentFileVarBaseTypeData<TKind>;

export type ComponentFileVarReact<TKind extends VarKind> = ComponentFileVarBase<
  "function",
  TKind
> &
  ComponentFileVarBaseTypeFunction<TKind> &
  HookInfo;

export type ComponentFileVarComponent = ComponentFileVarReact<"component"> &
  ComponentInfo & {
    kind: "component";
  };

export type ComponentFileVarHook = ComponentFileVarReact<"hook"> & {
  kind: "hook";
};

export type MemoFileVarHook = ComponentFileVarReact<"memo"> & {
  kind: "memo";
  memoDependencies: string[];
};

export type ComponentFileVarNormalBase<TType extends VarType> = ComponentLoc &
  ComponentFileVarBase<TType, "normal"> & {
    components: Record<string, ComponentInfoRender>;
    kind: "normal";
  };

export type ComponentFileVarNormalFunction =
  ComponentFileVarNormalBase<"function"> &
    ComponentFileVarBaseTypeFunction<"normal">;
export type ComponentFileVarNormalData = ComponentFileVarNormalBase<"data"> &
  ComponentFileVarBaseTypeData<"normal">;

export type ComponentFileVarNormal =
  | ComponentFileVarNormalFunction
  | ComponentFileVarNormalData;

export type ComponentFileVarFunction =
  ComponentFileVarBaseTypeFunction<"normal"> & {
    kind: "normal";
  };

export type ComponentFileVar =
  | ComponentFileVarComponent
  | ComponentFileVarNormal
  | ComponentFileVarHook
  | MemoFileVarHook
  | ComponentFileVarFunction;

export type ComponentFile = {
  path: string;
  fingerPrint: string;
  hash: string;
  import: Record<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
  tsTypes: Record<string, TypeDataDeclare>;
  var: Record<string, ComponentFileVar>;
};
