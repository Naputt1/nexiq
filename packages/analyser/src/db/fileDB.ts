import assert from "assert";
import type {
  ComponentFile,
  ComponentFileExport,
  ComponentFileImport,
  ComponentFileVar,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  ComponentInfoRender,
  DataEdge,
  EffectInfo,
  JsonData,
  Memo,
  TypeData,
  TypeDataArray,
  TypeDataDeclare,
  TypeDataFunction,
  TypeDataImport,
  TypeDataIndexAccess,
  TypeDataLiteralType,
  TypeDataLiteralTypeLiteral,
  TypeDataQuery,
  TypeDataRef,
  TypeDataTuple,
  TypeDataTypeBodyIntersection,
  TypeDataTypeBodyLiteral,
  TypeDataTypeBodyParathesis,
  TypeDataTypeBodyUnion,
  VariableLoc,
  VariableName,
  ComponentFileVarHook,
  FunctionReturn,
  VarKind,
  TypeDataDeclareInterface,
  TypeDataDeclareType,
  ReactFunctionVar,
  ComponentFileVarClass,
  ComponentFileVarMethod,
  ComponentFileVarProperty,
} from "@nexiq/shared";
import type { Variable } from "./variable/variable.js";
import { ComponentVariable } from "./variable/component.js";
import { JSXVariable } from "./variable/jsx.js";
import {
  isHookVariable,
  isComponentVariable,
  isNormalVariable,
  isBaseFunctionVariable,
  isCallHookVariable,
  isJSXVariable,
  isReactFunctionVariable,
} from "./variable/type.js";
import { HookVariable } from "./variable/hook.js";
import { ClassVariable } from "./variable/classVariable.js";
import { MethodVariable } from "./variable/methodVariable.js";
import { PropertyVariable } from "./variable/propertyVariable.js";
import fs from "fs";
import path from "path";
import { getDeterministicId } from "../utils/hash.js";
import { DataVariable } from "./variable/dataVariable.js";
import { FunctionVariable } from "./variable/functionVariable.js";
import type { ReactFunctionVariable } from "./variable/reactFunctionVariable.js";
import { StateVariable } from "./variable/stateVariable.js";
import { RefVariable } from "./variable/refVariable.js";
import { MemoVariable } from "./variable/memo.js";
import { CallbackVariable } from "./variable/callbackVariable.js";
import { getVariableNameKey } from "../analyzer/pattern.js";
import type { PackageJson } from "./packageJson.js";

import { Scope } from "./variable/scope.js";
import { CallHookVariable } from "./variable/callHookVariable.js";
import { BaseFunctionVariable } from "./variable/baseFunctionVariable.js";

type TypeDataHandlerMap = {
  ref: TypeDataRef;
  import: TypeDataImport;
  query: TypeDataQuery;
  union: TypeDataTypeBodyUnion;
  intersection: TypeDataTypeBodyIntersection;
  array: TypeDataArray;
  parenthesis: TypeDataTypeBodyParathesis;
  "type-literal": TypeDataTypeBodyLiteral;
  "literal-type": TypeDataLiteralType;
  function: TypeDataFunction;
  tuple: TypeDataTuple;
  "index-access": TypeDataIndexAccess;
};

type TypeDataHandler<T> = (
  db: FileDB,
  td: T,
  file: File,
  params: Set<string>,
) => boolean;

const FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export class File {
  path: string;
  fingerPrint: string;
  hash: string;
  import: Map<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  starExports: string[];
  defaultExport: string | null;
  tsTypes: Map<string, TypeDataDeclare>;
  var: Scope;

  private init: boolean = true;

  // key = loc.line + @ + loc.column val = variable
  private locIdsMap = new Map<string, Variable>();

  // key = instanceId val = ComponentInfoRender
  private renderInstanceMap = new Map<string, ComponentInfoRender>();

  // key = name val = typeData
  private tsTypesID = new Map<string, TypeDataDeclare>();

  constructor() {
    this.path = "";
    this.fingerPrint = "";
    this.hash = "";
    this.import = new Map();
    this.export = {};
    this.starExports = [];
    this.defaultExport = null;
    this.tsTypes = new Map();
    this.var = new Scope();
  }

  private loadRender(render: ComponentInfoRender) {
    this.renderInstanceMap.set(render.instanceId, render);
    for (const child of Object.values(render.children || {})) {
      this.loadRender(child);
    }
  }

  private loadVariable(variable: ComponentFileVar, scope: Scope = this.var) {
    let v: Variable | undefined;
    if (variable.type === "jsx") {
      v = new JSXVariable(variable, this);
      for (const render of Object.values(variable.children || {})) {
        this.loadRender(render);
      }
    } else if (variable.kind === "normal") {
      if (variable.type === "function") {
        v = new FunctionVariable(variable, this);
      } else {
        v = new DataVariable(variable, this);
        for (const render of Object.values(variable.children || {})) {
          this.loadRender(render);
        }
      }
    } else if (variable.kind === "component") {
      v = new ComponentVariable(variable, this);
    } else if (variable.kind === "hook") {
      if (variable.type === "function") {
        v = new HookVariable(variable, this);
      } else {
        v = new CallHookVariable(variable, this);
      }
    } else if (variable.kind === "state") {
      v = new StateVariable(variable, this);
    } else if (variable.kind === "memo") {
      v = new MemoVariable(variable, this);
    } else if (variable.kind === "class") {
      v = new ClassVariable(variable as ComponentFileVarClass, this);
    } else if (variable.kind === "method") {
      v = new MethodVariable(variable as ComponentFileVarMethod, this);
    } else if (variable.kind === "property") {
      v = new PropertyVariable(variable as ComponentFileVarProperty, this);
    } else if (variable.kind === "callback") {
      v = new CallbackVariable(variable, this);
    } else if (variable.kind === "ref") {
      v = new RefVariable(variable, this);
    }

    assert(v != null, `Variable not found: ${variable.kind}`);

    scope.add(v);

    this.locIdsMap.set(this.getLocalId(v), v);

    if (variable.type === "function" && isBaseFunctionVariable(v)) {
      v.var.initPrevIds(variable.var || {});
      for (const childVar of Object.values(variable.var || {})) {
        this.loadVariable(childVar, v.var);
      }

      if (isHookVariable(v) || isComponentVariable(v)) {
        v.syncSets();
      }
    }

    return v;
  }

  private rawData: ComponentFile | null = null;
  public load(data: ComponentFile, changed: boolean) {
    this.init = changed;
    this.path = data.path;
    this.fingerPrint = data.fingerPrint;
    this.hash = data.hash;
    this.rawData = data;
    this.starExports = data.starExports || [];

    if (data.var) {
      this.var.initPrevIds(data.var);
    }

    for (const variable of Object.values(data.var || {})) {
      this.loadVariable(variable);
    }

    for (const importData of Object.values(data.import || {})) {
      this.import.set(importData.localName, {
        localName: importData.localName,
        importedName: importData.importedName,
        source: importData.source,
        type: importData.type,
        importKind: importData.importKind,
        resolvedId: importData.resolvedId,
        unresolvedWorkspace: importData.unresolvedWorkspace,
      });
    }

    for (const exportData of Object.values(data.export || {})) {
      this.export[exportData.name] = {
        id: exportData.id,
        name: exportData.name,
        type: exportData.type,
        exportKind: exportData.exportKind,
      };

      if (exportData.type === "default") {
        this.defaultExport = exportData.name;
      }
    }

    for (const typeData of Object.values(data.tsTypes || {})) {
      this.tsTypes.set(typeData.id, typeData);
      this.tsTypesID.set(getVariableNameKey(typeData.name), typeData);
    }
  }

  public addImport(fileImport: ComponentFileImport) {
    // if (this.import.get(fileImport.localName) != null) {
    //   if (!this.init) {
    //     return;
    //   }

    //   assert(false, "Import already exists");
    // }

    this.import.set(fileImport.localName, {
      localName: fileImport.localName,
      importedName: fileImport.importedName,
      source: fileImport.source,
      type: fileImport.type,
      importKind: fileImport.importKind,
      resolvedId: fileImport.resolvedId,
      unresolvedWorkspace: fileImport.unresolvedWorkspace,
    });
  }

  public addExport(exportData: Omit<ComponentFileExport, "id">) {
    let id = this.getVariableID(exportData.name);
    if (!id) {
      // Fallback to deterministic ID based on file and name
      id = getDeterministicId(this.path, exportData.name);
    }

    this.export[exportData.name] = { ...exportData, id };
    if (exportData.type === "default") {
      this.defaultExport = exportData.name;
    }

    return id;
  }

  public getExport(
    varImport: ComponentFileImport,
    db: FileDB,
    visited: Set<string> = new Set(),
  ): string | undefined {
    if (visited.has(this.path)) return undefined;
    visited.add(this.path);

    if (varImport.type === "default") {
      if (this.defaultExport != null) {
        return this.export[this.defaultExport]?.id;
      }
    }

    for (const ex of Object.values(this.export || {})) {
      if (ex.name === varImport.importedName) {
        return ex.id;
      }
    }

    // Recursively check star exports
    for (const source of this.starExports || []) {
      if (db.has(source)) {
        const file = db.get(source);
        const id = file.getExport(varImport, db, visited);
        if (id) return id;
      }
    }

    return undefined;
  }

  public getNewVarID(name: VariableName, scope: Scope): string {
    const nameKey = getVariableNameKey(name);
    for (const ex of Object.values(this.export || {})) {
      if (ex.name === nameKey) {
        return ex.id;
      }
    }

    const prevId = scope.getPrevId(nameKey);
    if (prevId) {
      return prevId;
    }

    // Fallback to deterministic ID based on file and name if no cache
    return getDeterministicId(this.path, nameKey);
  }

  public getLocalId(variable: Variable): string {
    return `${variable.loc.line}@${variable.loc.column}`;
  }

  public addVariable(variable: Variable): string {
    const existing = this.getVariable(variable.loc);
    if (existing && existing.kind === variable.kind) {
      existing.load(variable);
      return existing.id;
    }

    const scope = this.var.findDeepestScope(variable.loc);
    const id = this.getNewVarID(variable.name, scope);
    variable.id = id;

    const oldVar = scope.get(id);
    if (oldVar && oldVar.kind === variable.kind) {
      oldVar.load(variable);
      variable = oldVar;
    }

    this.locIdsMap.set(this.getLocalId(variable), variable);

    if (isJSXVariable(variable)) {
      this.getDependenciesIds(variable.id, variable.props);
    }

    scope.add(variable);

    return variable.id;
  }

  public addMemo(
    loc: VariableLoc,
    memo: Omit<Memo, "id"> & { name: VariableName },
  ) {
    const component = this.getHookInfoFromLoc(loc);
    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

    const variable = component.addMemo(memo);
    this.locIdsMap.set(this.getLocalId(variable), variable);

    return variable.id;
  }

  public addCallback(
    loc: VariableLoc,
    callback: Omit<Memo, "id"> & { name: VariableName },
  ) {
    const component = this.getHookInfoFromLoc(loc);
    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

    const variable = component.addCallback(callback);
    this.locIdsMap.set(this.getLocalId(variable), variable);

    return variable.id;
  }

  private __getEdgesRaw(
    variable: ComponentFileVarComponent | ComponentFileVarHook,
  ): DataEdge[] {
    const edges: DataEdge[] = [];

    const resolveRenders = (
      children: Record<string, ComponentInfoRender>,
      toId: string,
    ) => {
      for (const render of Object.values(children || {})) {
        if (!render) continue;
        edges.push({
          from: render.id,
          to: toId,
          label: "render",
        });
        if (render.children) {
          resolveRenders(render.children, toId);
        }
      }
    };

    if (variable.var) {
      for (const v of Object.values(variable.var || {})) {
        if (
          v.type === "function" &&
          (v.kind === "component" || v.kind === "hook")
        ) {
          edges.push(...this.__getEdgesRaw(v));
        } else {
          if (v.type === "jsx") {
            const jsx = v;
            if (variable.kind === "component") {
              edges.push({
                from: jsx.srcId ?? jsx.tag,
                to: variable.id,
                label: "render",
              });
              if (jsx.children) {
                resolveRenders(jsx.children, variable.id);
              }
            }
          }

          if (v.kind === "hook" && v.type === "data") {
            const hookCall = v;
            if (
              hookCall.call.id &&
              !hookCall.call.unresolvedWorkspace &&
              !hookCall.call.resolvedId
            ) {
              edges.push({
                from: hookCall.id,
                to: hookCall.call.id,
                label: "hook",
              });
            }
          }
          if (v.dependencies) {
            for (const dep of Object.values(v.dependencies || {})) {
              edges.push({
                from: v.id,
                to: dep.id,
                label: "hook",
              });
            }
          }
        }
      }
    }

    return edges;
  }

  private __getEdges(
    variable: ReactFunctionVariable<ReactFunctionVar, "function" | "class">,
  ): DataEdge[] {
    const edges: DataEdge[] = [];

    const resolveRenders = (
      children: Record<string, ComponentInfoRender>,
      toId: string,
    ) => {
      for (const render of Object.values(children || {})) {
        if (!render) continue;
        edges.push({
          from: render.id,
          to: toId,
          label: "render",
        });
        if (render.children) {
          resolveRenders(render.children, toId);
        }
      }
    };

    for (const hookId of variable.hooks || []) {
      edges.push({
        from: variable.id,
        to: hookId,
        label: "hook",
      });
    }

    for (const v of variable.var.values()) {
      if (isComponentVariable(v) || isHookVariable(v)) {
        edges.push(...this.__getEdges(v));
      } else {
        if (isJSXVariable(v)) {
          const jsx = v;
          if (isComponentVariable(variable)) {
            edges.push({
              from: jsx.srcId ?? jsx.tag,
              to: variable.id,
              label: "render",
            });
            if (jsx.children) {
              resolveRenders(jsx.children, variable.id);
            }
          }
        }

        if (v && isCallHookVariable(v)) {
          if (!v.call.unresolvedWorkspace && !v.call.resolvedId) {
            edges.push({
              from: v.id,
              to: v.call.id,
              label: "hook",
            });
          }
        }
        for (const dep of Object.values(v.dependencies || {})) {
          edges.push({
            from: v.id,
            to: dep.id,
            label: "hook",
          });
        }
      }
    }

    return edges;
  }

  public getEdges(): DataEdge[] {
    const edges: DataEdge[] = [];
    if (!this.init && this.rawData) {
      for (const variable of Object.values(this.rawData.var || {})) {
        if (
          variable.type === "function" &&
          (variable.kind === "component" || variable.kind === "hook")
        ) {
          edges.push(...this.__getEdgesRaw(variable));
        }
      }
    } else {
      for (const variable of this.var.values()) {
        if (isComponentVariable(variable) || isHookVariable(variable)) {
          edges.push(...this.__getEdges(variable));
        }
      }
    }

    return edges;
  }

  public getVariables() {
    // if (!this.init && this.rawData) {
    //   return Object.values(this.rawData.var);
    // }
    return this.var.values();
  }

  public getVariable(loc: VariableLoc): Variable | undefined {
    return this.locIdsMap.get(`${loc.line}@${loc.column}`);
  }

  public getHookInfoFromLoc(
    loc: VariableLoc,
  ): BaseFunctionVariable<VarKind> | undefined {
    const exact = this.getVariable(loc);
    if (exact && isBaseFunctionVariable(exact)) {
      return exact;
    }

    return this.var.findDeepestVariable(loc);
  }

  public getData(): ComponentFile {
    if (!this.init && this.rawData) return this.rawData;

    return {
      path: this.path,
      fingerPrint: this.fingerPrint,
      hash: this.hash,
      import: Object.fromEntries(this.import),
      export: this.export,
      starExports: this.starExports,
      defaultExport: this.defaultExport,
      tsTypes: Object.fromEntries(this.tsTypes),
      var: this.var.getData(),
    };
  }

  public addVariableDependency(
    parent: string,
    dependency: ComponentFileVarDependency,
  ) {
    let v = this.var.getByName(parent);
    if (!v) {
      v = this.var.get(parent, true);
    }

    if (v == null) return;
    if (v.kind === "component") return;
    assert(v != null, "Parent variable not found");

    v.dependencies[dependency.id] = dependency;
  }

  private _getDependenciesIds(
    dependencies: ComponentInfoRenderDependency[],
    depMap: Record<string, number[]>,
    parent: Variable | undefined,
  ) {
    if (parent == null) return;

    if (isBaseFunctionVariable(parent)) {
      for (const name of Object.keys(depMap)) {
        const id = parent.var.getIdByName(name);
        if (id) {
          const depIndices = depMap[name];
          if (depIndices) {
            for (const depI of depIndices) {
              const dep = dependencies[depI];
              if (dep) {
                dep.valueId = id;
              }
            }
          }
          delete depMap[name];
        }
      }

      if (Object.keys(depMap).length === 0) {
        return;
      }
    }

    if (Object.keys(depMap).length > 0) {
      if (parent.parent == null) {
        for (const name of Object.keys(depMap)) {
          const id = this.var.getIdByName(name);
          if (id) {
            const depIndices = depMap[name];
            if (depIndices) {
              for (const depI of depIndices) {
                const dep = dependencies[depI];
                if (dep) {
                  dep.valueId = id;
                }
              }
            }
            delete depMap[name];
          }
        }
        return;
      }
      this._getDependenciesIds(dependencies, depMap, parent.parent);
    }
  }

  private getDependenciesIds(
    id: string,
    dependencies: ComponentInfoRenderDependency[],
  ) {
    if (!dependencies) return;
    const depMap: Record<string, number[]> = {};
    for (const [i, dep] of dependencies.entries()) {
      let valueName: string | null = null;
      if (typeof dep.value === "string") {
        valueName = dep.value;
      } else if (dep.value && dep.value.type === "ref") {
        if (dep.value.refType === "named") {
          valueName = dep.value.name;
        } else if (dep.value.names.length > 0) {
          valueName = dep.value.names[0]!;
        }
      }

      if (valueName) {
        if (!depMap[valueName]) {
          depMap[valueName] = [];
        }
        depMap[valueName]!.push(i);
      }
    }

    const parent = this.var.get(id, true);

    if (parent == null) {
      this._getDependenciesIds(dependencies, depMap, this.var.get(id));
    } else {
      this._getDependenciesIds(dependencies, depMap, parent);
    }
  }

  public getVariableID(name: string): string | null {
    const v = this.var.getByName(name);
    if (v) return v.id;

    const t = this.tsTypesID.get(name);
    if (t) return t.id;

    return null;
  }

  public getTypeFromName(name: string) {
    return this.tsTypesID.get(name);
  }

  public getTypeByID(id: string) {
    return this.tsTypes.get(id);
  }

  public addTsTypes(loc: VariableLoc, type: TypeDataDeclare) {
    const nameKey = getVariableNameKey(type.name);

    this.tsTypes.set(type.id, type);
    this.tsTypesID.set(nameKey, type);
  }

  public addRender(
    srcId: string,
    instanceId: string,
    tag: string,
    dependencies: ComponentInfoRenderDependency[],
    isDependency: boolean,
    loc: VariableLoc,
    kind: ComponentInfoRender["kind"],
    parentId?: string,
  ) {
    const variable = this.getHookInfoFromLoc(loc);
    if (variable == null) return;
    this.getDependenciesIds(variable.id, dependencies);

    if (loc) {
      const jsxVar = this.getVariable(loc);
      if (jsxVar && isJSXVariable(jsxVar)) {
        jsxVar.srcId = srcId;
      }
    }

    let targetMap: Record<string, ComponentInfoRender> | undefined;
    let renderIndex = 0;

    if (parentId) {
      const parent = this.renderInstanceMap.get(parentId);
      if (parent) {
        targetMap = parent.children;
        renderIndex = Object.keys(parent.children).length;
      }
    }

    if (!targetMap) {
      if (
        isJSXVariable(variable) ||
        isNormalVariable(variable) ||
        isBaseFunctionVariable(variable)
      ) {
        targetMap = variable.children;
        renderIndex = Object.keys(variable.children || {}).length;
      }
    }

    const newRender: ComponentInfoRender = {
      id: srcId,
      instanceId,
      tag,
      dependencies,
      isDependency,
      loc,
      parentId,
      renderIndex,
      kind,
      children: {},
    };

    this.renderInstanceMap.set(instanceId, newRender);

    if (targetMap) {
      targetMap[instanceId] = newRender;

      if (parentId) {
        const parent = this.renderInstanceMap.get(parentId);
        if (parent && parent.loc) {
          const parentVar = this.getVariable(parent.loc);
          if (
            parentVar &&
            (isJSXVariable(parentVar) ||
              isNormalVariable(parentVar) ||
              isBaseFunctionVariable(parentVar))
          ) {
            parentVar.children[instanceId] = newRender;
          }
        }
      }
    }

    return variable.id;
  }

  public addEffect(loc: VariableLoc, effect: Omit<EffectInfo, "id">) {
    const variable = this.getHookInfoFromLoc(loc);

    if (variable == null) return;

    if (isHookVariable(variable) || isComponentVariable(variable)) {
      variable.addEffect(effect);
    }
  }

  public setReturn(loc: VariableLoc, returnId: FunctionReturn) {
    const variable = this.getHookInfoFromLoc(loc);

    if (variable && isBaseFunctionVariable(variable)) {
      variable.return = returnId;
    }
  }
}

