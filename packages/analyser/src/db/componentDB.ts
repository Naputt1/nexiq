import assert from "assert";
import type {
  ComponentFileImport,
  State,
  DataEdge,
  ComponentFileExport,
  JsonData,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  VariableLoc,
  ComponentFileVarHook,
  EffectInfo,
  TypeDataDeclare,
  ComponentFile,
  ComponentFileVarNormalFunction,
  ComponentFileVarNormalData,
} from "shared";
import { FileDB } from "./fileDB.js";
import type { PackageJson } from "./packageJson.js";
import fs from "fs";
import path from "path";
import { ComponentVariable } from "./variable/component.js";
import { DataVariable } from "./variable/dataVariable.js";
import type { Variable } from "./variable/variable.js";
import {
  isComponentVariable,
  isFunctionVariable,
  isNormalVariable,
} from "./variable/type.js";
import { newUUID } from "../utils/uuid.js";
import { HookVariable } from "./variable/hook.js";

type IResolveAddRender = {
  type: "comAddRender";
  name: string;
  fileName: string;
  tag: string;
  dependencry: ComponentInfoRenderDependency[];
  loc: VariableLoc;
};

type IResolveAddHook = {
  type: "comAddHook";
  name: string;
  fileName: string;
  hook: string;
  loc: VariableLoc;
};

type IResolveTsType = {
  type: "tsType";
  fileName: string;
  id: string;
};

type IResolveComPropsTsType = {
  type: "comPropsTsType";
  fileName: string;
  id: string;
};

type ComponentDBResolve =
  | IResolveAddRender
  | IResolveAddHook
  | IResolveTsType
  | IResolveComPropsTsType;

export type ComponentDBOptions = {
  packageJson: PackageJson;
  viteAliases: Record<string, string>;
  dir: string;
};

export class ComponentDB {
  private edges: DataEdge[];
  private files: FileDB;

  private resolveTasks: ComponentDBResolve[];
  private typesToResolve: Set<string>;

  private isResolve = false;

  private packageJson: PackageJson;
  private viteAliases: Record<string, string>;

  private dir: string;

  constructor(options: ComponentDBOptions) {
    this.edges = [];
    this.files = new FileDB(options.dir);

    this.resolveTasks = [];
    this.typesToResolve = new Set();

    this.packageJson = options.packageJson;
    this.viteAliases = options.viteAliases;

    this.dir = options.dir;
  }

  public addComponent(
    component: Omit<ComponentFileVarComponent, "id" | "variableType">,
    parentPath?: string[],
  ) {
    const file = this.files.get(component.file);

    const id = this.files.addVariable(
      component.file,
      new ComponentVariable(
        {
          id: newUUID(),
          ...component,
        },
        file,
      ),
      parentPath,
    );

    if (this.files.resolveComPropsTsTypeID(id, component.file)) {
      this.resolveTasks.push({
        type: "comPropsTsType",
        fileName: component.file,
        id,
      });
    }
  }

  public addHook(
    variable: Omit<
      ComponentFileVarHook,
      "id" | "variableType" | "var" | "components"
    >,
    parentPath?: string[],
  ) {
    const file = this.files.get(variable.file);

    this.files.addVariable(
      variable.file,
      new HookVariable(
        {
          id: newUUID(),
          ...variable,
        },
        file,
      ),
      parentPath,
    );
  }

  public addVariable(
    fileName: string,
    variable:
      | Omit<
          ComponentFileVarNormalFunction,
          "id" | "variableType" | "var" | "components"
        >
      | Omit<
          ComponentFileVarNormalData,
          "id" | "variableType" | "var" | "components"
        >,
    parentPath?: string[],
  ) {
    const file = this.files.get(fileName);

    this.files.addVariable(
      fileName,
      new DataVariable(
        {
          id: newUUID(),
          ...variable,
        },
        file,
      ),
      parentPath,
    );
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
    state: Omit<State, "id">,
  ) {
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null) debugger;
    assert(component != null, "Component not found");

