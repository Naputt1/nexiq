import assert from "assert";
import type {
  ComponentFileImport,
  DataEdge,
  ComponentFileExport,
  JsonData,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  VariableLoc,
  ComponentFileVarHook,
  ComponentFileVarJSX,
  EffectInfo,
  TypeDataDeclare,
  ComponentFile,
  ComponentFileVarNormalFunction,
  ComponentFileVarNormalData,
  Memo,
  RefData,
  VariableName,
  VarKind,
  ComponentInfoRender,
} from "shared";
import { FileDB } from "./fileDB.js";
import type { PackageJson } from "./packageJson.js";
import fs from "fs";
import path from "path";
import { ComponentVariable } from "./variable/component.js";
import { DataVariable } from "./variable/dataVariable.js";
import { JSXVariable } from "./variable/jsx.js";
import type { Variable } from "./variable/variable.js";
import {
  isComponentVariable,
  isBaseFunctionVariable,
  isNormalVariable,
  isCallHookVariable,
  isJSXVariable,
} from "./variable/type.js";
import { HookVariable } from "./variable/hook.js";
import { FunctionVariable } from "./variable/functionVariable.js";
import { getDeterministicId } from "../utils/hash.js";
import { getVariableNameKey } from "../analyzer/pattern.js";
import type { ReactFunctionVariable } from "./variable/reactFunctionVariable.js";

type IResolveAddRender = {
  type: "comAddRender";
  name: string;
  fileName: string;
  tag: string;
  dependency: ComponentInfoRenderDependency[];
  loc: VariableLoc;
  parentId?: string | undefined;
};

type IResolveAddHook = {
  type: "comAddHook";
  name: string;
  fileName: string;
  hook: string;
  loc: VariableLoc;
};

