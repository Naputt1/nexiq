import assert from "assert";
import type {
  ComponentFileImport,
  ComponentInfo,
  State,
  DataEdge,
  HookInfo,
} from "shared";
import { FileDB } from "./fileDB.js";
import { isHook } from "../utils.js";

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

export class ComponentDB {
  private components: Map<string, ComponentInfo>;
  private hooks: Map<string, HookInfo>;
  private edges: DataEdge[];
  private files: FileDB;
  private ids: Map<string, string>;
  private keys: Set<string>;

  private resolveTasks: ComponentDBResolve[];

  private isResolve = false;

  constructor() {
    this.components = new Map();
    this.hooks = new Map();
    this.edges = [];
    this.ids = new Map();
    this.keys = new Set();
    this.files = new FileDB();

    this.resolveTasks = [];
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

    const id = crypto.randomUUID();
    this.ids.set(key, id);

    this.components.set(id, {
      id,
      ...component,
    });
  }

  public addHook(hook: Omit<HookInfo, "id">) {
    const key = this.getFuncKey(hook.name, hook.file);
    if (this.keys.has(key)) {
      assert(false, "hook already exists");
      return;
    }

    const id = crypto.randomUUID();
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

    const component = isHook(fileName)
      ? this.hooks.get(id)
      : this.components.get(id);
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

    const component = this.components.get(id);
    assert(component != null, "Component not found");

    const srcId = this.ids.get(this.getFuncKey(hookImport.localName, fileName));

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
    assert(id != null, "Component not found");

    const component = this.components.get(id);
    assert(component != null, "Component not found");

    // rendere component is imported
    const comImport = this.files.getImport(fileName, tag);
    if (!comImport) {
      return;
    }

    const srcId = this.ids.get(this.getFuncKey(comImport.localName, fileName));

    if (srcId == null) {
      this.addResolveTask({
        type: "comAddRender",
        name,
        fileName,
        tag,
      });
      return;
    }

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

  public getData() {
    return {
      nodes: Object.fromEntries(this.components),
      edges: this.edges,
      files: this.files.getData(),
      ids: Object.fromEntries(this.ids),
      keys: Array.from(this.keys),
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
      }
    }
    this.isResolve = false;
  }
}
