import type { ComponentFileVar, ComponentFileVarDependency } from "shared";

export abstract class Variable {
  id: string;
  name: string;
  isComponent: boolean;
  dependencies: Record<string, ComponentFileVarDependency>;
  var: Map<string, Variable>;
  parent?: Variable;

  constructor(
    id: string,
    name: string,
    dependecies: Record<string, ComponentFileVarDependency>,
    isComponent: boolean
  ) {
    this.id = id;
    this.name = name;
    this.isComponent = isComponent;
    this.dependencies = dependecies;
    this.var = new Map();
  }

  public abstract getData(): ComponentFileVar;
}
