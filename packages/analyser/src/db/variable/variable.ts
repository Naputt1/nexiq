import type {
  ComponentFileVar,
  ComponentFileVarBase,
  ComponentFileVarDependency,
  VariableLoc,
  VarKind,
  VarType,
} from "shared";
import type { File } from "../fileDB.js";

export abstract class Variable<
  TType extends VarType = VarType,
  TKind extends VarKind = VarKind,
> {
  id: string;
  name: string;
  file: File;
  type: TType;
  kind: ComponentFileVarBase<TType, TKind>["kind"];
  dependencies: Record<string, ComponentFileVarDependency>;
  parent?: Variable<"function">;
  loc: VariableLoc;

  constructor(
    {
      id,
      name,
      type,
      dependencies,
      kind,
      loc,
    }: ComponentFileVarBase<TType, TKind>,
    file: File,
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.kind = kind;
    this.dependencies = dependencies;
    this.loc = loc;

    this.file = file;
  }

  public load(data: Variable<TType>) {
    this.type = data.type;

    // TODO: handle merge
    this.dependencies = data.dependencies;

    this.loc = data.loc;
  }

  protected getBaseData(): ComponentFileVarBase<TType, TKind> {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      dependencies: this.dependencies,
      type: this.type,
      loc: this.loc,
    };
  }

  public abstract getData(): ComponentFileVar;
}
