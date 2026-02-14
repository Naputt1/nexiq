import assert from "assert";
import type {
  ComponentFile,
  ComponentFileExport,
  ComponentFileImport,
  ComponentFileVar,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  DataEdge,
  EffectInfo,
  JsonData,
  Memo,
  TypeData,
  TypeDataArray,
  TypeDataDeclare,
  TypeDataFunction,
  TypeDataIndexAccess,
  TypeDataLiteralType,
  TypeDataLiteralTypeLiteral,
  TypeDataRef,
  TypeDataTuple,
  TypeDataTypeBodyIntersection,
  TypeDataTypeBodyLiteral,
  TypeDataTypeBodyParathesis,
  TypeDataTypeBodyUnion,
  VariableLoc,
  VariableScope,
  VariableName,
  ComponentFileVarHook,
} from "shared";
import type { Variable } from "./variable/variable.js";
import { ComponentVariable } from "./variable/component.js";
import {
  isHookVariable,
  isComponentVariable,
  isNormalVariable,
  isBaseFunctionVariable,
  isDataVariable,
} from "./variable/type.js";
import { HookVariable } from "./variable/hook.js";
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

import { Scope } from "./variable/scope.js";
import { CallHookVariable } from "./variable/callHookVariable.js";

type TypeDataHandlerMap = {
  ref: TypeDataRef;
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

export class File {
  path: string;
  fingerPrint: string;
  hash: string;
  import: Map<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
  tsTypes: Map<string, TypeDataDeclare>;
  var: Scope;

  scopes = new Set<Variable<"function">>();

  private init: boolean = true;

  // key = loc.line + @ + loc.column val = variable
  private locIdsMap = new Map<string, Variable>();

  // key = name val = typeData
  private tsTypesID = new Map<string, TypeDataDeclare>();

  constructor() {
    this.path = "";
    this.fingerPrint = "";
    this.hash = "";
    this.import = new Map();
    this.export = {};
    this.defaultExport = null;
    this.tsTypes = new Map();
    this.var = new Scope();
  }

  private loadVariable(variable: ComponentFileVar, scope: Scope = this.var) {
    let v: Variable | undefined;
    if (variable.kind === "normal") {
      if (variable.type === "function") {
        v = new FunctionVariable(variable, this);
      } else {
        v = new DataVariable(variable, this);
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
    } else if (variable.kind == "memo") {
      v = new MemoVariable(variable, this);
    } else if (variable.kind == "callback") {
      v = new CallbackVariable(variable, this);
    } else if (variable.kind == "ref") {
      v = new RefVariable(variable, this);
    } else {
      debugger;
    }

    assert(v != null, `Variable not found: ${variable.kind}`);

    scope.add(v);
    if (isBaseFunctionVariable(v)) {
      this.scopes.add(v);
    }

    this.locIdsMap.set(this.getLocalId(v), v);

    if (variable.type === "function" && isBaseFunctionVariable(v)) {
      v.var.initPrevIds(variable.var);
      for (const childVar of Object.values(variable.var)) {
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

    if (changed) {
      if (data.var) {
        this.var.initPrevIds(data.var);
      }

      for (const variable of Object.values(data.var)) {
        this.loadVariable(variable);
      }

      for (const importData of Object.values(data.import)) {
        this.import.set(importData.localName, {
          localName: importData.localName,
          importedName: importData.importedName,
          source: importData.source,
          type: importData.type,
          importKind: importData.importKind,
        });
      }

      for (const exportData of Object.values(data.export)) {
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

      for (const typeData of Object.values(data.tsTypes)) {
        this.tsTypes.set(typeData.id, typeData);
        this.tsTypesID.set(getVariableNameKey(typeData.name), typeData);
      }
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
    });
  }

  public addExport(exportData: Omit<ComponentFileExport, "id">) {
    let id = this.getVariableID(exportData.name);
    if (!id) {
      // Fallback to deterministic ID based on file and name
      id = getDeterministicId(`${this.path}:${exportData.name}`);
    }

    this.export[exportData.name] = { ...exportData, id };
    if (exportData.type === "default") {
      this.defaultExport = exportData.name;
    }

    return id;
  }

  public getExport(varImport: ComponentFileImport): string | undefined {
    if (varImport.type === "default") {
      if (this.defaultExport != null) {
        return this.export[this.defaultExport]?.id;
      }
    }

    for (const ex of Object.values(this.export)) {
      if (ex.name === varImport.importedName) {
        return ex.id;
      }
    }

    return undefined;
  }

  public getNewVarID(name: VariableName, scope: Scope): string {
    const nameKey = getVariableNameKey(name);
    for (const ex of Object.values(this.export)) {
      if (ex.name === nameKey) {
        return ex.id;
      }
    }

    const prevId = scope.getPrevId(nameKey);
    if (prevId) {
      return prevId;
    }

    // Fallback to deterministic ID based on file and name if no cache
    return getDeterministicId(`${this.path}:${nameKey}`);
  }

  public getLocalId(variable: Variable): string {
    return `${variable.loc.line}@${variable.loc.column}`;
  }

  public addVariable(variable: Variable, parentPath?: string[]): string {
    const scope =
      parentPath && parentPath.length > 0
        ? this.var.getByPath(parentPath)
        : this.var;

    if (scope == null) {
      debugger;
      //TODO: handle parent not found
      return "no parent";
    }

    const id = this.getNewVarID(variable.name, scope);
    variable.id = id;

    const oldVar = scope.get(id);
    if (oldVar && oldVar.kind === variable.kind) {
      oldVar.load(variable);
      variable = oldVar;
    }

    this.locIdsMap.set(this.getLocalId(variable), variable);

    if (isBaseFunctionVariable(variable)) {
      this.scopes.add(variable);
    }

    scope.add(variable);

    return variable.id;
  }

  public addMemo(
    loc: VariableLoc,
    memo: Omit<Memo, "id"> & { name: VariableName },
  ) {
    const component = this.getHookInfoFromLoc(loc);
    assert(component != null, "Component not found");

    const variable = component.addMemo(memo);
    this.scopes.add(variable);
    this.locIdsMap.set(this.getLocalId(variable), variable);

    return variable.id;
  }

  public addCallback(
    loc: VariableLoc,
    callback: Omit<Memo, "id"> & { name: VariableName },
  ) {
    const component = this.getHookInfoFromLoc(loc);
    assert(component != null, "Component not found");

    const variable = component.addCallback(callback);
    this.scopes.add(variable);
    this.locIdsMap.set(this.getLocalId(variable), variable);

    return variable.id;
  }

  private __getEdgesRaw(
    variable: ComponentFileVarComponent | ComponentFileVarHook,
  ): DataEdge[] {
    const edges: DataEdge[] = [];

    if (variable.kind === "component") {
      for (const render of Object.values(variable.renders)) {
        edges.push({
          from: render.id,
          to: variable.id,
          label: "render",
        });
      }
    }

    if (variable.hooks) {
      for (const hookId of variable.hooks) {
        edges.push({
          from: variable.id,
          to: hookId,
          label: "hook",
        });
      }
    }

    if (variable.var) {
      for (const v of Object.values(variable.var)) {
        if (
          v.kind == "component" ||
          (v.kind == "hook" && v.type == "function")
        ) {
          edges.push(...this.__getEdgesRaw(v));
        }
      }
    }

    return edges;
  }

  private __getEdges(variable: ReactFunctionVariable): DataEdge[] {
    const edges: DataEdge[] = [];

    if (isComponentVariable(variable)) {
      for (const render of Object.values(variable.renders)) {
        edges.push({
          from: render.id,
          to: variable.id,
          label: "render",
        });
      }
    }

    for (const hookId of variable.hooks) {
      edges.push({
        from: variable.id,
        to: hookId,
        label: "hook",
      });
    }

    for (const v of variable.var.values()) {
      if (isComponentVariable(v) || isHookVariable(v)) {
        edges.push(...this.__getEdges(v));
      } else if (v.kind === "hook") {
        for (const dep of Object.values(v.dependencies)) {
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
      for (const variable of Object.values(this.rawData.var)) {
        if (variable.kind == "component" || variable.kind == "hook") {
          edges.push(
            ...this.__getEdgesRaw(
              variable as ComponentFileVarComponent | ComponentFileVarHook,
            ),
          );
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
  ): ReactFunctionVariable | undefined {
    const variable = this.getVariable(loc);
    if (
      variable &&
      (isHookVariable(variable) || isComponentVariable(variable))
    ) {
      return variable;
    }

    return undefined;
  }

  public getData(): ComponentFile {
    if (!this.init && this.rawData) return this.rawData;

    return {
      path: this.path,
      fingerPrint: this.fingerPrint,
      hash: this.hash,
      import: Object.fromEntries(this.import),
      export: this.export,
      defaultExport: this.defaultExport,
      tsTypes: Object.fromEntries(
        Object.entries(Object.fromEntries(this.tsTypes)),
      ),
      var: this.var.getData(),
    };
  }

  public addVariableDependency(
    parent: string,
    dependency: ComponentFileVarDependency,
  ) {
    const v = this.var.getByName(parent);

    assert(v != null, "Parent variable not found");
    if (v == null) return;
    if (v.kind == "component") return;

    v.dependencies[dependency.id] = dependency;
  }

  private _getDependenciesIds(
    dependencies: ComponentInfoRenderDependency[],
    depMap: Record<string, number[]>,
    parent: Variable | undefined,
  ) {
    if (parent == null) return;

    if (isBaseFunctionVariable(parent)) {
      for (const com of parent.var.values()) {
        const comNameKey = getVariableNameKey(com.name);
        if (Object.keys(depMap).includes(comNameKey)) {
          const depIndices = depMap[comNameKey];
          if (depIndices) {
            for (const depI of depIndices) {
              const dep = dependencies[depI];
              if (dep) {
                dep.valueId = com.id;
              }
            }
          }

          delete depMap[comNameKey];
          if (Object.keys(depMap).length === 0) {
            return;
          }
        }
      }
    }

    if (Object.keys(depMap).length > 0) {
      if (parent.parent == null) {
        for (const com of this.var.values()) {
          const comNameKey = getVariableNameKey(com.name);
          if (Object.keys(depMap).includes(comNameKey)) {
            const depIndices = depMap[comNameKey];
            if (depIndices) {
              for (const depI of depIndices) {
                const dep = dependencies[depI];
                if (dep) {
                  dep.valueId = com.id;
                }
              }
            }

            delete depMap[comNameKey];
            if (Object.keys(depMap).length === 0) {
              return;
            }
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

  public getScope(scope: VariableScope) {
    for (const s of this.scopes) {
      assert(isBaseFunctionVariable(s), "Scope variable must be a function");

      if (
        s.scope?.start.line == scope.start.line &&
        s.scope?.start.column == scope.start.column &&
        s.scope?.end.line == scope.end.line &&
        s.scope?.end.column == scope.end.column
      ) {
        return s;
      }
    }

    return null;
  }

  public getScopeFromLoc(loc: VariableLoc) {
    for (const s of this.scopes) {
      assert(isBaseFunctionVariable(s), "Scope variable must be a function");

      if (
        s.scope?.start.line == loc.line &&
        s.scope?.start.column == loc.column &&
        s.scope?.end.line == loc.line &&
        s.scope?.end.column == loc.column
      ) {
        return s;
      }
    }

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
    if (!type.id) {
      const id = this.getNewVarID(type.name, this.var); // Root scope
      type.id = id;
    }

    this.tsTypes.set(type.id, type);
    this.tsTypesID.set(nameKey, type);
  }

  public addRender(
    comLoc: string,
    srcId: string,
    dependencies: ComponentInfoRenderDependency[],
    isDependency: boolean,
    loc: VariableLoc,
  ) {
    const variable = this.locIdsMap.get(comLoc);
    if (variable == null) return;
    if (!variable) return;
    this.getDependenciesIds(variable.id, dependencies);

    if (isComponentVariable(variable)) {
      variable.renders[srcId] = {
        id: srcId,
        dependencies,
        isDependency,
        loc,
      };
    } else if (isNormalVariable(variable) && isDataVariable(variable)) {
      variable.components.set(srcId, {
        id: srcId,
        dependencies,
        isDependency,
        loc,
      });
    }

    return variable.id;
  }

  public addEffect(loc: VariableLoc, effect: Omit<EffectInfo, "id">) {
    const variable = this.getVariable(loc);

    assert(variable != null, "Variable not found");

    assert(
      isHookVariable(variable) || isComponentVariable(variable),
      "can't add hook to non-hook",
    );

    variable.addEffect(effect);
  }
}

export class FileDB {
  src_dir: string;

  private files: Map<string, File>;

  constructor(src_dir: string) {
    this.files = new Map();
    this.src_dir = src_dir;
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
        return file.hash !== cache.hash;
      }

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
        getDeterministicId(`${fileName}:${localName}`)
      );
    }

    // Fallback to deterministic ID based on file and name
    return getDeterministicId(`${fileName}:${localName}`);
  }

  public getData(): JsonData["files"] {
    return Object.fromEntries(
      Object.entries(Object.fromEntries(this.files)).map(([k, value]) => [
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

  public getDefaultExport(fileName: string) {
    const file = this.get(fileName);
    return file.defaultExport;
  }

  public addVariable(
    fileName: string,
    variable: Variable,
    parentPath?: string[],
  ) {
    // resolve propType
    const file = this.get(fileName);

    return file.addVariable(variable, parentPath);
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
    return file.getHookInfoFromLoc(loc);
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

  public getRefTypeId(name: string, file: File) {
    const varId = file.getVariableID(name);
    if (varId) return varId;

    const type = file.getTypeFromName(name);
    if (type) return type.id;

    if (file.getTypeByID(name)) return name;

    if (file.import?.has(name)) {
      const importData = file.import.get(name);
      if (importData) {
        if (this.has(importData.source)) {
          const file = this.get(importData.source);
          return file.getExport(importData);
        }
      }
    }
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

  private _resolveTypeRef(
    typeData: TypeDataRef,
    file: File,
    params: Set<string>,
  ): boolean {
    const name = this.getTypeDataRefName(typeData);
    if (params.has(name)) return true;

    const id = this.getRefTypeId(name, file);
    if (id != null) {
      if (typeData.refType === "named") {
        typeData.name = id;
      } else {
        assert(typeData.names?.length > 0);
        typeData.names[0] = id;
      }
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
    union: (db, td: TypeDataTypeBodyUnion, file, params) =>
      td.members.every((m) => db.updateTypeDataID(m, file, params)),
    intersection: (db, td: TypeDataTypeBodyIntersection, file, params) =>
      td.members.every((m) => db.updateTypeDataID(m, file, params)),
    array: (db, td: TypeDataArray, file, params) =>
      db.updateTypeDataID(td.element, file, params),
    parenthesis: (db, td: TypeDataTypeBodyParathesis, file, params) =>
      db.updateTypeDataID(td.members, file, params),
    "type-literal": (db, td: TypeDataTypeBodyLiteral, file, params) =>
      td.members.every((m) => db.updateTypeDataID(m.type, file, params)),
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
      for (const param of Object.values(typeDeclare.params)) {
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
        if (!this.updateTypeDataID(body.type, file, params)) {
          allResolved = false;
        }
      }
    } else if (typeDeclare.type === "type") {
      if (!this.updateTypeDataID(typeDeclare.body, file, params)) {
        allResolved = false;
      }
    }

    return allResolved;
  }

  public addTsTypes(fileName: string, type: Omit<TypeDataDeclare, "id">) {
    const file = this.get(fileName);

    const typeDeclare = {
      id: file.getNewVarID(type.name, file.var),
      ...type,
    } as TypeDataDeclare;

    this.resolveTsTypeID(typeDeclare, file);

    file.addTsTypes(type.loc, typeDeclare);

    return typeDeclare;
  }

  public addRender(
    fileName: string,
    comLoc: string,
    srcId: string,
    dependencies: ComponentInfoRenderDependency[],
    isDependency: boolean,
    loc: VariableLoc,
  ) {
    const file = this.get(fileName);

    return file.addRender(comLoc, srcId, dependencies, isDependency, loc);
  }
}
