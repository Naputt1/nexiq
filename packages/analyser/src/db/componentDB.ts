import assert from "assert";
import type {
  ComponentFileImport,
  State,
  DataEdge,
  HookInfo,
  ComponentFileExport,
  JsonData,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentFileVarNormal,
  ComponentInfoRenderDependency,
  VariableLoc,
} from "shared";
import { FileDB } from "./fileDB.js";
import { isHook } from "../utils.js";
import type { PackageJson } from "./packageJson.js";
import fs from "fs";
import path from "path";
import { ComponentVariable } from "./variable/component.js";
import { DataVariable } from "./variable/dataVariable.js";
import type { Variable } from "./variable/variable.js";
import { isComponentVariable, isDataVariable } from "./variable/type.js";

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
};

type ComponentDBResolve = IResolveAddRender | IResolveAddHook;

export type ComponentDBOptions = {
  packageJson: PackageJson;
  viteAliases: Record<string, string>;
  dir: string;
};

export class ComponentDB {
  private hooks: Map<string, HookInfo>;
  private edges: DataEdge[];
  private files: FileDB;
  private ids: Map<string, string>;
  private keys: Set<string>;

  private resolveTasks: ComponentDBResolve[];

  private isResolve = false;

  private packageJson: PackageJson;
  private viteAliases: Record<string, string>;

  private dir: string;

  constructor(options: ComponentDBOptions) {
    this.hooks = new Map();
    this.edges = [];
    this.ids = new Map();
    this.keys = new Set();
    this.files = new FileDB();

    this.resolveTasks = [];

    this.packageJson = options.packageJson;
    this.viteAliases = options.viteAliases;

    this.dir = options.dir;
  }

  private getFuncKey(name: string, fileName: string): string {
    return `${name}@${fileName}`;
  }

  public addComponent(
    component: Omit<ComponentFileVarComponent, "id" | "isComponent">,
    parentPath?: string[]
  ) {
    const key = this.getFuncKey(component.name, component.file);
    if (this.keys.has(key)) {
      assert(false, "Component already exists");
      return;
    }

    const id = this.files.getComId(component.file, component.name);

    this.ids.set(key, id);

    this.files.addVariable(
      component.file,
      new ComponentVariable({
        id,
        ...component,
      }),
      parentPath
    );
  }

  public addVariable(
    filename: string,
    variable: Omit<
      ComponentFileVarNormal,
      "id" | "isComponent" | "var" | "components"
    >,
    parentPath?: string[]
  ) {
    this.files.addVariable(
      filename,
      new DataVariable({
        id: crypto.randomUUID(),
        ...variable,
      }),
      parentPath
    );
  }

  public addVariableDependency(
    filename: string,
    parent: string,
    variable: Omit<ComponentFileVarDependency, "id">
  ) {
    this.files.addVariableDependency(filename, parent, {
      id: crypto.randomUUID(),
      ...variable,
    });
  }

  public addHook(hook: Omit<HookInfo, "id">) {
    const key = this.getFuncKey(hook.name, hook.file);
    if (this.keys.has(key)) {
      assert(false, "hook already exists");
      return;
    }

    const hookImport = this.files.getImport(hook.file, hook.name);

    const id =
      hookImport?.type === "default"
        ? this.ids.get(this.getFuncKey("default", hook.file)) ??
          crypto.randomUUID()
        : crypto.randomUUID();

    this.ids.set(key, id);

    this.hooks.set(id, {
      id,
      ...hook,
    });
  }

  public comAddState(name: string, fileName: string, state: State) {
    const key = this.getFuncKey(name, fileName);
    const id = this.ids.get(key);
    if (id == null) {
      return;
      debugger;
    }
    assert(id != null, "Component not found");

    const component = isHook(name)
      ? this.hooks.get(id)
      : this.files.getComponent(fileName, id);
    assert(component != null, "Component not found");

    component.states.push(state);
  }

