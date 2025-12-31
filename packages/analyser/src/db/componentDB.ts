import assert from "assert";
import type {
  ComponentFileImport,
  State,
  DataEdge,
  ComponentFileExport,
  JsonData,
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  ComponentFileVarNormal,
  ComponentInfoRenderDependency,
  VariableLoc,
  ComponentFileVarHook,
  EffectInfo,
  TypeDataDeclare,
} from "shared";
import { FileDB } from "./fileDB.js";
import type { PackageJson } from "./packageJson.js";
import fs from "fs";
import path from "path";
import { ComponentVariable } from "./variable/component.js";
import { DataVariable } from "./variable/dataVariable.js";
import type { Variable } from "./variable/variable.js";
import { isComponentVariable, isDataVariable } from "./variable/type.js";
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

type ComponentDBResolve = IResolveAddRender | IResolveAddHook;

export type ComponentDBOptions = {
  packageJson: PackageJson;
  viteAliases: Record<string, string>;
  dir: string;
};

export class ComponentDB {
  private edges: DataEdge[];
  private files: FileDB;

  private resolveTasks: ComponentDBResolve[];

  private isResolve = false;

  private packageJson: PackageJson;
  private viteAliases: Record<string, string>;

  private dir: string;

  constructor(options: ComponentDBOptions) {
    this.edges = [];
    this.files = new FileDB();

    this.resolveTasks = [];

    this.packageJson = options.packageJson;
    this.viteAliases = options.viteAliases;

    this.dir = options.dir;
  }

  public addComponent(
    component: Omit<ComponentFileVarComponent, "id" | "variableType">,
    parentPath?: string[]
  ) {
    this.files.addVariable(
      component.file,
      new ComponentVariable({
        id: newUUID(),
        ...component,
      }),
      parentPath
    );
  }

  public addHook(
    variable: Omit<
      ComponentFileVarHook,
      "id" | "variableType" | "var" | "components"
    >,
    parentPath?: string[]
  ) {
    this.files.addVariable(
      variable.file,
      new HookVariable({
        id: newUUID(),
        ...variable,
      }),
      parentPath
    );
  }

  public addVariable(
    filename: string,
    variable: Omit<
      ComponentFileVarNormal,
      "id" | "variableType" | "var" | "components"
    >,
    parentPath?: string[]
  ) {
    this.files.addVariable(
      filename,
      new DataVariable({
        id: newUUID(),
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
      id: newUUID(),
      ...variable,
    });
  }

  public comAddState(
    name: string,
    loc: VariableLoc,
    fileName: string,
    state: Omit<State, "id">
  ) {
    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null) debugger;
    assert(component != null, "Component not found");

    const id = newUUID();
    component.states[id] = {
      id,
      ...state,
    };
  }

  public comAddHook(
    name: string,
    loc: VariableLoc,
    fileName: string,
    hook: string
  ) {
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

    const component = this.files.getHookInfoFromLoc(fileName, loc);

    if (component == null) debugger;
    assert(component != null, "Component not found");

    let srcId: string | undefined;
    if (this.isDependency(hookImport.source)) {
      srcId = hookImport.localName;
    } else {
      if (this.files.has(hookImport.source)) {
        const file = this.files.get(hookImport.source);
        assert(file != null, "File not found");

        srcId = file.getExport(hookImport);

        if (this.isResolve && srcId == null) {
          debugger;
        }
      }
    }

    if (srcId == null) {
      if (this.isResolve) {
        debugger;
      }

      this.addResolveTask({
        type: "comAddHook",
        name,
        fileName,
        hook,
        loc,
      });
      return;
    }

    component.hooks.push(srcId);
  }

  public comAddEffect(
    fileName: string,
    loc: VariableLoc,
    effect: Omit<EffectInfo, "id">
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
      if (this.files.has(comImport.source)) {
        const file = this.files.get(comImport.source);
        assert(file != null, "File not found");

        srcId = file.getExport(comImport);

        if (srcId == null && this.isResolve) {
          debugger;
        }
      }
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
    this.files.addExport(fileName, fileExport);
  }

  public fileAddTsTypes(fileName: string, type: Omit<TypeDataDeclare, "id">) {
    this.files.addTsTypes(fileName, type);
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
        variable.variableType == "component" ? variable.id : parent
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
      // resolve: this.resolveTasks,
    };
  }

  private addResolveTask(resolve: ComponentDBResolve) {
    this.resolveTasks.push(resolve);
  }

  public resolve() {
    this.isResolve = true;
    let i = 0;
    const maxRetries = this.resolveTasks.length * 2 + 10;
    let retries = 0;

    while (i < this.resolveTasks.length && retries < maxRetries) {
      const resolve = this.resolveTasks[i]!;
      i++;
      const currentTaskCount = this.resolveTasks.length;

      if (resolve.type === "comAddRender") {
        this.comAddRender(
          resolve.name,
          resolve.fileName,
          resolve.tag,
          resolve.dependencry,
          resolve.loc
        );
      } else if (resolve.type === "comAddHook") {
        this.comAddHook(
          resolve.name,
          resolve.loc,
          resolve.fileName,
          resolve.hook
        );
      }

      if (this.resolveTasks.length > currentTaskCount) {
        retries++;
      }
    }

    if (retries >= 1000) {
      console.warn(
        "Resolution interrupted: suspected infinite loop in ComponentDB.resolve"
      );
    }

    this.files.resolve();

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
