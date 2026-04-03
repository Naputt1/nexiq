import type { TypeDataDeclare, UIItemState } from "./types/index.ts";
import type { PropDataType, TypeData } from "./types/primitive.ts";

export type ComponentFileImport = {
  localName: string;
  importedName: string | null;
  source: string;
  type: "default" | "named" | "namespace" | "type";
  importKind: "value" | "type";
  resolvedId?: string | undefined;
  unresolvedWorkspace?: boolean | undefined;
};

export type ComponentFileExport = {
  id: string;
  name: string;
  type: "default" | "named" | "namespace" | "type";
  exportKind: "value" | "type" | "component" | "function" | "class";
};

export interface State extends ComponentLoc {
  id: string;
  setter?: string | undefined;
  parentId?: string | undefined;
}

export interface RefData extends ComponentLoc {
  id: string;
  defaultData: PropDataType;
  parentId?: string | undefined;
}

export interface Memo extends ComponentLoc, ReactDependencies {
  id: string;
  scope: VariableScope;
  async?: boolean | undefined;
  parentId?: string | undefined;
}

export type ComponentInfoRenderDependency = {
  id: string;
  name: string;
  value: PropDataType;
  valueId?: string;
};

export interface ComponentInfoRender extends ComponentLoc {
  id: string;
  tag: string;
  instanceId: string;
  parentId?: string | undefined;
  dependencies: ComponentInfoRenderDependency[];
  isDependency?: boolean | undefined;
  renderIndex: number;
  kind: "jsx" | "ternary" | "loop" | "expression" | "hook" | "call";
  children: Record<string, ComponentInfoRender>;
}

export interface EffectInfo extends ComponentLoc, ReactDependencies {
  id: string;
  name?: string;
  scope?: VariableScope;
  file?: string;
  kind?: "effect";
}

export interface PropData {
  id: string;
  name: string;
  type: string;
  kind: "prop" | "spread";
  props?: PropData[];
  hash?: string;
  gitStatus?: "added" | "modified" | "deleted";
  file?: string;
  loc?: VariableLoc;
  defaultValue?: PropDataType | undefined;
}

export interface ReactFunctionInfoBase {
  states: string[];
  refs: string[];
  hooks: string[];
  props: PropData[];
  propName?: string | undefined;
  propType?: TypeData | undefined;
  effects: Record<string, EffectInfo>;
}

export interface ReactFunctionInfo extends ReactFunctionInfoBase {
  id: string;
  name: string;
  file: string;
}

export type HookInfo = ReactFunctionInfoBase;

export interface ComponentInfoBase {
  contexts: string[];
  forwardRef?: boolean;
}

export interface FunctionComponentInfo
  extends ReactFunctionInfoBase, ComponentInfoBase {
  componentType: "Function";
}

export interface ClassComponentInfo
  extends ReactFunctionInfoBase, ComponentInfoBase {
  componentType: "Class";
  stateType?: TypeData | undefined;
}

export type ComponentInfo = FunctionComponentInfo | ClassComponentInfo;

export interface ComponentFileVarDependency {
  id: string;
  name: string;
}

export type UsageRelationKind =
  | "usage-read"
  | "usage-call"
  | "usage-write"
  | "usage-render-call";

export type RelationKind =
  | "render"
  | "dependency"
  | "parent-child"
  | "import"
  | UsageRelationKind
  | (string & {});

export interface UsageOccurrence {
  usageId: string;
  filePath: string;
  line: number;
  column: number;
  ownerId: string;
  ownerKind: string;
  accessPath?: string[] | undefined;
  isOptional?: boolean | undefined;
  isComputed?: boolean | undefined;
  hiddenIntermediate?: string | undefined;
  displayLabel?: string | undefined;
}

