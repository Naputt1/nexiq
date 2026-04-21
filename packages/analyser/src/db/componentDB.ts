import assert from "assert";
import type {
  ComponentFileImport,
  DataEdge,
  ComponentFileExport,
  JsonData,
  ComponentFileVar,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  VariableLoc,
  ComponentInfoRender,
  ComponentFileVarHook,
  EffectInfo,
  TypeDataDeclareInterface,
  TypeDataDeclareType,
  ComponentFile,
  Memo,
  RefData,
  VariableName,
  VarKind,
  FunctionReturn,
  ComponentDBResolve,
  ComponentFileVarClass,
  ComponentFileVarMethod,
  ComponentFileVarBaseTypeFunction,
  ComponentFileVarProperty,
  ComponentFileVarNormal,
  ComponentFileVarState,
  ComponentFileVarFunctionComponent,
  ComponentFileVarClassComponent,
  TypeData,
  PropData,
  PropDataType,
  ComponentFileVarJSX,
} from "@nexiq/shared";
import { FileDB } from "./fileDB.ts";
import type { PackageJson } from "./packageJson.ts";
import fs from "fs";
import path from "path";
import {
  ClassComponentVariable,
  FunctionComponentVariable,
} from "./variable/component.ts";
import { DataVariable } from "./variable/dataVariable.ts";
import { JSXVariable } from "./variable/jsx.ts";
import type { Variable } from "./variable/variable.ts";
import {
  isComponentVariable,
  isBaseFunctionVariable,
  isCallHookVariable,
  isJSXVariable,
  isReactFunctionVariable,
  isClassComponentVariable,
} from "./variable/type.ts";
import { HookVariable } from "./variable/hook.ts";
import { FunctionVariable } from "./variable/functionVariable.ts";
import { ClassVariable } from "./variable/classVariable.ts";
import { getDeterministicId } from "../utils/hash.ts";
import { getVariableNameKey } from "../analyzer/pattern.ts";
import type { ReactFunctionVariable } from "./variable/reactFunctionVariable.ts";
import { SqliteDB } from "./sqlite.ts";
import { PropertyVariable } from "./variable/propertyVariable.ts";
import { MethodVariable } from "./variable/methodVariable.ts";
import { StateVariable } from "./variable/stateVariable.ts";
import { resolvePath } from "../utils/path.ts";

export type ComponentDBOptions = {
  packageJson: PackageJson;
  viteAliases: Record<string, string>;
  dir: string;
  sqlite: SqliteDB | undefined;
};

export class ComponentDB {
  private edges: DataEdge[];
  private files: FileDB;
  public sqlite: SqliteDB | undefined;

  private resolveTasks: ComponentDBResolve[];
  private unresolvedResolveTasks: ComponentDBResolve[];
  private typesToResolve: Set<string>;

  private isResolve = false;

  private packageJson: PackageJson;
  private viteAliases: Record<string, string>;

  private dir: string;

  private jsxStack: string[] = [];
  private renderInstanceStack: (string | undefined)[] = [];

  constructor(options: ComponentDBOptions) {
    this.edges = [];
    this.files = new FileDB(options.dir, options.packageJson);

    this.resolveTasks = [];
    this.unresolvedResolveTasks = [];
    this.typesToResolve = new Set();

    this.packageJson = options.packageJson;
    this.viteAliases = options.viteAliases;

    this.dir = options.dir;
    this.sqlite = options.sqlite;
  }

  public clearStack() {
    this.jsxStack = [];
    this.renderInstanceStack = [];
  }

  public pushJSX(id: string) {
    this.jsxStack.push(id);
  }

  public popJSX() {
    return this.jsxStack.pop();
  }

  public getCurrentJSX() {
    return this.jsxStack[this.jsxStack.length - 1];
  }

  public pushRenderInstance(id: string | undefined) {
    this.renderInstanceStack.push(id);
  }

  public popRenderInstance() {
    return this.renderInstanceStack.pop();
  }

