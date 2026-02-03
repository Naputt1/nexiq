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
  ui?: {
    x: number;
    y: number;
    renders?: Record<string, { x: number; y: number }>;
    isLayoutCalculated?: boolean | undefined;
  } | undefined;

  constructor(
    data: Omit<ComponentFileVarBase<TType, TKind>, "file">,
    file: File,
  ) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.kind = data.kind;
    this.dependencies = data.dependencies;
    this.loc = data.loc;
    this.ui = data.ui;

    this.file = file;
  }

  public load(data: Variable<TType>) {
    this.type = data.type;

    // TODO: handle merge
    this.dependencies = data.dependencies;

    this.loc = data.loc;
    if (data.ui) {
      this.ui = data.ui;
    }
  }

  protected getBaseData(): ComponentFileVarBase<TType, TKind> {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      type: this.type,
      file: this.file.path,
      dependencies: this.dependencies,
      loc: this.loc,
      ui: this.ui,
    };
  }

  public abstract getData(): ComponentFileVar;
}
