import type { ComponentFileVar } from "shared";
import type { Variable } from "./variable.js";
import { isBaseFunctionVariable } from "./type.js";

export class Scope {
  private variables = new Map<string, Variable>();
  private nameToVariable = new Map<string, Variable>();
  private prevIds = new Map<string, string>();

  constructor(
    public parent?: Scope,
    public owner?: Variable,
  ) {}

  public initPrevIds(vars: Record<string, ComponentFileVar>) {
    for (const v of Object.values(vars)) {
      if (v.name && v.id) {
        this.prevIds.set(v.name, v.id);
      }
    }
  }

  public getPrevId(name: string): string | undefined {
    return this.prevIds.get(name);
  }

  public add(v: Variable) {
    this.variables.set(v.id, v);
    this.nameToVariable.set(v.name, v);
    if (this.owner && isBaseFunctionVariable(this.owner)) {
      v.parent = this.owner;
    }
    if (isBaseFunctionVariable(v)) {
      v.var.parent = this;
      v.var.owner = v;
    }
  }

  public get(id: string, recursive = false): Variable | undefined {
    let v = this.variables.get(id);
    if (v) return v;
    if (recursive) {
      for (const value of this.variables.values()) {
        if (isBaseFunctionVariable(value)) {
          v = value.var.get(id, true);
          if (v) return v;
        }
      }
    }
    return undefined;
  }

  public getByName(name: string): Variable | undefined {
    return this.nameToVariable.get(name);
  }

  public getByPath(path: string[]): Scope | undefined {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Scope = this;
    for (let i = path.length - 1; i >= 0; i--) {
      const v = current.getByName(path[i]!);
      if (v && isBaseFunctionVariable(v)) {
        current = v.var;
      } else {
        return undefined;
      }
    }
    return current;
  }

  public values() {
    return this.variables.values();
  }

  public getData(): Record<string, ComponentFileVar> {
    const data: Record<string, ComponentFileVar> = {};
    for (const [id, v] of this.variables) {
      data[id] = v.getData();
    }
    return data;
  }
}