  public getCurrentRenderInstance() {
    return this.renderInstanceStack[this.renderInstanceStack.length - 1];
  }

  public getResolveTasks() {
    return [...this.resolveTasks];
  }

  public addResolveTasks(tasks: ComponentDBResolve[]) {
    this.resolveTasks.push(...tasks);
  }

  public addFunctionComponent(
    fileName: string,
    component: Omit<
      ComponentFileVarFunctionComponent,
      "id" | "kind" | "states" | "hash" | "file"
    >,
    declarationKind?:
      | "const"
      | "let"
      | "var"
      | "using"
      | "await using"
      | undefined,
  ) {
    const file = this.files.get(fileName)!;
    const nameKey = getVariableNameKey(component.name);
    const id = getDeterministicId(file.path, nameKey);

    const v = new FunctionComponentVariable(
      {
        id,
        ...component,
        states: [],
        declarationKind,
      },
      file,
    );

    this.files.addVariable(fileName, v);

    if (component.propType) {
      this.resolveTasks.push({
        type: "comPropsTsType",
        fileName,
        id,
      });
    }

    return id;
  }

  public addClassComponent(
    fileName: string,
    component: Omit<
      ComponentFileVarClassComponent,
      "id" | "kind" | "states" | "hash" | "file"
    >,
    declarationKind?:
      | "const"
      | "let"
      | "var"
      | "using"
      | "await using"
      | undefined,
  ) {
    const file = this.files.get(fileName)!;
    const nameKey = getVariableNameKey(component.name);
    const id = getDeterministicId(file.path, nameKey);

    assert(
      component.name.type === "identifier",
      "Class name should be an identifier",
    );

    const existingId = file.getVariableID(component.name.name);
    if (existingId) {
      const existing = file.var.get(existingId);
      if (existing && isClassComponentVariable(existing)) {
        return existing.id;
      }
    }

    const v = new ClassComponentVariable(
      {
        id,
        ...component,
        states: [],
        declarationKind,
      },
      file,
    );

    return file.addVariable(v);

    if (component.propType) {
      this.resolveTasks.push({
        type: "comPropsTsType",
        fileName,
        id,
      });
    }

    if (component.stateType) {
      this.resolveTasks.push({
        type: "comClassStateTsType",
        fileName,
        id,
      });
    }

    return id;
  }

  // TODO: add stateType
  public addStateVariable(
    fileName: string,
    componentId: string,
    stateName: string,
    loc: VariableLoc,
    stateType?: TypeData,
  ) {
    const file = this.files.get(fileName);
    file.addStateVariable(componentId, stateName, loc, stateType);
  }

  public addRefVariable(
    fileName: string,
    componentId: string,
    refName: string,
    loc: VariableLoc,
    defaultData: PropDataType,
  ) {
    const file = this.files.get(fileName);
    file.addRefVariable(componentId, refName, loc, defaultData);
  }

