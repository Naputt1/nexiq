import type { TypeDataDeclare } from "./types/index.js";
import type {
  PropDataType,
  TypeData,
  TypeDataLiteralTypeLiteral,
  TypeDataNull,
  TypeDataRef,
  TypeDataUndefined,
} from "./types/primitive.js";

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

export interface RefData extends ComponentLoc {
  id: string;
  value: string;
  defaultData: PropDataType;
}

export interface Memo extends ComponentLoc, ReactDependencies {
  id: string;
  value: string;
  scope: VariableScope;
}

export type ComponentInfoRenderDependency = {
  id: string;
  name: string;
  value: PropDataType;
  valueId?: string;
};

export interface ComponentInfoRender extends ComponentLoc {
  id: string;
  dependencies: ComponentInfoRenderDependency[];
  isDependency?: boolean;
}

export interface EffectInfo extends ComponentLoc, ReactDependencies {
  id: string;
  scope?: VariableScope;
}

export interface PropData {
  id: string;
  name: string;
  type: string;
  kind: "prop" | "spread";
  props?: PropData[];
}

export interface ReactFunctionInfoBase {
  states: string[];
  hooks: string[];
  props: PropData[];
  propType?: TypeData;
  effects: Record<string, EffectInfo>;
}

export interface ReactFunctionInfo extends ReactFunctionInfoBase {
  id: string;
  name: string;
  file: string;
}

export interface HookInfo extends ReactFunctionInfoBase {}

export interface ComponentInfo extends ReactFunctionInfoBase {
  componentType: "Function" | "Class";
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

export type ReactFunctionVar = "component" | "hook";
export type ReactStateVar = "state" | "ref";
export type ReactWithCallbackVar = "memo" | "callback";
export type ReactVarKind =
  | ReactFunctionVar
  | ReactStateVar
  | ReactWithCallbackVar;
export type VarKind = "normal" | ReactVarKind;

interface ComponentFileVarBaseType<TType extends VarType> {
  id: string;
  name: string;
  type: TType;
  file: string;
  hash?: string;
  dependencies: Record<string, ComponentFileVarDependency>;
  ui?:
    | {
        x: number;
        y: number;
        radius?: number;
        renders?: Record<string, { x: number; y: number; radius?: number }>;
        isLayoutCalculated?: boolean | undefined;
      }
    | undefined;
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

export type ComponentFileVarReact<
  TType extends VarType,
  TKind extends ReactVarKind,
> = ComponentFileVarBase<TType, TKind>;

export type ComponentFileVarReactFunction<TKind extends ReactVarKind> =
  ComponentFileVarBaseTypeFunction<TKind> & ReactFunctionInfoBase;

export type ReactDependency = {
  id: string;
  name: string;
};

export type ReactDependencies = {
  reactDeps: ReactDependency[];
};

export type ComponentFileVarReactWithCallback<TKind extends ReactVarKind> =
  ComponentFileVarBaseTypeFunction<TKind> & ReactDependencies;

export type ComponentFileVarComponent =
  ComponentFileVarReactFunction<"component"> &
    ComponentInfo & {
      kind: "component";
    };

export type ComponentFileVarState = ComponentFileVarReact<"data", "state"> & {
  value: string;
  setter?: string;
};

export type ComponentFileVarRef = ComponentFileVarReact<"data", "ref"> & {
  defaultData: PropDataType;
};

export type ComponentFileVarHook = ComponentFileVarReactFunction<"hook"> &
  HookInfo & {
    kind: "hook";
  };

export type ComponentFileVarCallback =
  ComponentFileVarReactWithCallback<"callback"> & ReactDependencies;

export type MemoFileVarHook = ComponentFileVarReactWithCallback<"memo"> &
  ReactDependencies;

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
  | ComponentFileVarState
  | ComponentFileVarRef
  | ComponentFileVarNormal
  | ComponentFileVarHook
  | ComponentFileVarCallback
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