    component.addState(state);
  }

  private _getExportId(
    fileName: string,
    name: string,
  ): { id: string; isDependency: boolean } | null {
    const comImport = this.files.getImport(fileName, name);
    if (!comImport) return null;

    const isDependency = this.isDependency(comImport.source);
    if (isDependency) {
      return { id: comImport.localName, isDependency: true };
    }

    if (this.files.has(comImport.source)) {
      const file = this.files.get(comImport.source);
      const id = file.getExport(comImport);
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
      });
      return;
    }

    const component = this.files.getHookInfoFromLoc(fileName, loc);
    assert(component != null, "Component not found");

    component.addHook(exportInfo.id);
  }

  public comAddEffect(
    fileName: string,
    loc: VariableLoc,
    effect: Omit<EffectInfo, "id">,
  ) {
    const file = this.files.get(fileName);

    file.addEffect(loc, {
      id: newUUID(),
      ...effect,
    });
  }

  private getVariableID(name: string, fileName: string): string | null {
    const file = this.files.get(fileName);
    if (file == null) {
      return null;
    }

    return file.getVariableID(name);
  }

  public comAddRender(
    comLoc: string,
    fileName: string,
    tag: string,
    dependencry: ComponentInfoRenderDependency[],
    loc: VariableLoc,
  ) {
    const exportInfo = this._getExportId(fileName, tag);

    if (exportInfo == null) {
      if (this.isResolve) return;

      this.addResolveTask({
        type: "comAddRender",
        name: comLoc,
        fileName,
        tag,
        dependencry,
        loc,
      });
      return;
    }

    this.files.addRender(
      fileName,
      comLoc,
      exportInfo.id,
      dependencry,
      exportInfo.isDependency,
      loc,
    );
  }

  public addFile(file: string, cache?: ComponentFile) {
    return this.files.add(file, cache);
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

  public fileAddTsTypes(fileName: string, type: Omit<TypeDataDeclare, "id">) {
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
      return Object.values(collection);
    }
    return [];
  }

  private _resolveDependency(variable: Variable, parent?: string) {
    if (
      variable.variableType === "component" &&
      isComponentVariable(variable)
    ) {
      for (const render of Object.values(variable.renders)) {
        if (render.isDependency) continue;

        this.edges.push({
          from: render.id,
          to: variable.id,
          label: "render",
        });
      }
    } else if (
      variable.variableType === "normal" &&
      isNormalVariable(variable)
    ) {
      if (parent != null) {
        // Handle components iteration (Map or Record)
        const components = this._getValues(variable.components);
        for (const innerCom of components) {
          if (innerCom.isDependency) continue;

          this.edges.push({
            from: parent,
            to: innerCom.id,
            label: "render",
          });
        }
      }
    }

    // Handle nested var iteration (Map or Record)
    if (isFunctionVariable(variable)) {
      const vars = this._getValues(variable.var);
      for (const innerVar of vars) {
        this._resolveDependency(
          innerVar,
          variable.variableType == "component" ? variable.id : parent,
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
    const edges: DataEdge[] = [];

    for (const file of this.files.getFiles()) {
      edges.push(...file.getEdges());
    }

    return edges;
  }

  public getData(): JsonData {
    return {
      src: path.resolve(this.dir),
      files: this.files.getData(),
      edges: this.getEdges(),
      // resolve: this.resolveTasks,
    };
  }

  private addResolveTask(resolve: ComponentDBResolve) {
    this.resolveTasks.push(resolve);
  }

  private static RESOLVE_HANDLERS: {
    [K in ComponentDBResolve["type"]]: (
      db: ComponentDB,
      task: Extract<ComponentDBResolve, { type: K }>,
    ) => void | boolean;
  } = {
    comAddRender: (db, task) => {
      db.comAddRender(
        task.name,
        task.fileName,
        task.tag,
        task.dependencry,
        task.loc,
      );
    },
    comAddHook: (db, task) => {
      db.comAddHook(task.name, task.loc, task.fileName, task.hook);
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
  };

  public resolve() {
    this.isResolve = true;

    const maxRetries = 100;
    let retries = 0;

    while (this.resolveTasks.length > 0 && retries < maxRetries) {
      const currentTasks = [...this.resolveTasks];
      this.resolveTasks = [];

      for (const task of currentTasks) {
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

      retries++;
    }

    if (retries >= maxRetries && this.resolveTasks.length > 0) {
      console.warn(
        "Resolution interrupted: suspected infinite loop or deep dependency chain in ComponentDB.resolve",
      );
    }

    this.resolveTasks = [];
    this.isResolve = false;
  }

  public isDependency(name: string): boolean {
    return this.packageJson.isDependency(name);
  }

  public getImportFileName(name: string, fileName: string) {
    let source = name;
    if (source.startsWith(".") || source.startsWith("..")) {
      const fileDir = path.dirname(fileName);
      source = path.join(fileDir, source);
      source = path.normalize(source);
    } else if (!this.isDependency(source)) {
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
}
