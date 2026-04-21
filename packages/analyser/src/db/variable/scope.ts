import type {
  ComponentFileVar,
  VariableLoc,
  VariableScope,
  VarKind,
} from "@nexiq/shared";
import type { Variable } from "./variable.ts";
import { isBaseFunctionVariable, isClassVariable } from "./type.ts";
import {
  getVariableNameKey,
  getPatternIdentifiers,
} from "../../analyzer/pattern.ts";
import type { BaseFunctionVariable } from "./baseFunctionVariable.ts";

export class Scope {
  private variables = new Map<string, Variable>();
  private nameToVariable = new Map<string, Variable>();
  private nameToId = new Map<string, string>();
  private prevIds = new Map<string, string>();

  type = "scope";

  constructor(
    public parent?: Scope,
    public owner?: Variable,
  ) {}

  public static isLocInScope(loc: VariableLoc, scope: VariableScope): boolean {
    if (loc.line < scope.start.line || loc.line > scope.end.line) return false;
    if (loc.line === scope.start.line && loc.column < scope.start.column)
      return false;
    if (loc.line === scope.end.line && loc.column > scope.end.column)
      return false;
    return true;
  }

  public findDeepestScope(loc: VariableLoc): Scope {
    for (const v of this.variables.values()) {
      if (isBaseFunctionVariable(v) || isClassVariable(v)) {
        if (v.scope && Scope.isLocInScope(loc, v.scope)) {
          return v.var.findDeepestScope(loc);
        }
      }
    }
    return this;
  }

  public findDeepestVariable(
    loc: VariableLoc,
  ): BaseFunctionVariable<VarKind> | undefined {
    for (const v of this.variables.values()) {
      if (isBaseFunctionVariable(v)) {
        if (v.scope && Scope.isLocInScope(loc, v.scope)) {
          const inner = v.var.findDeepestVariable(loc);
          if (inner) return inner;

          return v;
        }
      } else if (isClassVariable(v)) {
        if (v.scope && Scope.isLocInScope(loc, v.scope)) {
          const inner = v.var.findDeepestVariable(loc);
          if (inner) return inner;

          return v as BaseFunctionVariable<VarKind>;
        }
      }
    }

    return undefined;
  }

  public initPrevIds(vars: Record<string, ComponentFileVar>) {
    for (const v of Object.values(vars || {})) {
      if (v.name && v.id) {
        const nameKey = getVariableNameKey(v.name);
        this.prevIds.set(nameKey, v.id);
      }
    }
  }

  public getPrevId(name: string): string | undefined {
    return this.prevIds.get(name);
  }

  public add(v: Variable) {
    this.variables.set(v.id, v);
    const nameKey = getVariableNameKey(v.name);
    this.nameToVariable.set(nameKey, v);
    this.nameToId.set(nameKey, v.id);

    // Register all identifiers in the pattern
    // We want identifiers to point to their specific nested IDs anchored to the variable ID
    const identifiers = getPatternIdentifiers(v.name, v.id);

    for (const id of identifiers) {
      this.nameToVariable.set(id.name, v);
      this.nameToId.set(id.name, id.id);
    }

    if (
      this.owner &&
      (isBaseFunctionVariable(this.owner) || isClassVariable(this.owner))
    ) {
      v.parent = this.owner as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    if (isBaseFunctionVariable(v) || isClassVariable(v)) {
      if (v.var) {
        v.var.parent = this;
        v.var.owner = v;
      }
    }
  }

  public get(id: string, recursive = false): Variable | undefined {
    let v = this.variables.get(id);
    if (v) return v;
    if (recursive) {
      for (const value of this.variables.values()) {
        if (
          (isBaseFunctionVariable(value) || isClassVariable(value)) &&
          value.var
        ) {
          v = value.var.get(id, true);
          if (v) return v;
        }
      }
    }
    return undefined;
  }

  public getByName(name: string): Variable | undefined {
    const v = this.nameToVariable.get(name);
    if (v) return v;
    return this.parent?.getByName(name);
  }

  public getIdByName(name: string): string | undefined {
    const id = this.nameToId.get(name);
    if (id) return id;
    return this.parent?.getIdByName(name);
  }

  public merge(other?: Scope | Record<string, ComponentFileVar>) {
    if (!other) return;

    if (!(other instanceof Scope)) {
      for (const variable of Object.values(other)) {
        const existing = this.variables.get(variable.id);
        if (existing) {
          continue;
        }

        this.prevIds.set(getVariableNameKey(variable.name), variable.id);
      }
      return;
    }

    for (const [id, v] of other.variables) {
      if (!this.variables.has(id)) {
        this.variables.set(id, v);
        v.parent = this;
      } else {
        const existing = this.variables.get(id)!;
        existing.load(v);
      }
    }
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