export interface ComponentRelation {
  from_id: string;
  to_id: string;
  kind: RelationKind;
  line?: number | null | undefined;
  column?: number | null | undefined;
  data_json?: UsageOccurrence | Record<string, unknown> | null | undefined;
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

export type VarType = "function" | "data" | "jsx" | "class";

export type ReactFunctionVar = "component" | "hook";
export type ReactStateVar = "state" | "ref";
export type ReactWithCallbackVar = "memo" | "callback";
export type ReactVarKind =
  | ReactFunctionVar
  | ReactStateVar
  | ReactWithCallbackVar;
export type VarKind = "normal" | "class" | "method" | "property" | ReactVarKind;

export type VariableNamePattern =
  | { type: "identifier"; name: string; loc: VariableLoc; id: string }
  | {
      type: "object";
      properties: VariableObjectProperty[];
      raw: string;
      loc: VariableLoc;
      id: string;
    }
  | {
      type: "array";
      elements: VariableArrayElement[];
      raw: string;
      loc: VariableLoc;
      id: string;
    }
  | {
      type: "rest";
      argument: VariableNamePattern;
      loc: VariableLoc;
      id: string;
    }
  | {
      type: "void";
      loc: VariableLoc;
      id: string;
    };

export type VariableObjectProperty = {
  key: string;
  value: VariableNamePattern;
  loc: VariableLoc;
};

export type VariableArrayElement =
  | { type: "element"; value: VariableNamePattern; loc: VariableLoc }
  | { type: "rest"; value: VariableNamePattern; loc: VariableLoc }
  | null;

export type VariableName = VariableNamePattern;

interface ComponentFileVarBaseType<TType extends VarType> {
  id: string;
  name: VariableName;
  type: TType;
  file: string;
  hash?: string | undefined;
  parentId?: string | undefined;
  declarationKind?:
    | "const"
    | "let"
    | "var"
    | "using"
    | "await using"
    | undefined;
  dependencies: Record<string, ComponentFileVarDependency>;
  ui?:
    | (UIItemState & {
        renders?: Record<string, UIItemState>;
        vars?: Record<string, UIItemState>;
      })
    | undefined;
}

export interface ComponentFileVarBase<
  TType extends VarType,
  TKind extends VarKind,
>
  extends ComponentLoc, ComponentFileVarBaseType<TType> {
  kind: TKind;
  isStatic?: boolean | undefined;
  memberKind?: string | undefined;
}

export type FunctionReturn = PropDataType | ComponentFileVarJSX | string;

export interface ComponentFileVarBaseTypeFunction<
  TKind extends VarKind,
  TType extends VarType = "function",
> extends ComponentFileVarBase<TType, TKind> {
  type: TType;
  scope: VariableScope;
  async?: boolean | undefined;
  var: Record<string, ComponentFileVar>;
  return?: FunctionReturn | undefined;
  superClass?: { id?: string; name: string } | undefined;
}

export interface ComponentFileVarBaseTypeData<
  TKind extends VarKind,
  TType extends VarType = "data",
> extends ComponentFileVarBase<TType, TKind> {
  type: TType;
  children?: Record<string, ComponentInfoRender>;
}

export type ComponentFileVarDependencyType<TKind extends VarKind> =
  | ComponentFileVarBaseTypeFunction<TKind>
  | ComponentFileVarBaseTypeData<TKind>;

export type ComponentFileVarReact<
  TType extends VarType,
  TKind extends ReactVarKind,
> = ComponentFileVarBase<TType, TKind>;

export type ComponentFileVarReactFunction<
  TKind extends ReactVarKind,
  TType extends VarType = "function",
> = ComponentFileVarBaseTypeFunction<TKind, TType> & ReactFunctionInfoBase;

export type ReactDependency = {
  id: string;
  name: string;
};

export type ReactDependencies = {
  reactDeps: ReactDependency[];
};

export type ComponentFileVarReactWithCallback<
  TKind extends ReactVarKind,
  TType extends VarType = "function",
> = ComponentFileVarBaseTypeFunction<TKind, TType> & ReactDependencies;

export type ComponentFileVarFunctionComponent = ComponentFileVarReactFunction<
  "component",
  "function"
> &
  FunctionComponentInfo & {
    kind: "component";
  };

export type ComponentFileVarClassComponent = ComponentFileVarReactFunction<
  "component",
  "class"
> &
  ClassComponentInfo & {
    kind: "component";
  };

export type ComponentFileVarComponent =
  | ComponentFileVarFunctionComponent
  | ComponentFileVarClassComponent;

export type ComponentFileVarState = ComponentFileVarReact<"data", "state"> & {
  setter?: string | undefined;
  stateType?: TypeData | undefined;
};

export type ComponentFileVarCallHook = ComponentFileVarReact<"data", "hook"> & {
  call: {
    id: string;
    name: string;
    resolvedId?: string | undefined;
    unresolvedWorkspace?: boolean | undefined;
  };
};

export type ComponentFileVarRef = ComponentFileVarReact<"data", "ref"> & {
  defaultData: PropDataType;
};

export type ComponentFileVarHook = ComponentFileVarReactFunction<
  "hook",
  "function"
> &
  HookInfo & {
    kind: "hook";
  };

export type ComponentFileVarCallback =
  ComponentFileVarReactWithCallback<"callback"> & ReactDependencies;

export type MemoFileVarHook = ComponentFileVarReactWithCallback<"memo"> &
  ReactDependencies;

export type ComponentFileVarNormalBase<TType extends VarType> = ComponentLoc &
  ComponentFileVarBase<TType, "normal"> & {
    kind: "normal";
  };

export type ComponentFileVarNormalFunction = ComponentFileVarNormalBase<
  "function" | "class"
> &
  ComponentFileVarBaseTypeFunction<"normal">;
export type ComponentFileVarNormalData = ComponentFileVarNormalBase<"data"> &
  ComponentFileVarBaseTypeData<"normal">;

export type ComponentFileVarNormal =
  | ComponentFileVarNormalFunction
  | ComponentFileVarNormalData;

export interface ComponentFileVarJSX extends ComponentFileVarBase<
  "jsx",
  "normal"
> {
  type: "jsx";
  render: ComponentInfoRender | null;
  srcId?: string | undefined;
}

export type ComponentFileVarClass = ComponentFileVarBaseTypeData<
  "class",
  "data"
> & {
  var: Record<string, ComponentFileVar>;
  scope: VariableScope;
  superClass?: { id?: string; name: string } | undefined;
};

export type ComponentFileVarMethod = ComponentFileVarBaseTypeFunction<
  "method",
  "function"
>;

export type ComponentFileVarProperty = ComponentFileVarBaseTypeData<
  "property",
  "data"
>;

export type ComponentFileVarFunction =
  ComponentFileVarBaseTypeFunction<"normal"> & {
    kind: "normal";
  };

export type ComponentFileVar =
  | ComponentFileVarComponent
  | ComponentFileVarState
  | ComponentFileVarCallHook
  | ComponentFileVarRef
  | ComponentFileVarNormal
  | ComponentFileVarHook
  | ComponentFileVarCallback
  | MemoFileVarHook
  | ComponentFileVarFunction
  | ComponentFileVarJSX
  | ComponentFileVarClass
  | ComponentFileVarMethod
  | ComponentFileVarProperty;

export type IResolveAddRender = {
  type: "comAddRender";
  fileName: string;
  tag: string;
  dependency: ComponentInfoRenderDependency[];
  loc: VariableLoc;
  kind?: ComponentInfoRender["kind"] | undefined;
  parentId?: string | undefined;
};
export type IResolveAddHook = {
  type: "comAddHook";
  name: string;
  fileName: string;
  hook: string;
  loc: VariableLoc;
  parentId?: string | undefined;
};

export type IResolveCallHook = {
  type: "comResolveCallHook";
  fileName: string;
  loc: VariableLoc;
  id: string;
  hook: string;
};

export type IResolveTsType = {
  type: "tsType";
  fileName: string;
  id: string;
};

export type IResolveComPropsTsType = {
  type: "comPropsTsType";
  fileName: string;
  id: string;
};

export type IResolveComClassStateTsType = {
  type: "comClassStateTsType";
  fileName: string;
  id: string;
};

export type IResolveCrossPackageImport = {
  type: "crossPackageImport";
  fileName: string;
  source: string;
  localName: string;
  importedName: string | null;
  importType: ComponentFileImport["type"];
  importKind: ComponentFileImport["importKind"];
  message?: string | undefined;
};

export type ComponentDBResolve =
  | IResolveAddRender
  | IResolveAddHook
  | IResolveCallHook
  | IResolveTsType
  | IResolveComPropsTsType
  | IResolveComClassStateTsType
  | IResolveCrossPackageImport;

export type ComponentFile = {
  path: string;
  fingerPrint: string;
  hash: string;
  import: Record<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  starExports: string[];
  defaultExport: string | null;
  tsTypes: Record<string, TypeDataDeclare>;
  var: Record<string, ComponentFileVar>;
  relations?: ComponentRelation[] | undefined;
  package_id?: string | undefined;
};