export class FileDB {
  src_dir: string;

  private files: Map<string, File>;
  private readonly packageJson: PackageJson;

  constructor(src_dir: string, packageJson: PackageJson) {
    this.files = new Map();
    this.src_dir = src_dir;
    this.packageJson = packageJson;
  }

  public getFiles() {
    return this.files.values();
  }

  private isFileChanged(filename: string, file: File, cache?: ComponentFile) {
    try {
      // console.log(this.src_dir, filename, path.resolve(this.src_dir, filename));
      const stat = fs.statSync(path.resolve(this.src_dir, filename));
      file.fingerPrint = `${stat.size}:${stat.mtimeMs}`;

      if (cache) {
        if (cache.fingerPrint == file.fingerPrint) {
          file.hash = cache.hash;
          return false;
        }
      }

      file.hash = getDeterministicId(
        fs.readFileSync(path.resolve(this.src_dir, filename)),
      );

      if (cache) {
        const res = file.hash !== cache.hash;
        console.log(
          "isFileChanged (cache exists):",
          filename,
          "changed =",
          res,
        );
        return res;
      }

      console.log("isFileChanged (no cache):", filename, "returning true");
      return true;
    } catch (e) {
      console.error(e);
      assert(false, "file read failed");
    }
  }

  public add(filename: string, cache?: ComponentFile) {
    const file = new File();
    file.path = "/" + filename;

    const changed = this.isFileChanged(filename, file, cache);
    if (!changed) {
      assert(cache != null, "Cache must be defined");

      file.load(cache, changed);
      this.files.set("/" + filename, file);
      return false; // Unchanged
    }

    if (cache) {
      file.load(cache, changed);
    }

    this.files.set("/" + filename, file);
    return true; // Changed
  }

