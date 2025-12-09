import type {
  ComponentFileVar,
  ComponentFileVarDependency,
  VariableLoc,
} from "shared";

export abstract class Variable {
  id: string;
  name: string;
  isComponent: boolean;
  dependencies: Record<string, ComponentFileVarDependency>;
  var: Map<string, Variable>;
  parent?: Variable;
  loc: VariableLoc;

  constructor(
    id: string,
    name: string,
    dependecies: Record<string, ComponentFileVarDependency>,
    isComponent: boolean,
    loc: VariableLoc
  ) {
    this.id = id;
    this.name = name;
    this.isComponent = isComponent;
    this.dependencies = dependecies;
    this.var = new Map();
    this.loc = loc;
  }

  public abstract getData(): ComponentFileVar;
}