type IResolveCallHook = {
  type: "comResolveCallHook";
  fileName: string;
  loc: VariableLoc;
  id: string;
  hook: string;
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
  | IResolveCallHook
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

  private jsxStack: string[] = [];
  private renderInstanceStack: (string | undefined)[] = [];

  constructor(options: ComponentDBOptions) {
    this.edges = [];
    this.files = new FileDB(options.dir);

    this.resolveTasks = [];
    this.typesToResolve = new Set();

    this.packageJson = options.packageJson;
    this.viteAliases = options.viteAliases;

    this.dir = options.dir;
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

  public addComponent(
    fileName: string,
    component: Omit<
      ComponentFileVarComponent,
      "id" | "kind" | "states" | "hash" | "file"
    >,
    parentPath?: string[],
    declarationKind?:
      | "const"
      | "let"
      | "var"
      | "using"
      | "await using"
      | undefined,
  ) {
    const file = this.files.get(fileName);

    const nameKey = getVariableNameKey(component.name);

    const id = this.files.addVariable(
      fileName,
      new ComponentVariable(
        {
          id: getDeterministicId(nameKey),
          ...component,
          states: [],
          declarationKind,
          forwardRef: component.forwardRef ?? false,
        },
        file,
      ),
      parentPath,
    );

    if (this.files.resolveComPropsTsTypeID(id, fileName)) {
      this.resolveTasks.push({
        type: "comPropsTsType",
        fileName: fileName,
        id,
      });
    }

    return id;
  }

  public addJSXVariable(
    fileName: string,
    jsx: Omit<ComponentFileVarJSX, "id" | "kind" | "type" | "hash" | "file">,
    parentPath?: string[],
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
          id: getDeterministicId(nameKey),
          ...jsx,
          declarationKind,
        },
        file,
      ),
      parentPath,
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
      "id" | "kind" | "var" | "renders" | "states" | "hash" | "file"
    >,
    parentPath?: string[],
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
          id: getDeterministicId(nameKey),
          ...variable,
          states: [],
          declarationKind,
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
          "id" | "kind" | "var" | "renders" | "file" | "hash"
        >
      | Omit<
          ComponentFileVarNormalData,
          "id" | "kind" | "var" | "renders" | "file" | "hash"
        >,
    parentPath?: string[],
    kind?: VarKind,
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

    let v: Variable | undefined;
    if (variable.type === "function") {
      v = new FunctionVariable(
        {
          id: getDeterministicId(nameKey),
          ...variable,
          declarationKind,
        },
        file,
      );
    } else if (variable.type === "data") {
      // assert(kind != null);
      if (kind == null) {
        debugger;
        return;
      }

      v = new DataVariable(
        {
          id: getDeterministicId(nameKey),
          ...variable,
          kind,
          declarationKind,
        },
        file,
      );
    }

    assert(v != null, "Variable not found");

    return this.files.addVariable(fileName, v, parentPath);
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
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null) return "no-parent";

    return component.addState(state);
  }

  public comAddCallHook(
    loc: VariableLoc,
    fileName: string,
    callHook: Parameters<ReactFunctionVariable["addCallHook"]>[0],
  ) {
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null) return "no-parent";

    const id = component.addCallHook(callHook);

    const hookName = callHook.call.name;
    const comImport = this.files.getImport(fileName, hookName);

    if (comImport?.source !== "react") {
      const exportInfo = this._getExportId(fileName, hookName);
      let hookId: string | null = null;

      if (exportInfo) {
        hookId = exportInfo.id;
      } else {
        hookId = this.getVariableID(hookName, fileName);
      }

      if (hookId) {
        const v = component.var.get(id);
        if (v && isCallHookVariable(v)) {
          v.call.id = hookId;
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

  public comAddRef(
    loc: VariableLoc,
    fileName: string,
    ref: Omit<RefData, "id"> & { name: VariableName },
  ) {
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null) return "no-parent";

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
    if (component == null) return;

    component.addHook(exportInfo.id);
  }

  public comAddEffect(
    fileName: string,
    loc: VariableLoc,
    effect: Omit<EffectInfo, "id">,
  ) {
    const file = this.files.get(fileName);

    file.addEffect(loc, effect);
  }

  public getVariableID(name: string, fileName: string): string | null {
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
    dependency: ComponentInfoRenderDependency[],
    loc: VariableLoc,
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
      const parts = comLoc.split("@");
      if (parts.length === 2) {
        const line = parseInt(parts[0]!);
        const column = parseInt(parts[1]!);
        if (!isNaN(line) && !isNaN(column)) {
          const contextId = this.getVariableIDFromLoc(fileName, {
            line,
            column,
          });
          if (contextId) {
            const file = this.files.get(fileName);
            const variable = file.var.get(contextId, true);
            if (variable && isBaseFunctionVariable(variable)) {
              const resolvedId = variable.var.getIdByName(tag);
              if (resolvedId) {
                srcId = resolvedId;
              }
            }
          }
        }
      }

      if (!srcId) {
        srcId = this.getVariableID(tag, fileName) ?? "";
      }
    }

    if (!srcId) {
      if (tag && tag[0] === tag[0]?.toLowerCase()) {
        srcId = tag;
      } else {
        if (this.isResolve) return "";

        this.addResolveTask({
          type: "comAddRender",
          name: comLoc,
          fileName: fileName,
          tag,
          dependency,
          loc,
          parentId,
        });
        return "";
      }
    }

    const instanceId = getDeterministicId(`${tag}-${loc.line}-${loc.column}`);

    this.files.addRender(
      fileName,
      comLoc,
      srcId,
      instanceId,
      tag,
      dependency,
      isDependency,
      loc,
      parentId,
    );

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

  private _resolveDependency(
    variable: Variable,
    parent?: string,
    visited: Set<string> = new Set(),
  ) {
    if (visited.has(variable.id)) return;
    visited.add(variable.id);

    const resolveRenders = (
      renders: Record<string, ComponentInfoRender>,
      pId?: string,
    ) => {
      if (!renders) return;
      for (const render of Object.values(renders)) {
        if (!render.isDependency && pId != null) {
          this.edges.push({
            from: pId,
            to: render.id,
            label: "render",
          });
        }
        resolveRenders(render.renders, pId);
      }
    };

    if (
      variable.kind === "component" &&
      isComponentVariable(variable) &&
      variable.renders &&
      typeof variable.renders === "object"
    ) {
      for (const render of Object.values(variable.renders)) {
        if (render.isDependency) continue;

        this.edges.push({
          from: render.id,
          to: variable.id,
          label: "render",
        });
        resolveRenders(render.renders, variable.id);
      }
    } else if (
      isNormalVariable(variable) &&
      variable.renders &&
      typeof variable.renders === "object"
    ) {
      if (parent != null) {
        for (const render of Object.values(variable.renders)) {
          if (render.isDependency) continue;

          this.edges.push({
            from: parent,
            to: render.id,
            label: "render",
          });
          resolveRenders(render.renders, parent);
        }
      }
    } else if (
      isJSXVariable(variable) &&
      variable.renders &&
      typeof variable.renders === "object"
    ) {
      if (parent != null) {
        this.edges.push({
          from: parent,
          to: variable.id,
          label: "render",
        });
        resolveRenders(variable.renders, parent);
      }
    }

    // Handle nested var iteration (Map or Record)
    if (isBaseFunctionVariable(variable) && (variable as any).var) {
      for (const innerVar of (variable as any).var.values()) {
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
        task.dependency,
        task.loc,
        task.parentId,
      );
    },
    comAddHook: (db, task) => {
      db.comAddHook(task.name, task.loc, task.fileName, task.hook);
    },
    comResolveCallHook: (db, task) => {
      const component = db.files.getHookInfoFromLoc(task.fileName, task.loc);
      if (component) {
        const exportInfo = db._getExportId(task.fileName, task.hook);
        let hookId: string | null = null;
        if (exportInfo) {
          hookId = exportInfo.id;
        } else {
          hookId = db.getVariableID(task.hook, task.fileName);
        }

        if (hookId) {
          const v = component.var.get(task.id);
          if (v && isCallHookVariable(v)) {
            v.call.id = hookId;
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
  };

  public resolve() {
    this.isResolve = true;

    const maxRetries = 1000;
    let retries = 0;

    while (this.resolveTasks.length > 0 && retries < maxRetries) {
      const currentTasks = [...this.resolveTasks];
      const prevTaskCount = this.resolveTasks.length;
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
        {
          remainingTasks: this.resolveTasks.length,
          taskTypes: [...new Set(this.resolveTasks.map((t) => t.type))],
        },
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

  public getVariableFromLoc(fileName: string, loc: VariableLoc) {
    return this.files.getVariableFromLoc(fileName, loc);
  }

  public getVariableIDFromLoc(fileName: string, loc: VariableLoc) {
    const v = this.getVariableFromLoc(fileName, loc);
    return v?.id;
  }
}