  public addImport(fileName: string, fileImport: ComponentFileImport) {
    const file = this.files.get(fileName);
    assert(file != null, "File not found");

    file.addImport(fileImport);
  }

  public has(fileName: string) {
    return this.files.has(fileName);
  }

  public get(fileName: string) {
    const file = this.files.get(fileName);
    assert(file != null, `File not found: ${fileName}`);
    return file;
  }

  public getImport(fileName: string, localName: string) {
    const file = this.get(fileName);
    return file.import.get(localName);
  }

  public getComId(fileName: string, localName: string) {
    const file = this.get(fileName);

    if (Object.hasOwn(file.export, localName)) {
      return (
        file.export[localName]?.id ??
        this.getVariableID(fileName, localName) ??
        getDeterministicId(fileName, localName)
      );
    }

    return (
      this.getVariableID(fileName, localName) ??
      getDeterministicId(fileName, localName)
    );
  }

  public getVariableID(fileName: string, name: string): string | null {
    const file = this.files.get(fileName);
    if (file == null) {
      return null;
    }

    return file.getVariableID(name);
  }

  public getData(): JsonData["files"] {
    return Object.fromEntries(
      Array.from(this.files.entries()).map(([k, value]) => [
        k,
        value.getData(),
      ]),
    );
  }

