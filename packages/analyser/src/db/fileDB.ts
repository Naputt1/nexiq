import assert from "assert";
import type {
  ComponentFile,
  ComponentFileExport,
  ComponentFileImport,
  ComponentFileVar,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  JsonData,
  VariableLoc,
} from "shared";
import type { Variable } from "./variable/variable.js";
import type { ComponentVariable } from "./variable/component.js";
import { isComponentVariable, isDataVariable } from "./variable/type.js";

interface FileIds {
  id: string;
  var: Map<string, FileIds>;
}

export class File {
  path: string;
  import: Record<string, ComponentFileImport>;
  export: Record<string, ComponentFileExport>;
  defaultExport: string | null;
  var: Map<string, Variable>;

  // key = loc.line + @ + loc.column val = variable
  private locIdsMap = new Map<string, Variable>();

  private dependencyMap = new Map<string, string>();
  private ids = new Map<string, FileIds>();

  constructor(filename: string) {
    this.path = filename;
    this.import = {};
    this.export = {};
    this.defaultExport = null;
    this.var = new Map();
  }

  public addImport(fileImport: ComponentFileImport) {
    this.import[fileImport.localName] = {
      localName: fileImport.localName,
      importedName: fileImport.importedName,
      source: fileImport.source,
      type: fileImport.type,
      importKind: fileImport.importKind,
    };
  }

  public addExport(exportData: ComponentFileExport) {
    this.export[exportData.name] = exportData;
    if (exportData.type === "default") {
      this.defaultExport = exportData.name;
    }
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

    for (const [key, value] of _variable) {
      const parent = this.getParentFromId(id, value.var);
      if (parent) {
        return parent;
      }
    }

    return undefined;
  }

  public addVariable(variable: Variable, parentPath?: string[]) {
    this.locIdsMap.set(`${variable.loc.line}@${variable.loc.column}`, variable);

    if (parentPath == null || parentPath.length == 0) {
      this.var.set(variable.id, variable);
      this.ids.set(variable.name, {
        id: variable.id,
        var: new Map(),
      });
    } else {
      const parentId = this.getParentId(parentPath);
      // const parentId = this.ids.get(parentPath);
      if (parentId == null) {
        debugger;
        //TODO: handle parent not found
        return;
      }

      const parent = this.getParent(parentPath);
      if (parent == null) {
        debugger;
        //TODO: handle parent not found
        return;
      }

      parent.var.set(variable.id, variable);
      variable.parent = parent;
      parentId.var.set(variable.name, {
        id: variable.id,
        var: new Map(),
      });
    }
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

  private getComboByID(id: string) {
    if (this.var.has(id)) {
      const parentCombo = this.var.get(id);
      if (parentCombo != null) {
        return parentCombo;
      }
    }

    if (this.dependencyMap.has(id)) {
      const parentId = this.dependencyMap.get(id);
      if (parentId != null) {
        const parent = this.getTopParent(parentId);
        if (parent != null) {
          return parent.dependencies[id];
        }
      }
    }

    return undefined;
  }

  public getData(): ComponentFile {
    return {
      path: this.path,
      import: this.import,
      export: this.export,
      defaultExport: this.defaultExport,
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
    if (variable.isComponent) return;

    variable.dependencies[dependency.id] = dependency;
  }

  private _getDependenciesIds(
    dependencies: ComponentInfoRenderDependency[],
    depMap: Record<string, number>,
    parent: Variable | undefined
  ) {
    if (parent == null) return;

    for (const [key, com] of parent.var) {
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
        for (const [key, com] of this.var) {
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
    assert(file.import[fileImport.localName] == null, "Import already exists");

    file.addImport(fileImport);
  }

  public get(fileName: string) {
    const file = this.files.get(fileName);
    assert(file != null, "File not found");
    return file;
  }

  public getImport(fileName: string, localName: string) {
    const file = this.get(fileName);
    return file.import[localName];
  }

  public getComId(fileName: string, localName: string) {
    const file = this.get(fileName);

    if (file.export.hasOwnProperty(localName)) {
      return file.export[localName]?.id ?? crypto.randomUUID();
    }

    return crypto.randomUUID();
  }

  public getData(): JsonData["files"] {
    return Object.fromEntries(
      Object.entries(Object.fromEntries(this.files)).map(([k, value]) => [
        k,
        value.getData(),
      ])
    );
  }

  public addExport(fileName: string, exportData: ComponentFileExport) {
    const file = this.get(fileName);

    file.addExport(exportData);
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
    const file = this.get(fileName);

    file.addVariable(variable, parentPath);
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

  public addVariableDependency(
    fileName: string,
    parent: string,
    dependency: ComponentFileVarDependency
  ) {
    const file = this.get(fileName);

    file.addVariableDependency(parent, dependency);
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