  public addJSXVariable(
    fileName: string,
    jsx: Omit<
      ComponentFileVarJSX,
      "id" | "kind" | "type" | "hash" | "file" | "render" | "children"
    >,
    declarationKind?:
      | "const"
      | "let"
      | "var"
      | "using"
      | "await using"
      | undefined,
  ) {
    const file = this.files.get(fileName);

    const nameKey = getVariableNameKey(jsx.name);

    const id = this.files.addVariable(
      fileName,
      new JSXVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...jsx,
          render: null,
          declarationKind,
        },
        file,
      ),
    );

    const currentJSX = this.getCurrentJSX();
    if (currentJSX) {
      this.addVariableDependency(fileName, currentJSX, {
        id,
        name: nameKey,
      });
    }

    return id;
  }

  public addHook(
    fileName: string,
    variable: Omit<
      ComponentFileVarHook,
      "id" | "kind" | "var" | "children" | "states" | "hash" | "file"
    >,
    declarationKind?:
      | "const"
      | "let"
      | "var"
      | "using"
      | "await using"
      | undefined,
  ) {
    const file = this.files.get(fileName);

    const nameKey = getVariableNameKey(variable.name);

    return this.files.addVariable(
      fileName,
      new HookVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          states: [],
          declarationKind,
        },
        file,
      ),
    );
  }

  public addVariable(
    fileName: string,
    variable: Omit<
      ComponentFileVar,
      "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
    >,
    kind: VarKind = "normal",
    declarationKind:
      | "const"
      | "let"
      | "var"
      | "using"
      | "await using" = "const",
  ) {
    const file = this.files.get(fileName);

    const nameKey = getVariableNameKey(variable.name);

    let v: Variable | undefined;
    if (kind === "class") {
      v = new ClassVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          declarationKind,
        } as unknown as Omit<
          ComponentFileVarClass,
          "var" | "type" | "kind" | "file" | "hash"
        >,
        file,
      );
    } else if (kind === "method") {
      v = new MethodVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          declarationKind,
        } as unknown as Omit<
          ComponentFileVarMethod,
          "var" | "components" | "type" | "kind" | "file" | "hash"
        >,
        file,
      );
    } else if (kind === "property") {
      v = new PropertyVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          declarationKind,
        } as unknown as Omit<
          ComponentFileVarProperty,
          "kind" | "type" | "file" | "hash"
        >,
        file,
      );
    } else if (variable.type === "function") {
      v = new FunctionVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          declarationKind,
        } as unknown as Omit<
          ComponentFileVarBaseTypeFunction<"normal">,
          "var" | "components" | "file" | "hash"
        >,
        file,
      );
    } else if (variable.type === "class") {
      v = new ClassVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          declarationKind,
        } as unknown as Omit<
          ComponentFileVarClass,
          "var" | "type" | "kind" | "file" | "hash"
        >,
        file,
      );
    } else if (kind === "state") {
      v = new StateVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          declarationKind,
          setter: "setState",
        } as unknown as Omit<
          ComponentFileVarState,
          "kind" | "file" | "type" | "hash"
        >,
        file,
      );
    } else if (variable.type === "data") {
      v = new DataVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...variable,
          kind,
          declarationKind,
          type: "data",
        } as unknown as Omit<
          ComponentFileVarNormal,
          "kind" | "var" | "children" | "file" | "hash"
        > & { kind?: VarKind },
        file,
      );
    }

    assert(v != null, "Variable not found");

    return this.files.addVariable(fileName, v);
  }

  public addVariableDependency(
    fileName: string,
    parent: string,
    dependency: ComponentFileVarDependency,
  ) {
    this.files.addVariableDependency(fileName, parent, dependency);
  }

  public comAddState(
    name: string,
    loc: VariableLoc,
    fileName: string,
    state: Parameters<ReactFunctionVariable["addState"]>[0],
  ) {
    const component = this.files.getReactFunctionFromLoc(fileName, loc);

    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

    return component.addState(state);
  }

  public comAddCallHook(
    loc: VariableLoc,
    fileName: string,
    callHook: Parameters<ReactFunctionVariable["addCallHook"]>[0],
  ) {
    const component = this.files.getReactFunctionFromLoc(fileName, loc);

    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

    const id = component.addCallHook(callHook);

    const hookName = callHook.call.name;
    const comImport = this.files.getImport(fileName, hookName);

    if (comImport?.source !== "react") {
      if (
        comImport &&
        this.isWorkspaceDependencyImport(comImport.source, fileName)
      ) {
        const v = component.var.get(id);
        if (v && isCallHookVariable(v)) {
          v.call.unresolvedWorkspace = true;
        }
        return id;
      }

      const resolvedTarget = this.getResolvedHookTarget(fileName, hookName);

      if (resolvedTarget?.hookId) {
        const v = component.var.get(id);
        if (v && isCallHookVariable(v)) {
          v.call.id = resolvedTarget.hookId;
          if (resolvedTarget.resolvedId) {
            v.call.resolvedId = resolvedTarget.resolvedId;
          }
          if (resolvedTarget.unresolvedWorkspace) {
            v.call.unresolvedWorkspace = true;
          }
        }
      } else {
        if (this.isResolve) return id;

        this.addResolveTask({
          type: "comResolveCallHook",
          fileName,
          loc,
          id,
          hook: hookName,
        });
      }
    }

    return id;
  }

  public comAddProp(loc: VariableLoc, fileName: string, prop: PropData) {
    const component = this.files.getReactFunctionFromLoc(fileName, loc);

    if (component == null || !isReactFunctionVariable(component)) return;

    if (!component.props.some((p) => p.name === prop.name)) {
      component.props.push(prop);
    }
  }

  public comAddRef(
    loc: VariableLoc,
    fileName: string,
    ref: Omit<RefData, "id"> & { name: VariableName },
  ) {
    const component = this.files.getReactFunctionFromLoc(fileName, loc);

    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

    return component.addRef(ref).id;
  }

  public comAddMemo(
    loc: VariableLoc,
    fileName: string,
    memo: Omit<Memo, "id"> & { name: VariableName },
  ) {
    return this.files.addMemo(fileName, loc, memo);
  }

  public comAddCallback(
    loc: VariableLoc,
    fileName: string,
    callback: Omit<Memo, "id"> & { name: VariableName },
  ) {
    return this.files.addCallback(fileName, loc, callback);
  }

  private isWorkspaceDependencyImport(source: string, fileName: string) {
    const rawPackageName =
      typeof this.packageJson.rawData.name === "string"
        ? this.packageJson.rawData.name
        : undefined;
    const currentScope = rawPackageName?.startsWith("@")
      ? rawPackageName.split("/")[0]
      : undefined;
    const sourceScope = source.startsWith("@")
      ? source.split("/")[0]
      : undefined;
    const resolvedFileName = fileName.startsWith("/")
      ? path.join(this.dir, fileName)
      : resolvePath(this.dir, fileName);

    return (
      currentScope != null &&
      sourceScope === currentScope &&
      this.packageJson.isDependency(source, resolvedFileName)
    );
  }

  private getResolvedHookTarget(fileName: string, hookName: string) {
    const exportInfo = this._getExportId(fileName, hookName);
    if (exportInfo) {
      return {
        hookId: exportInfo.id,
        resolvedId: exportInfo.resolvedId,
        unresolvedWorkspace: exportInfo.unresolvedWorkspace ? true : undefined,
      };
    }

    const hookId = this.getVariableID(hookName, fileName);
    if (hookId) {
      return {
        hookId,
        resolvedId: undefined,
        unresolvedWorkspace: undefined,
      };
    }

    const comImport = this.files.getImport(fileName, hookName);
    if (
      comImport &&
      this.isWorkspaceDependencyImport(comImport.source, fileName)
    ) {
      return {
        hookId: comImport.localName,
        resolvedId: comImport.resolvedId,
        unresolvedWorkspace: comImport.unresolvedWorkspace ?? true,
      };
    }

    return null;
  }

  private _getExportId(
    fileName: string,
    name: string,
  ): {
    id: string;
    isDependency: boolean;
    resolvedId?: string | undefined;
    unresolvedWorkspace?: boolean | undefined;
  } | null {
    const comImport = this.files.getImport(fileName, name);
    if (!comImport) return null;

    const isDependency = this.isDependency(comImport.source, fileName);
    if (isDependency) {
      return {
        id: comImport.localName,
        isDependency: true,
        resolvedId: comImport.resolvedId,
        unresolvedWorkspace:
          comImport.unresolvedWorkspace ??
          this.isWorkspaceDependencyImport(comImport.source, fileName),
      };
    }

    if (this.files.has(comImport.source)) {
      const file = this.files.get(comImport.source);
      const id = file.getExport(comImport, this.files);
      if (id) {
        return { id, isDependency: false };
      }
    }

    return null;
  }

  public comAddHook(
    name: string,
    loc: VariableLoc,
    fileName: string,
    hook: string,
    parentId?: string,
  ) {
    const comImport = this.files.getImport(fileName, hook);
    if (comImport?.source === "react") return;

    const exportInfo = this._getExportId(fileName, hook);

    if (exportInfo == null) {
      if (this.isResolve) return;

      this.addResolveTask({
        type: "comAddHook",
        name,
        fileName,
        hook,
        loc,
        parentId,
      });
      return;
    }

    const component = this.files.getReactFunctionFromLoc(fileName, loc);
    if (component == null || !isReactFunctionVariable(component)) return;

    if (exportInfo.isDependency && exportInfo.unresolvedWorkspace) {
      return;
    }

    component.addHook(exportInfo.id);

    // Also add as a render so it's searchable as a usage
    this.comAddRender(
      fileName,
      hook,
      [],
      loc,
      "hook",
      parentId || this.getCurrentRenderInstance(),
    );
  }

  public comAddEffect(
    fileName: string,
    loc: VariableLoc,
    effect: Omit<EffectInfo, "id">,
  ) {
    const file = this.files.get(fileName);

    file.addEffect(loc, effect);
  }

  public comSetReturn(
    fileName: string,
    loc: VariableLoc,
    returnId: FunctionReturn,
  ) {
    const file = this.files.get(fileName);

    file.setReturn(loc, returnId);
  }

  public getVariableID(name: string, fileName: string): string | null {
    const file = this.files.get(fileName);
    if (file == null) {
      return null;
    }

    return file.getVariableID(name);
  }

  public comAddRender(
    fileName: string,
    tag: string,
    dependency: ComponentInfoRenderDependency[],
    loc: VariableLoc,
    kind: ComponentInfoRender["kind"] = "jsx",
    parentId?: string,
  ) {
    let srcId = "";
    let isDependency = false;

    const exportInfo = this._getExportId(fileName, tag);
    if (exportInfo) {
      srcId = exportInfo.id;
      isDependency = exportInfo.isDependency;
    } else if (tag === "Fragment") {
      srcId = "Fragment";
    } else {
      const v = this.files.getHookInfoFromLoc(fileName, loc);
      if (v && isBaseFunctionVariable(v)) {
        const resolvedId = v.var.getIdByName(tag);
        if (resolvedId) {
          srcId = resolvedId;
        }
      }

      if (!srcId) {
        srcId = this.getVariableID(tag, fileName) ?? "";
      }
    }

    const instanceId = getDeterministicId(`${tag}-${loc.line}-${loc.column}`);

    if (!srcId) {
      if (tag && tag[0] === tag[0]?.toLowerCase()) {
        srcId = tag;
      } else {
        if (!this.isResolve) {
          this.addResolveTask({
            type: "comAddRender",
            fileName: fileName,
            tag,
            dependency,
            loc,
            parentId,
          });
          return instanceId;
        }
      }
    }

    const renderID = this.files.addRender(
      fileName,
      srcId,
      instanceId,
      tag,
      dependency,
      isDependency,
      loc,
      kind,
      parentId,
    );

    if (!renderID) {
      if (!this.isResolve) {
        this.addResolveTask({
          type: "comAddRender",
          fileName: fileName,
          tag,
          dependency,
          loc,
          parentId,
        });
      }
    }

    return instanceId;
  }

  public addFile(file: string, cache?: ComponentFile) {
    return this.files.add(file, cache);
  }

  public getFile(fileName: string) {
    return this.files.get(fileName);
  }

  public fileAddImport(fileName: string, fileImport: ComponentFileImport) {
    this.files.addImport(fileName, fileImport);
  }

  public fileAddExport(
    fileName: string,
    fileExport: Omit<ComponentFileExport, "id">,
  ) {
    this.files.addExport(fileName, fileExport);
  }

  public fileAddStarExport(fileName: string, source: string) {
    this.files.addStarExport(fileName, source);
  }

  public fileAddTsTypes(
    fileName: string,
    type:
      | Omit<TypeDataDeclareInterface, "id">
      | Omit<TypeDataDeclareType, "id">,
  ) {
    const typeDeclare = this.files.addTsTypes(fileName, type);

    const file = this.files.get(fileName);
    if (!this.files.resolveTsTypeID(typeDeclare, file)) {
      this.addResolveTask({
        type: "tsType",
        fileName,
        id: typeDeclare.id,
      });
    }
  }

  private _getValues<T>(collection: Map<string, T> | Record<string, T>) {
    if (collection instanceof Map) {
      return collection.values();
    }
    if (collection && typeof collection === "object") {
      return Object.values(collection || {});
    }
    return [];
  }

  private _resolveDependency(
    variable: Variable,
    parent?: string,
    visited: Set<string> = new Set(),
  ) {
    if (visited.has(variable.id)) return;
    visited.add(variable.id);

    const resolveRenders = (
      children: Record<string, ComponentInfoRender>,
      pId?: string,
    ) => {
      if (!children) return;
      for (const render of Object.values(children || {})) {
        if (!render) continue;
        const isTag =
          (render.id && render.id[0] === render.id[0]?.toLowerCase()) ||
          render.id === "Fragment";
        if (
          render.id &&
          render.id !== "" &&
          !render.isDependency &&
          pId != null &&
          !isTag
        ) {
          this.edges.push({
            from: render.id,
            to: pId,
            label: "render",
          });
        }
        resolveRenders(render.children, pId);
      }
    };

    //TODO: test and replace
    const resolveRenders2 = (
      render: ComponentInfoRender | null,
      pId?: string,
    ) => {
      if (!render) return;
      const isTag =
        (render.id && render.id[0] === render.id[0]?.toLowerCase()) ||
        render.id === "Fragment";
      if (
        render.id &&
        render.id !== "" &&
        !render.isDependency &&
        pId != null &&
        !isTag
      ) {
        this.edges.push({
          from: render.id,
          to: pId,
          label: "render",
        });
      }

      if (render.children) {
        for (const child of Object.values(render.children)) {
          resolveRenders2(child, pId);
        }
      }
    };

    if (isComponentVariable(variable)) {
      if (variable.return) {
        let returnData = variable.return;
        if (typeof returnData === "string") {
          const v = this.files
            .get(variable.file.path)
            .var.get(returnData, true);
          if (v && isJSXVariable(v)) {
            returnData = v.getData();
          }
        }

        if (typeof returnData !== "string" && returnData.type === "jsx") {
          const returnVar = returnData;
          const isTag =
            (returnVar.srcId &&
              returnVar.srcId[0] === returnVar.srcId[0]?.toLowerCase()) ||
            returnVar.srcId === "Fragment";
          if (returnVar.srcId && returnVar.srcId !== "" && !isTag) {
            this.edges.push({
              from: returnVar.srcId,
              to: variable.id,
              label: "render",
            });
          }
          resolveRenders2(returnVar.render, variable.id);
        } else if (
          typeof returnData !== "string" &&
          returnData.type === "ref"
        ) {
          const ref = returnData;
          let refId: string | null = null;
          if (ref.refType === "named") {
            refId = this.getVariableID(ref.name, variable.file.path);
          } else {
            // TODO: handle qualified names
          }

          if (refId) {
            this.edges.push({
              from: refId,
              to: variable.id,
              label: "render",
            });

            const targetVar = this.files
              .get(variable.file.path)
              .var.get(refId, true);
            if (targetVar && isJSXVariable(targetVar)) {
              resolveRenders(targetVar.children, variable.id);
            }
          }
        }
      }
    } else if (isBaseFunctionVariable(variable) && variable.kind === "normal") {
      if (variable.return) {
        let returnData = variable.return;
        if (typeof returnData === "string") {
          const v = this.files
            .get(variable.file.path)
            .var.get(returnData, true);
          if (v && isJSXVariable(v)) {
            returnData = v.getData();
          }
        }

        if (typeof returnData !== "string" && returnData.type === "jsx") {
          const returnVar = returnData;
          if (parent != null && parent !== "") {
            this.edges.push({
              from: parent,
              to: returnVar.id,
              label: "render",
            });
          }
        }
      }
    } else if (isJSXVariable(variable)) {
      if (parent != null && parent !== "") {
        this.edges.push({
          from: parent,
          to: variable.id,
          label: "render",
        });
        resolveRenders(variable.children, parent);
      }
    }

    // Handle nested var iteration (Map or Record)
    if (isBaseFunctionVariable(variable)) {
      if (!variable.var || typeof variable.var.values !== "function") {
        return;
      }

      for (const innerVar of variable.var.values()) {
        this._resolveDependency(
          innerVar,
          variable.kind == "component" ? variable.id : parent,
          visited,
        );
      }
    }
  }

  public resolveDependency() {
    for (const file of this.files.getFiles()) {
      for (const variable of file.getVariables()) {
        this._resolveDependency(variable);
      }
    }
  }

  private getEdges(): DataEdge[] {
    const edges: DataEdge[] = [...this.edges];

    for (const file of this.files.getFiles()) {
      edges.push(...file.getEdges());
    }

    return edges;
  }

  public getData(): JsonData {
    return {
      src: resolvePath(this.dir),
      files: this.files.getData(),
      edges: this.getEdges(),
      resolve: this.resolveTasks,
    };
  }

  public addResolveTask(task: ComponentDBResolve) {
    this.resolveTasks.push(task);
  }

  private static RESOLVE_HANDLERS: {
    [K in ComponentDBResolve["type"]]: (
      db: ComponentDB,
      task: Extract<ComponentDBResolve, { type: K }>,
    ) => void | boolean;
  } = {
    comAddRender: (db, task) => {
      db.comAddRender(
        task.fileName,
        task.tag,
        task.dependency,
        task.loc,
        task.kind,
        task.parentId,
      );
    },
    comAddHook: (db, task) => {
      db.comAddHook(
        task.name,
        task.loc,
        task.fileName,
        task.hook,
        task.parentId,
      );
    },
    comResolveCallHook: (db, task) => {
      const comImport = db.files.getImport(task.fileName, task.hook);
      if (
        comImport &&
        db.isWorkspaceDependencyImport(comImport.source, task.fileName)
      ) {
        return true;
      }

      const component = db.files.getHookInfoFromLoc(task.fileName, task.loc);
      const resolvedTarget = db.getResolvedHookTarget(task.fileName, task.hook);

      if (resolvedTarget?.unresolvedWorkspace && !resolvedTarget.resolvedId) {
        return true;
      }

      if (component && isReactFunctionVariable(component)) {
        if (resolvedTarget?.hookId) {
          const v = component.var.get(task.id);
          if (v && isCallHookVariable(v)) {
            v.call.id = resolvedTarget.hookId;
            if (resolvedTarget.resolvedId) {
              v.call.resolvedId = resolvedTarget.resolvedId;
            }
            if (resolvedTarget.unresolvedWorkspace) {
              v.call.unresolvedWorkspace = true;
            }
          }
          return true;
        }
      }
      return false;
    },
    tsType: (db, task) => {
      const file = db.files.get(task.fileName);
      const typeDeclare = file.getTypeFromName(task.id);
      if (typeDeclare) {
        if (!db.files.resolveTsTypeID(typeDeclare, file)) {
          return false;
        }
      }
      return true;
    },
    comPropsTsType: (db, task) => {
      return db.files.resolveComPropsTsTypeID(task.id, task.fileName);
    },
    comClassStateTsType: (db, task) => {
      return db.files.resolveComClassStateTsTypeID(task.id, task.fileName);
    },
    crossPackageImport: (_db, _task) => {
      return false;
    },
  };

  public resolve() {
    this.isResolve = true;
    this.unresolvedResolveTasks = [];

    const maxRetries = 1000;
    let retries = 0;

    while (this.resolveTasks.length > 0 && retries < maxRetries) {
      const prevSize = this.resolveTasks.length;
      const currentTasks = [...this.resolveTasks];
      this.resolveTasks = [];

      for (const task of currentTasks) {
        // Skip workspace-dependency hook tasks immediately — they are
        // unresolvable within this package and should not re-queue.
        if (task.type === "comResolveCallHook") {
          const comImport = this.files.getImport(task.fileName, task.hook);
          if (
            comImport &&
            this.isWorkspaceDependencyImport(comImport.source, task.fileName)
          ) {
            continue;
          }
        }

        const handler = ComponentDB.RESOLVE_HANDLERS[task.type] as (
          db: ComponentDB,
          task: ComponentDBResolve,
        ) => void | boolean;
        if (handler) {
          const result = handler(this, task);
          if (result === false) {
            this.addResolveTask(task);
          }
        }
      }

      // Stagnation check: if no task was resolved this round, further
      // iterations cannot help — exit early to avoid the 1000-retry spin.
      if (this.resolveTasks.length >= prevSize) {
        break;
      }

      retries++;
    }

    // Any tasks still queued are genuinely unresolvable.
    this.unresolvedResolveTasks = [...this.resolveTasks];

    if (this.unresolvedResolveTasks.length > 0) {
      // Only warn if we actually exhausted retries (a true deep chain),
      // not for the common case where tasks simply cannot be resolved locally.
      if (retries >= maxRetries) {
        console.warn(
          "Resolution interrupted: suspected infinite loop or deep dependency chain in ComponentDB.resolve",
          {
            remainingTasks: this.unresolvedResolveTasks.length,
            taskTypes: [
              ...new Set(this.unresolvedResolveTasks.map((t) => t.type)),
            ],
          },
        );
      }
    }

    this.resolveTasks = [];
    this.isResolve = false;
    return [...this.unresolvedResolveTasks];
  }

  public getUnresolvedResolveTasks() {
    return [...this.unresolvedResolveTasks];
  }

  public isDependency(name: string, fileName?: string): boolean {
    return this.packageJson.isDependency(
      name,
      fileName ? resolvePath(this.dir, fileName) : undefined,
    );
  }

  public getImportFileName(name: string, fileName: string) {
    let source = name;
    if (source.startsWith(".") || source.startsWith("..")) {
      const fileDir = path.dirname(fileName);
      source = path.join(fileDir, source);
      source = path.normalize(source);
    } else if (!this.isDependency(source, fileName)) {
      let isAliase = false;
      for (const alias in this.viteAliases) {
        if (source.startsWith(alias)) {
          source = path.join(
            this.viteAliases[alias] ?? "",
            `./${source.slice(alias.length)}`,
          );
          isAliase = true;
          break;
        } else if (source.startsWith(alias + "/")) {
          source = path.join(
            this.viteAliases[alias] ?? "",
            `./${source.slice(alias.length + 1)}`,
          );
          isAliase = true;
          break;
        }
      }

      if (isAliase) {
        source = path.join(this.dir, source);
        source = source.replace(this.dir, "");
      }
    }

    if (source.startsWith("/")) {
      const fullSource = path.join(this.dir, "." + source);
      if (fs.existsSync(fullSource) && fs.statSync(fullSource).isDirectory()) {
        const indexExtension = ["tsx", "ts", "jsx", "js"];
        for (const ext of indexExtension) {
          const testFile = path.join(fullSource, `index.${ext}`);
          if (fs.existsSync(testFile)) {
            return `${source}/index.${ext}`;
          }
        }
      }

      const indexExtension = ["tsx", "ts", "jsx", "js"];
      for (const ext of indexExtension) {
        const testFile = `${fullSource}.${ext}`;
        if (fs.existsSync(testFile)) {
          return `${source}.${ext}`;
        }
      }
    }

    return source;
  }

  public getVariableFromLoc(fileName: string, loc: VariableLoc) {
    return this.files.getVariableFromLoc(fileName, loc);
  }

  public getVariableIDFromLoc(fileName: string, loc: VariableLoc) {
    const v = this.getVariableFromLoc(fileName, loc);
    return v?.id;
  }

  public getHookInfoFromLoc(fileName: string, loc: VariableLoc) {
    return this.files.getHookInfoFromLoc(fileName, loc);
  }
}