  public addExport(
    fileName: string,
    exportData: Omit<ComponentFileExport, "id">,
  ) {
    const file = this.get(fileName);

    return file.addExport(exportData);
  }

  public addStarExport(fileName: string, source: string) {
    const file = this.get(fileName);
    if (!file.starExports.includes(source)) {
      file.starExports.push(source);
    }
  }

  public getDefaultExport(fileName: string) {
    const file = this.get(fileName);
    return file.defaultExport;
  }

  public addVariable(fileName: string, variable: Variable) {
    // resolve propType
    const file = this.get(fileName);

    return file.addVariable(variable);
  }

  public addMemo(
    fileName: string,
    loc: VariableLoc,
    memo: Omit<Memo, "id"> & { name: VariableName },
  ) {
    const file = this.get(fileName);

    return file.addMemo(loc, {
      ...memo,
    });
  }

  public addCallback(
    fileName: string,
    loc: VariableLoc,
    callback: Omit<Memo, "id"> & { name: VariableName },
  ) {
    const file = this.get(fileName);

    return file.addCallback(loc, {
      ...callback,
    });
  }

  public getComponent(
    fileName: string,
    id: string,
  ): ComponentVariable | undefined {
    const file = this.get(fileName);
    const variable = file.var.get(id);
    if (variable && isComponentVariable(variable)) {
      return variable;
    }
    return undefined;
  }

  public getVariableFromLoc(
    fileName: string,
    loc: VariableLoc,
  ): Variable | undefined {
    const file = this.get(fileName);
    return file.getVariable(loc);
  }

  public getHookInfoFromLoc(
    fileName: string,
    loc: VariableLoc,
  ): ReactFunctionVariable | undefined {
    const file = this.get(fileName);
    const v = file.getHookInfoFromLoc(loc);
    if (v && isReactFunctionVariable(v)) {
      return v;
    }
    return undefined;
  }

  public getComponentFromLoc(
    fileName: string,
    loc: VariableLoc,
  ): ComponentVariable | undefined {
    const file = this.get(fileName);
    const variable = file.getVariable(loc);
    if (variable && isComponentVariable(variable)) {
      return variable;
    }

    return undefined;
  }

  public getHookFromLoc(
    fileName: string,
    loc: VariableLoc,
  ): HookVariable | undefined {
    const file = this.get(fileName);
    const variable = file.getVariable(loc);
    if (variable && isHookVariable(variable)) {
      return variable;
    }

    return undefined;
  }

  public addVariableDependency(
    fileName: string,
    parent: string,
    dependency: ComponentFileVarDependency,
  ) {
    const file = this.get(fileName);

    file.addVariableDependency(parent, dependency);
  }

