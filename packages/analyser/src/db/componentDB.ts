import assert from "assert";
import type {
  ComponentFileImport,
  DataEdge,
  ComponentFileExport,
  JsonData,
  ComponentFileVar,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentInfoRenderDependency,
  VariableLoc,
  ComponentInfoRender,
  ComponentFileVarHook,
  ComponentFileVarJSX,
  EffectInfo,
  TypeDataDeclareInterface,
  TypeDataDeclareType,
  ComponentFile,
  ComponentFileVarNormalFunction,
  ComponentFileVarNormalData,
  Memo,
  RefData,
  VariableName,
  VarKind,
  FunctionReturn,
  ComponentDBResolve,
  DistributiveOmit,
} from "@nexiq/shared";
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
  isCallHookVariable,
  isJSXVariable,
  isReactFunctionVariable,
} from "./variable/type.js";
import { HookVariable } from "./variable/hook.js";
import { FunctionVariable } from "./variable/functionVariable.js";
import { ClassVariable } from "./variable/classVariable.js";
import { getDeterministicId } from "../utils/hash.js";
import { getVariableNameKey } from "../analyzer/pattern.js";
import type { ReactFunctionVariable } from "./variable/reactFunctionVariable.js";
import { SqliteDB } from "./sqlite.js";

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
    this.sqlite = options.sqlite;
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
          id: getDeterministicId(fileName, nameKey),
          ...component,
          states: [],
          declarationKind,
        },
        file,
      ),
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
          children: {},
          states: [],
          declarationKind,
        },
        file,
      ),
    );
  }

  public addVariable(
    fileName: string,
    variable: DistributiveOmit<
      ComponentFileVar,
      "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
    >,
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
          id: getDeterministicId(fileName, nameKey),
          ...(variable as unknown as Omit<
            ComponentFileVarNormalFunction,
            | "id"
            | "kind"
            | "var"
            | "children"
            | "file"
            | "hash"
            | "components"
            | "type"
          >),
          children: {},
          declarationKind,
        },
        file,
      );
    } else if (variable.type === "class") {
      v = new ClassVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...(variable as unknown as Omit<
            ComponentFileVarNormalFunction,
            | "id"
            | "kind"
            | "var"
            | "children"
            | "file"
            | "hash"
            | "components"
            | "type"
          >),
          children: {},
          declarationKind,
        },
        file,
      );
    } else if (variable.type === "data") {
      assert(kind != null, "kind must be defined for data variable");

      v = new DataVariable(
        {
          id: getDeterministicId(fileName, nameKey),
          ...(variable as Omit<
            ComponentFileVarNormalData,
            "id" | "kind" | "var" | "children" | "file" | "hash"
          >),
          kind,
          declarationKind,
        },
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
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

    return component.addState(state);
  }

  public comAddCallHook(
    loc: VariableLoc,
    fileName: string,
    callHook: Parameters<ReactFunctionVariable["addCallHook"]>[0],
  ) {
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null || !isReactFunctionVariable(component))
      return "no-parent";

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
    if (component == null || !isReactFunctionVariable(component)) return;

    component.addHook(exportInfo.id);

    // Also add as a render so it's searchable as a usage
    this.comAddRender(
      fileName,
      hook,
      [],
      loc,
      "hook",
      this.getCurrentRenderInstance(),
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

    if (!srcId) {
      if (tag && tag[0] === tag[0]?.toLowerCase()) {
        srcId = tag;
      } else {
        if (this.isResolve) return "";

        this.addResolveTask({
          type: "comAddRender",
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
      srcId,
      instanceId,
      tag,
      dependency,
      isDependency,
      loc,
      kind,
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
        if (!render.isDependency && pId != null && !isTag) {
          this.edges.push({
            from: render.id,
            to: pId,
            label: "render",
          });
        }
        resolveRenders(render.children, pId);
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
          if (returnVar.srcId && !isTag) {
            this.edges.push({
              from: returnVar.srcId,
              to: variable.id,
              label: "render",
            });
          }
          resolveRenders(returnVar.children, variable.id);
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
          if (parent != null) {
            this.edges.push({
              from: parent,
              to: returnVar.id,
              label: "render",
            });
          }
        }
      }
    } else if (isJSXVariable(variable)) {
      if (parent != null) {
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
      src: path.resolve(this.dir),
      files: this.files.getData(),
      edges: this.getEdges(),
      resolve: this.resolveTasks,
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
        task.fileName,
        task.tag,
        task.dependency,
        task.loc,
        task.kind,
        task.parentId,
      );
    },
    comAddHook: (db, task) => {
      db.comAddHook(task.name, task.loc, task.fileName, task.hook);
    },
    comResolveCallHook: (db, task) => {
      const component = db.files.getHookInfoFromLoc(task.fileName, task.loc);
      if (component && isReactFunctionVariable(component)) {
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

      // debugger;
    }

    // this.resolveTasks = [];
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

  public getHookInfoFromLoc(fileName: string, loc: VariableLoc) {
    return this.files.getHookInfoFromLoc(fileName, loc);
  }
}
