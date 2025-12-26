import assert from "assert";
import type {
  ComponentFileVar,
  ComponentFileVarBase,
  ComponentFileVarDependency,
  VariableScope,
  VariableLoc,
} from "shared";

export abstract class Variable {
  id: string;
  name: string;
  type: ComponentFileVar["type"];
  isComponent: boolean;
  dependencies: Record<string, ComponentFileVarDependency>;
  var: Map<string, Variable>;
  parent?: Variable;
  loc: VariableLoc;
  scope?: VariableScope;

  constructor(
    id: string,
    name: string,
    type: ComponentFileVar["type"],
    dependecies: Record<string, ComponentFileVarDependency>,
    isComponent: boolean,
    loc: VariableLoc,
    scope?: VariableScope
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.isComponent = isComponent;
    this.dependencies = dependecies;
    this.var = new Map();
    this.loc = loc;
    if (scope) this.scope = scope;
  }

  protected getBaseData(): ComponentFileVarBase {
    if (this.type === "function") {
      if (this.scope == null) {
        debugger;
      }
      assert(this.scope, "Function variable must have scope defined");

      return {
        id: this.id,
        name: this.name,
        isComponent: this.isComponent,
        dependencies: this.dependencies,
        var: Object.fromEntries(
          Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
            k,
            value.getData(),
          ])
        ),
        type: this.type,
        loc: this.loc,
        scope: this.scope,
      };
    }

    return {
      id: this.id,
      name: this.name,
      isComponent: this.isComponent,
      dependencies: this.dependencies,
      var: Object.fromEntries(
        Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
          k,
          value.getData(),
        ])
      ),
      type: "data",
      loc: this.loc,
    };
  }

  public abstract getData(): ComponentFileVar;
}