  private isWorkspaceDependencyImport(source: string, filePath: string) {
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
    const resolvedFileName = filePath.startsWith("/")
      ? path.join(this.src_dir, filePath)
      : path.resolve(this.src_dir, filePath);

    return (
      currentScope != null &&
      sourceScope === currentScope &&
      this.packageJson.isDependency(source, resolvedFileName)
    );
  }

  private getImportSymbolId(filePath: string, localName: string) {
    return `symbol:import:${filePath}:${localName}`;
  }

  private resolveSourceFileFromModule(
    currentFilePath: string,
    source: string,
  ): string | null {
    let normalizedSource = source;
    if (source.startsWith(".") || source.startsWith("/")) {
      const currentDir = path.posix.dirname(currentFilePath);
      normalizedSource = source.startsWith("/")
        ? path.posix.normalize(source)
        : path.posix.normalize(path.posix.join(currentDir, source));
    } else {
      return this.has(source) ? source : null;
    }

    if (this.has(normalizedSource)) {
      return normalizedSource;
    }

    for (const extension of FILE_EXTENSIONS) {
      if (this.has(`${normalizedSource}${extension}`)) {
        return `${normalizedSource}${extension}`;
      }
      if (this.has(path.posix.join(normalizedSource, `index${extension}`))) {
        return path.posix.join(normalizedSource, `index${extension}`);
      }
    }

    return null;
  }

  private getExportIdFromImportSource(
    currentFilePath: string,
    source: string,
    exportName: string,
    importKind: ComponentFileImport["importKind"] = "type",
  ) {
    const resolvedSource = this.resolveSourceFileFromModule(
      currentFilePath,
      source,
    );
    if (!resolvedSource || !this.has(resolvedSource)) {
      return undefined;
    }

    const sourceFile = this.get(resolvedSource);
    return sourceFile.getExport(
      {
        localName: exportName,
        importedName: exportName,
        source: resolvedSource,
        type: "named",
        importKind,
      },
      this,
    );
  }

  private getRefTypeResolution(
    name: string,
    file: File,
  ): {
    id: string;
    resolvedId?: string | undefined;
    unresolvedWorkspace?: boolean | undefined;
  } | null {
    const varId = file.getVariableID(name);
    if (varId) return { id: varId };

    const type = file.getTypeFromName(name);
    if (type) return { id: type.id };

    if (file.getTypeByID(name)) return { id: name };

    if (file.import?.has(name)) {
      const importData = file.import.get(name);
      if (importData) {
        if (this.has(importData.source)) {
          const sourceFile = this.get(importData.source);
          if (sourceFile) {
            const exportId = sourceFile.getExport(importData, this);
            if (exportId) {
              return { id: exportId };
            }
          }
        }

        if (this.isWorkspaceDependencyImport(importData.source, file.path)) {
          return {
            id: this.getImportSymbolId(file.path, importData.localName),
            resolvedId: importData.resolvedId,
            unresolvedWorkspace: importData.unresolvedWorkspace ?? true,
          };
        }
      }
    }

    return null;
  }

  public getRefTypeId(name: string, file: File): string | undefined {
    return this.getRefTypeResolution(name, file)?.id;
  }

  private updateTypeDataLiteral(
    typeData: TypeDataLiteralTypeLiteral,
    file: File,
    params: Set<string>,
  ): boolean {
    if (typeData.type === "template") {
      for (const expr of typeData.expression) {
        return this.updateTypeDataID(expr, file, params);
      }
    } else if (typeData.type === "unary") {
      return this.updateTypeDataLiteral(typeData.argument, file, params);
    }

    return true;
  }

  private getTypeDataRefName(typeData: TypeDataRef): string {
    if (typeData.refType === "named") {
      return typeData.name;
    } else {
      assert(typeData.names?.length > 0);
      return typeData.names[0]!;
    }
  }

  private applyTypeResolution(
    typeData: TypeDataRef | TypeDataImport,
    resolution: {
      id: string;
      resolvedId?: string | undefined;
      unresolvedWorkspace?: boolean | undefined;
    },
    options?: {
      keepQualified?: boolean;
      qualifiedMember?: string;
    },
  ) {
    if ("refType" in typeData) {
      if (options?.keepQualified) {
        if (typeData.refType === "qualified" && typeData.names.length > 0) {
          typeData.names[0] = resolution.id;
          if (options.qualifiedMember) {
            typeData.names[1] = options.qualifiedMember;
          }
        }
      } else if (typeData.refType === "named") {
        typeData.name = resolution.id;
      } else {
        const ref = typeData as unknown as Record<string, unknown>;
        ref.refType = "named";
        ref.name = resolution.id;
        delete ref.names;
      }
    } else {
      typeData.name = resolution.id;
    }

    if (resolution.resolvedId) {
      typeData.resolvedId = resolution.resolvedId;
    }
    if (resolution.unresolvedWorkspace) {
      typeData.unresolvedWorkspace = true;
    } else {
      delete typeData.unresolvedWorkspace;
    }
  }

