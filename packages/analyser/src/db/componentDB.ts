import assert from "assert";
import type {
  ComponentFileImport,
  ComponentInfo,
  State,
  DataEdge,
  HookInfo,
  ComponentFileExport,
  JsonData,
} from "shared";
import { FileDB } from "./fileDB.js";
import { isHook } from "../utils.js";
import type { PackageJson } from "./packageJson.js";
import fs from "fs";
import path from "path";

type IResolveAddRender = {
  type: "comAddRender";
  name: string;
  fileName: string;
  tag: string;
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

  public addComponent(component: Omit<ComponentInfo, "id">) {
    const key = this.getFuncKey(component.name, component.file);
    if (this.keys.has(key)) {
      assert(false, "Component already exists");
      return;
    }

    const id = this.files.getComId(component.file, component.name);

    this.ids.set(key, id);

    this.files.addVariable(component.file, {
      id,
      isComponent: true,
      ...component,
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
      // ignore local hooks
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

  public comAddRender(name: string, fileName: string, tag: string) {
    const key = this.getFuncKey(name, fileName);
    const id = this.ids.get(key);
    if (id == null) {
      debugger;
    }

    assert(id != null, "Component not found");

    const component = this.files.getComponent(fileName, id);
    assert(component != null, "Component not found");

    // rendere component is imported
    const comImport = this.files.getImport(fileName, tag);
    if (!comImport || this.isDependency(comImport.source)) {
      return;
    }

    const srcKey = this.getFuncKey(
      comImport.type == "default" ? "default" : comImport.localName,
      comImport.source
    );
    const srcId = this.ids.get(srcKey);

    if (srcId == null) {
      if (this.isResolve) {
        debugger;
      }

      this.addResolveTask({
        type: "comAddRender",
        name,
        fileName,
        tag,
      });
      return;
    }

    if (component.renders.includes(srcId)) return;

    component.renders.push(srcId);
    this.edges.push({
      from: id,
      to: srcId,
      label: "renders",
    });
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

  public fileSetDefaultExport(fileName: string, exportVal?: string | null) {
    if (exportVal) {
      const key = this.getFuncKey(exportVal, fileName);
      const id = this.ids.get(key) ?? crypto.randomUUID();

      this.ids.set(this.getFuncKey("default", fileName), id);
    }

    this.files.setDefaultExport(fileName, exportVal);
  }

  public getData(): JsonData {
    return {
      src: path.resolve(this.dir),
      edges: this.edges,
      files: this.files.getData(),
      ids: Object.fromEntries(this.ids),
      keys: Array.from(this.keys),
      resolve: this.resolveTasks,
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
        this.comAddRender(resolve.name, resolve.fileName, resolve.tag);
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
