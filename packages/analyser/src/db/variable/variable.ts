import type {
  ComponentFileVar,
  ComponentFileVarBase,
  ComponentFileVarDependency,
  VariableLoc,
} from "shared";
import type { File } from "../fileDB.js";

export abstract class Variable {
  id: string;
  name: string;
  file: File;
  type: ComponentFileVarBase["type"];
  variableType: ComponentFileVarBase["variableType"];
  dependencies: Record<string, ComponentFileVarDependency>;
  parent?: Variable;
  loc: VariableLoc;

  constructor(
    { id, name, type, dependencies, variableType, loc }: ComponentFileVarBase,
    file: File
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.variableType = variableType;
    this.dependencies = dependencies;
    this.loc = loc;

    this.file = file;
  }

  public load(data: Variable) {
    this.type = data.type;

    // TODO: handle merge
    this.dependencies = data.dependencies;

    this.loc = data.loc;
  }

  protected getBaseData(): ComponentFileVarBase {
    return {
      id: this.id,
      name: this.name,
      variableType: this.variableType,
      dependencies: this.dependencies,
      type: "data",
      loc: this.loc,
    };
  }

  public abstract getData(): ComponentFileVar;
}