  private getQualifiedRefTypeResolution(
    typeData: TypeDataRef,
    file: File,
  ): {
    id: string;
    resolvedId?: string | undefined;
    unresolvedWorkspace?: boolean | undefined;
  } | null {
    if (typeData.refType !== "qualified" || typeData.names.length !== 2) {
      return null;
    }

    const [namespaceName, exportName] = typeData.names;
    if (!namespaceName || !exportName) {
      return null;
    }

    const importData = file.import.get(namespaceName);
    if (!importData || importData.type !== "namespace") {
      return null;
    }

    const localExportId = this.getExportIdFromImportSource(
      file.path,
      importData.source,
      exportName,
      importData.importKind,
    );
    if (localExportId) {
      return { id: localExportId };
    }

    if (this.isWorkspaceDependencyImport(importData.source, file.path)) {
      return {
        id: this.getImportSymbolId(file.path, importData.localName),
        resolvedId: importData.resolvedId,
        unresolvedWorkspace: importData.unresolvedWorkspace ?? true,
      };
    }

    return null;
  }

  private getImportTypeResolution(
    typeData: TypeDataImport,
    file: File,
  ): {
    id: string;
    resolvedId?: string | undefined;
    unresolvedWorkspace?: boolean | undefined;
  } | null {
    if (typeData.qualifier) {
      const localExportId = this.getExportIdFromImportSource(
        file.path,
        typeData.name,
        typeData.qualifier,
      );
      if (localExportId) {
        return { id: localExportId };
      }
    }

    if (this.isWorkspaceDependencyImport(typeData.name, file.path)) {
      return {
        id: typeData.name,
        resolvedId: typeData.resolvedId,
        unresolvedWorkspace: typeData.unresolvedWorkspace ?? true,
      };
    }

    return null;
  }

  private _resolveTypeRef(
    typeData: TypeDataRef,
    file: File,
    params: Set<string>,
  ): boolean {
    const name = this.getTypeDataRefName(typeData);
    if (params.has(name)) return true;

    if (typeData.unresolvedWorkspace) {
      if (typeData.params) {
        for (const param of typeData.params) {
          if (!this.updateTypeDataID(param, file, params)) return false;
        }
      }
      return true;
    }

    const resolution =
      (typeData.refType === "qualified"
        ? this.getQualifiedRefTypeResolution(typeData, file)
        : null) || this.getRefTypeResolution(name, file);
    if (resolution != null) {
      const resolutionOptions =
        typeData.refType === "qualified"
          ? typeData.names[1]
            ? {
                keepQualified: !!resolution.unresolvedWorkspace,
                qualifiedMember: typeData.names[1],
              }
            : {
                keepQualified: !!resolution.unresolvedWorkspace,
              }
          : undefined;
      this.applyTypeResolution(typeData, resolution, {
        ...resolutionOptions,
      });
    } else {
      return false;
    }

    if (typeData.params) {
      for (const param of typeData.params) {
        if (!this.updateTypeDataID(param, file, params)) return false;
      }
    }

    return true;
  }

  private static TYPE_DATA_HANDLERS: {
    [K in keyof TypeDataHandlerMap]: TypeDataHandler<TypeDataHandlerMap[K]>;
  } = {
    ref: (db, td: TypeDataRef, file, params) =>
      db._resolveTypeRef(td, file, params),
    import: (db, td: TypeDataImport, file, _params) => {
      if (td.unresolvedWorkspace) {
        return true;
      }

      const resolution = db.getImportTypeResolution(td, file);
      if (!resolution) {
        return false;
      }

      db.applyTypeResolution(td, resolution);
      return true;
    },
    query: (db, td: TypeDataQuery, file, params) => {
      if (td.expr.type === "import") {
        return FileDB.TYPE_DATA_HANDLERS.import(db, td.expr, file, params);
      }
      return true;
    },
    union: (db, td: TypeDataTypeBodyUnion, file, params) =>
      td.members.every((m) => db.updateTypeDataID(m, file, params)),
    intersection: (db, td: TypeDataTypeBodyIntersection, file, params) =>
      td.members.every((m) => db.updateTypeDataID(m, file, params)),
    array: (db, td: TypeDataArray, file, params) =>
      db.updateTypeDataID(td.element, file, params),
    parenthesis: (db, td: TypeDataTypeBodyParathesis, file, params) =>
      db.updateTypeDataID(td.members, file, params),
    "type-literal": (db, td: TypeDataTypeBodyLiteral, file, params) =>
      td.members.every((m) => {
        if (m.signatureType === "method") {
          for (const p of m.parameters) {
            if (p.typeData && !db.updateTypeDataID(p.typeData, file, params)) {
              return false;
            }
          }

          for (const param of m.params) {
            if (
              param.constraint &&
              !db.updateTypeDataID(param.constraint, file, params)
            ) {
              return false;
            }
            if (
              param.default &&
              !db.updateTypeDataID(param.default, file, params)
            ) {
              return false;
            }
          }

          return db.updateTypeDataID(m.return, file, params);
        }

        return db.updateTypeDataID(m.type, file, params);
      }),
    "literal-type": (
      db,
      td: { literal: TypeDataLiteralTypeLiteral },
      file,
      params,
    ) => db.updateTypeDataLiteral(td.literal, file, params),
    function: (db, td: TypeDataFunction, file, params) => {
      for (const p of td.parameters) {
        if (p.typeData && !db.updateTypeDataID(p.typeData, file, params))
          return false;
      }

      for (const param of td.params) {
        if (
          param.constraint &&
          !db.updateTypeDataID(param.constraint, file, params)
        )
          return false;
        if (param.default && !db.updateTypeDataID(param.default, file, params))
          return false;
      }

      return db.updateTypeDataID(td.return, file, params);
    },
    tuple: (db, td: TypeDataTuple, file, params) =>
      td.elements.every((e) => db.updateTypeDataID(e.typeData, file, params)),
    "index-access": (db, td: TypeDataIndexAccess, file, params) =>
      db.updateTypeDataID(td.indexType, file, params) &&
      db.updateTypeDataID(td.objectType, file, params),
  };

