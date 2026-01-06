import assert from "assert";
import type {
  ComponentFile,
  ComponentFileExport,
  ComponentFileImport,
  ComponentFileVar,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  EffectInfo,
  HookInfo,
  JsonData,
  TypeDataDeclare,
  VariableLoc,
  VariableScope,
} from "shared";
import type { Variable } from "./variable/variable.js";
import type { ComponentVariable } from "./variable/component.js";
import {
  isHookVariable,
  isComponentVariable,
  isDataVariable,
} from "./variable/type.js";
import { newUUID } from "../utils/uuid.js";
import type { HookVariable } from "./variable/hook.js";
import type {
  TypeData,
  TypeDataLiteralTypeLiteral,
  TypeDataRef,
  TypeDataArray,
  TypeDataTypeBodyUnion,
  TypeDataTypeBodyIntersection,
  TypeDataTypeBodyParathesis,
  TypeDataTypeBodyLiteral,
  TypeDataFunction,
  TypeDataTuple,
  TypeDataIndexAccess,
} from "shared/src/types/primitive.js";

interface FileIds {
  id: string;
  var: Map<string, FileIds>;
}

type TypeDataHandlerMap = {
  ref: TypeDataRef;
  union: TypeDataTypeBodyUnion;
  intersection: TypeDataTypeBodyIntersection;
  array: TypeDataArray;
  parenthesis: TypeDataTypeBodyParathesis;
  "type-literal": TypeDataTypeBodyLiteral;
  "literal-type": { literal: TypeDataLiteralTypeLiteral };
  function: TypeDataFunction;
  tuple: TypeDataTuple;
  "index-access": TypeDataIndexAccess;
};

type TypeDataHandler<T> = (
  db: FileDB,
  td: T,
  file: File,
  params: Set<string>
) => boolean;

export class File {
  path: string;
  import: Map<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
  tsTypes: Map<string, TypeDataDeclare>;
  var: Map<string, Variable>;

  scopes = new Set<Variable>();

  // key = loc.line + @ + loc.column val = variable
  private locIdsMap = new Map<string, Variable>();

  private tsTypesID = new Map<string, TypeDataDeclare>();

  private dependencyMap = new Map<string, string>();
  private ids = new Map<string, FileIds>();

  constructor(filename: string) {
    this.path = filename;
    this.import = new Map();
    this.export = {};
    this.defaultExport = null;
    this.tsTypes = new Map();
    this.var = new Map();
  }

  public addImport(fileImport: ComponentFileImport) {
    this.import.set(fileImport.localName, {
      localName: fileImport.localName,
      importedName: fileImport.importedName,
      source: fileImport.source,
      type: fileImport.type,
      importKind: fileImport.importKind,
    });
  }

  public addExport(exportData: Omit<ComponentFileExport, "id">) {
    const id = this.getVariableID(exportData.name) ?? newUUID();

    this.export[exportData.name] = { ...exportData, id };
    if (exportData.type === "default") {
      this.defaultExport = exportData.name;
    }

    return id;
  }

  private getParentId(parentPath: string[]): FileIds | undefined {
    let parent: FileIds = {
      id: "",
      var: this.ids,
    };
    for (let i = parentPath.length - 1; i >= 0; i--) {
      if (parent.var.has(parentPath[i]!)) {
        parent = parent.var.get(parentPath[i]!)!;
        continue;
      }

      return undefined;
    }

    return parent;
  }

  private getParent(parentPath: string[]) {
    const ids: string[] = [];
    let parentId: FileIds = {
      id: "",
      var: this.ids,
    };
    for (let i = parentPath.length - 1; i >= 0; i--) {
      if (parentId.var.has(parentPath[i]!)) {
        parentId = parentId.var.get(parentPath[i]!)!;
        ids.push(parentId.id);
        continue;
      }

      debugger;
      return undefined;
    }

    if (ids.length == 0) {
      return undefined;
    }

    let parent = undefined;
    for (const id of ids) {
      if (parent == null) {
        parent = this.var.get(id);
        continue;
      }

      parent = parent.var.get(id);
      if (parent == null) {
        debugger;
        return undefined;
      }
    }

    return parent;
  }