  public comAddHook(name: string, fileName: string, hook: string) {
    // ignore build-in hooks
    const hookImport = this.files.getImport(fileName, hook);
    if (hookImport) {
      if (hookImport.source === "react") {
        return;
      }
    } else {
      // TODO: hadnle local hooks
      return;
    }

    const key = this.getFuncKey(name, fileName);
    const id = this.ids.get(key);
    if (id == null) {
      debugger;
    }
    assert(id != null, "Component not found");

    const component = this.files.getComponent(fileName, id);
    assert(component != null, "Component not found");

    const srcId = this.ids.get(
      this.getFuncKey(hookImport.localName, hookImport.source)
    );

    if (srcId == null) {
      this.addResolveTask({
        type: "comAddHook",
        name,
        fileName,
        hook,
      });
      return;
    }

    component.hooks.push(srcId);
  }

  private getVariableID(name: string, fileName: string): string | null {
    const key = this.getFuncKey(name, fileName);
    const id = this.ids.get(key);
    if (id != null) {
      return id;
    }

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
    loc: VariableLoc
  ) {
    // rendere component is imported
    const comImport = this.files.getImport(fileName, tag);
    const isDependency = !comImport || this.isDependency(comImport.source);
    if (!comImport) {
      return;
    }

    let srcId: string | undefined;
    if (isDependency) {
      srcId = comImport.localName;
    } else {
      const srcKey = this.getFuncKey(
        comImport.type == "default" ? "default" : comImport.localName,
        comImport.source
      );
      srcId = this.ids.get(srcKey);
    }

    if (srcId == null) {
      if (this.isResolve) {
        debugger;
      }

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
      srcId,
      dependencry,
      isDependency,
      loc
    );
  }

  public addFile(file: string) {
    this.files.add(file);
  }

  public fileAddImport(fileName: string, fileImport: ComponentFileImport) {
    this.files.addImport(fileName, fileImport);
  }

  public fileAddExport(
    fileName: string,
    fileExport: Omit<ComponentFileExport, "id">
  ) {
    const key = this.getFuncKey(fileExport.name, fileName);
    const id = this.ids.get(key) ?? crypto.randomUUID();

    if (fileExport.type === "default") {
      this.ids.set(this.getFuncKey("default", fileName), id);
    }

    this.files.addExport(fileName, { id, ...fileExport });
  }

  private _resolveDependency(variable: Variable, parent?: string) {
    if (isComponentVariable(variable)) {
      for (const render of Object.values(variable.renders)) {
        if (render.isDependency) continue;

        this.edges.push({
          from: render.id,
          to: variable.id,
          label: "render",
        });
      }
    } else if (isDataVariable(variable)) {
      if (parent != null) {
        // for (const render of Object.values(variable.components)) {
        //   if (render.isDependency) continue;

        //   this.edges.push({
        //     from: parent,
        //     to: variable.id,
        //     label: "render",
        //   });
        // }

        for (const innerCom of variable.components.values()) {
          if (innerCom.isDependency) continue;

          this.edges.push({
            from: parent,
            to: innerCom.id,
            label: "render2",
          });
        }
      }
    }

    for (const innerVar of variable.var.values()) {
      this._resolveDependency(
        innerVar,
        variable.isComponent ? variable.id : parent
      );
    }
  }

  public resolveDependency() {
    for (const file of this.files.getFiles()) {
      for (const variable of file.var.values()) {
        this._resolveDependency(variable);
      }
    }
  }

  public getData(): JsonData {
    return {
      src: path.resolve(this.dir),
      files: this.files.getData(),
      edges: this.edges,
      ids: Object.fromEntries(this.ids),
      keys: Array.from(this.keys),
      // resolve: this.resolveTasks,
    };
  }

  private addResolveTask(resolve: ComponentDBResolve) {
    if (this.isResolve) {
      debugger;
      assert(!this.isResolve, "Resolve failed: comAddRender");
    }
    this.resolveTasks.push(resolve);
  }

  public resolve() {
    this.isResolve = true;
    for (const resolve of this.resolveTasks) {
      if (resolve.type === "comAddRender") {
        this.comAddRender(
          resolve.name,
          resolve.fileName,
          resolve.tag,
          resolve.dependencry,
          resolve.loc
        );
      } else if (resolve.type === "comAddHook") {
        this.comAddHook(resolve.name, resolve.fileName, resolve.hook);
      }
    }
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
            `./${source.slice(alias.length)}`
          );
          isAliase = true;
          break;
        } else if (source.startsWith(alias + "/")) {
          source = path.join(
            this.viteAliases[alias] ?? "",
            `./${source.slice(alias.length + 1)}`
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