  private hasTypeDataHandler(
    kind: string,
  ): kind is keyof typeof FileDB.TYPE_DATA_HANDLERS {
    return kind in FileDB.TYPE_DATA_HANDLERS;
  }

  public updateTypeDataID(
    typeData: TypeData,
    file: File,
    params: Set<string>,
  ): boolean {
    if (typeData.type === "ref") {
      return FileDB.TYPE_DATA_HANDLERS.ref(this, typeData, file, params);
    } else if (typeData.type === "import") {
      return FileDB.TYPE_DATA_HANDLERS.import(this, typeData, file, params);
    } else if (typeData.type === "query") {
      return FileDB.TYPE_DATA_HANDLERS.query(this, typeData, file, params);
    } else if (typeData.type === "union") {
      return FileDB.TYPE_DATA_HANDLERS.union(this, typeData, file, params);
    } else if (typeData.type === "intersection") {
      return FileDB.TYPE_DATA_HANDLERS.intersection(
        this,
        typeData,
        file,
        params,
      );
    } else if (typeData.type === "array") {
      return FileDB.TYPE_DATA_HANDLERS.array(this, typeData, file, params);
    } else if (typeData.type === "parenthesis") {
      return FileDB.TYPE_DATA_HANDLERS.parenthesis(
        this,
        typeData,
        file,
        params,
      );
    } else if (typeData.type === "type-literal") {
      return FileDB.TYPE_DATA_HANDLERS["type-literal"](
        this,
        typeData,
        file,
        params,
      );
    } else if (typeData.type === "literal-type") {
      return FileDB.TYPE_DATA_HANDLERS["literal-type"](
        this,
        typeData,
        file,
        params,
      );
    } else if (typeData.type === "function") {
      return FileDB.TYPE_DATA_HANDLERS.function(this, typeData, file, params);
    } else if (typeData.type === "tuple") {
      return FileDB.TYPE_DATA_HANDLERS.tuple(this, typeData, file, params);
    } else if (typeData.type === "index-access") {
      return FileDB.TYPE_DATA_HANDLERS["index-access"](
        this,
        typeData,
        file,
        params,
      );
    }
    return true;
  }

  public resolveComPropsTsTypeID(id: string, fileName: string): boolean {
    const file = this.get(fileName);

    const com = file.var.get(id);
    if (com == null) return false;

    if (!isComponentVariable(com)) return true;
    if (com.propType == null) return true;

    if (!this.updateTypeDataID(com.propType, file, new Set<string>())) {
      return false;
    }

    return true;
  }

  public resolveTsTypeID(typeDeclare: TypeDataDeclare, file: File): boolean {
    const params = new Set<string>();
    let allResolved = true;

    if (typeDeclare.params) {
      for (const param of Object.values(typeDeclare.params || {})) {
        params.add(param.name);

        if (param.constraint && param.constraint.type === "ref") {
          if (!this._resolveTypeRef(param.constraint, file, params)) {
            allResolved = false;
          }
        }

        if (param.default && param.default.type === "ref") {
          if (!this._resolveTypeRef(param.default, file, params)) {
            allResolved = false;
          }
        }
      }
    }

    if (typeDeclare.type === "interface") {
      if (typeDeclare.extends) {
        for (const [i, ex] of typeDeclare.extends.entries()) {
          const id = this.getRefTypeId(ex, file);
          if (id != null) {
            typeDeclare.extends[i] = id;
          } else {
            allResolved = false;
          }
        }
      }

      for (const body of typeDeclare.body) {
        if (body.signatureType === "method") {
          for (const p of body.parameters) {
            if (
              p.typeData &&
              !this.updateTypeDataID(p.typeData, file, params)
            ) {
              allResolved = false;
            }
          }

          for (const param of body.params) {
            if (
              param.constraint &&
              !this.updateTypeDataID(param.constraint, file, params)
            ) {
              allResolved = false;
            }
            if (
              param.default &&
              !this.updateTypeDataID(param.default, file, params)
            ) {
              allResolved = false;
            }
          }

          if (!this.updateTypeDataID(body.return, file, params)) {
            allResolved = false;
          }
        } else {
          if (!this.updateTypeDataID(body.type, file, params)) {
            allResolved = false;
          }
        }
      }
    } else if (typeDeclare.type === "type") {
      if (!this.updateTypeDataID(typeDeclare.body, file, params)) {
        allResolved = false;
      }
    }

    return allResolved;
  }

  public addTsTypes(
    fileName: string,
    type:
      | Omit<TypeDataDeclareInterface, "id">
      | Omit<TypeDataDeclareType, "id">,
  ) {
    const file = this.get(fileName);

    const id = file.getNewVarID(type.name, file.var);
    const typeDeclare: TypeDataDeclare =
      type.type === "interface" ? { ...type, id } : { ...type, id };

    this.resolveTsTypeID(typeDeclare, file);

    file.addTsTypes(type.loc, typeDeclare);

    return typeDeclare;
  }

  public addRender(
    fileName: string,
    srcId: string,
    instanceId: string,
    tag: string,
    dependencies: ComponentInfoRenderDependency[],
    isDependency: boolean,
    loc: VariableLoc,
    kind: ComponentInfoRender["kind"],
    parentId?: string,
  ) {
    const file = this.get(fileName);

    return file.addRender(
      srcId,
      instanceId,
      tag,
      dependencies,
      isDependency,
      loc,
      kind,
      parentId,
    );
  }
}