  private getParentFromId(
    id: string,
    varables?: Map<string, Variable>
  ): Variable | undefined {
    const _variable = varables ?? this.var;

    if (_variable.has(id)) {
      return _variable.get(id);
    }

    for (const [_key, value] of _variable) {
      const parent = this.getParentFromId(id, value.var);
      if (parent) {
        return parent;
      }
    }

    return undefined;
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

  public getNewVarID(name: string): string {
    for (const ex of Object.values(this.export)) {
      if (ex.name === name) {
        return ex.id;
      }
    }

    return newUUID();
  }

  public addVariable(variable: Variable, parentPath?: string[]): string {
    this.locIdsMap.set(`${variable.loc.line}@${variable.loc.column}`, variable);

    if (variable.type === "function") {
      this.scopes.add(variable);
    }

    if (parentPath == null || parentPath.length == 0) {
      const id = this.getNewVarID(variable.name);
      variable.id = id;

      this.var.set(id, variable);
      this.ids.set(variable.name, {
        id: id,
        var: new Map(),
      });

      return id;
    } else {
      const parentId = this.getParentId(parentPath);
      // const parentId = this.ids.get(parentPath);
      if (parentId == null) {
        debugger;
        //TODO: handle parent not found
        return "no parent";
      }

      const parent = this.getParent(parentPath);
      if (parent == null) {
        debugger;
        //TODO: handle parent not found
        return "no parent";
      }

      parent.var.set(variable.id, variable);
      variable.parent = parent;
      parentId.var.set(variable.name, {
        id: variable.id,
        var: new Map(),
      });

      return variable.id;
    }
  }

  public getVariable(loc: VariableLoc): Variable | undefined {
    return this.locIdsMap.get(`${loc.line}@${loc.column}`);
  }

  private getTopParent(id: string): Variable | undefined {
    if (this.var.has(id)) {
      const parentCombo = this.var.get(id);
      if (parentCombo != null) {
        return parentCombo;
      }
    }

    if (this.dependencyMap.has(id)) {
      const parentId = this.dependencyMap.get(id);
      if (parentId != null) {
        return this.getTopParent(parentId);
      }
    }

    return undefined;
  }

  public getData(): ComponentFile {
    return {
      path: this.path,
      import: Object.fromEntries(this.import),
      export: this.export,
      defaultExport: this.defaultExport,
      tsTypes: Object.fromEntries(
        Object.entries(Object.fromEntries(this.tsTypes))
      ),
      var: Object.fromEntries(
        Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
          k,
          value.getData(),
        ])
      ),
    };
  }

  public addVariableDependency(
    parent: string,
    dependency: ComponentFileVarDependency
  ) {
    let variable: ComponentFileVar | null = null;
    for (const v of Object.values(this.var)) {
      if (v.name === parent) {
        variable = v;
        break;
      }
    }

    if (variable == null) {
      debugger;
    }
    assert(variable != null, "Parent variable not found");
    if (variable == null) return;
    if (variable.variableType == "component") return;

    variable.dependencies[dependency.id] = dependency;
  }

  private _getDependenciesIds(
    dependencies: ComponentInfoRenderDependency[],
    depMap: Record<string, number>,
    parent: Variable | undefined
  ) {
    if (parent == null) return;

    for (const [_key, com] of parent.var) {
      if (Object.keys(depMap).includes(com.name)) {
        const depI = depMap[com.name];
        const dep = dependencies[depI!];

        dep!.value = com.id;

        delete depMap[com.name];
        if (Object.keys(depMap).length === 0) {
          return;
        }
      }
    }

    if (Object.keys(depMap).length > 0) {
      if (parent.parent == null) {
        for (const [_key, com] of this.var) {
          if (Object.keys(depMap).includes(com.name)) {
            const depI = depMap[com.name];
            const dep = dependencies[depI!];

            dep!.value = com.id;

            delete depMap[com.name];
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
    dependencies: ComponentInfoRenderDependency[]
  ) {
    const depMap: Record<string, number> = {};
    for (const [i, dep] of dependencies.entries()) {
      depMap[dep.value] = i;
    }

    const parent = this.getParentFromId(id);

    if (parent == null) {
      this._getDependenciesIds(dependencies, depMap, this.var.get(id));
    } else {
      this._getDependenciesIds(dependencies, depMap, parent);
    }
  }

  public getVariableID(name: string): string | null {
    const id = this.ids.get(name);
    if (id != null) {
      return id.id;
    }

    return null;
  }

  public getScope(scope: VariableScope) {
    for (const s of this.scopes) {
      assert(s.type === "function", "Scope variable must be a function");

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
      assert(s.type === "function", "Scope variable must be a function");

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
    if (!type.id) {
      const id = this.getNewVarID(type.name);
      type.id = id;
    }

    this.ids.set(type.name, { id: type.id, var: new Map() });

    this.tsTypes.set(type.id, type);
    this.tsTypesID.set(type.name, type);
  }

  public addRender(
    comLoc: string,
    srcId: string,
    dependencies: ComponentInfoRenderDependency[],
    isDependency: boolean,
    loc: VariableLoc
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
    } else if (isDataVariable(variable)) {
      variable.components.set(srcId, {
        id: srcId,
        dependencies,
        isDependency,
        loc,
      });
    }

    return variable.id;
  }

  public addEffect(loc: VariableLoc, effect: EffectInfo) {
    const variable = this.getVariable(loc);

    assert(variable != null, "Variable not found");

    assert(
      isHookVariable(variable) || isComponentVariable(variable),
      "can't add hook to non-hook"
    );

    const newDependencies: string[] = [];
    for (const dep of effect.dependencies) {
      for (const state of Object.values(variable.states)) {
        if (state.value === dep) {
          newDependencies.push(state.id);
        }
      }
    }

    effect.dependencies = newDependencies;
    variable.effects[effect.id] = effect;
  }
}

export class FileDB {
  private files: Map<string, File>;

  constructor() {
    this.files = new Map();
  }

  public getFiles() {
    return this.files.values();
  }

  public add(filename: string) {
    this.files.set(filename, new File(filename));
  }

  public addImport(fileName: string, fileImport: ComponentFileImport) {
    const file = this.files.get(fileName);
    assert(file != null, "File not found");
    assert(
      file.import.get(fileImport.localName) == null,
      "Import already exists"
    );

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
      return file.export[localName]?.id ?? newUUID();
    }

    return newUUID();
  }

  public getData(): JsonData["files"] {
    return Object.fromEntries(
      Object.entries(Object.fromEntries(this.files)).map(([k, value]) => [
        k,
        value.getData(),
      ])
    );
  }

  public addExport(
    fileName: string,
    exportData: Omit<ComponentFileExport, "id">
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
    parentPath?: string[]
  ) {
    // resolve propType
    const file = this.get(fileName);

    return file.addVariable(variable, parentPath);
  }

  public getComponent(
    fileName: string,
    id: string
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
    loc: VariableLoc
  ): Variable | undefined {
    const file = this.get(fileName);
    return file.getVariable(loc);
  }

  public getHookInfoFromLoc(
    fileName: string,
    loc: VariableLoc
  ): HookInfo | undefined {
    const file = this.get(fileName);
    const variable = file.getVariable(loc);
    if (
      variable &&
      (isHookVariable(variable) || isComponentVariable(variable))
    ) {
      return variable;
    }

    return undefined;
  }

  public getComponentFromLoc(
    fileName: string,
    loc: VariableLoc
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
    loc: VariableLoc
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
    dependency: ComponentFileVarDependency
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
    params: Set<string>
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
    params: Set<string>
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
      params
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
    kind: string
  ): kind is keyof typeof FileDB.TYPE_DATA_HANDLERS {
    return kind in FileDB.TYPE_DATA_HANDLERS;
  }

  public updateTypeDataID(
    typeData: TypeData,
    file: File,
    params: Set<string>
  ): boolean {
    if (!this.hasTypeDataHandler(typeData.type)) return true;

    return FileDB.TYPE_DATA_HANDLERS[typeData.type](
      this,
      typeData as never,
      file,
      params
    );
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
      id: file.getNewVarID(type.name),
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
    loc: VariableLoc
  ) {
    const file = this.get(fileName);

    return file.addRender(comLoc, srcId, dependencies, isDependency, loc);
  }
}
