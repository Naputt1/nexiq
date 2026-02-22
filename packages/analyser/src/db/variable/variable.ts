import type {
  ComponentFileVar,
  ComponentFileVarBase,
  ComponentFileVarDependency,
  VariableLoc,
  VariableName,
  VarKind,
  VarType,
  UIItemState,
} from "shared";
import type { File } from "../fileDB.js";
import { getDeterministicId } from "../../utils/hash.js";

export abstract class Variable<
  TType extends VarType = VarType,
  TKind extends VarKind = VarKind,
> {
  id: string;
  name: VariableName;
  file: File;
  type: TType;
  kind: ComponentFileVarBase<TType, TKind>["kind"];
  parentId?: string | undefined;
  declarationKind?:
    | "const"
    | "let"
    | "var"
    | "using"
    | "await using"
    | undefined
    | "using"
    | "await using";
  dependencies: Record<string, ComponentFileVarDependency>;
  parent?: Variable<"function">;
  loc: VariableLoc;
  ui?:
    | (UIItemState & {
        children?: Record<string, UIItemState>;
        vars?: Record<string, UIItemState>;
      })
    | undefined;

  constructor(
    data: Omit<ComponentFileVarBase<TType, TKind>, "file" | "hash">,
    file: File,
  ) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.kind = data.kind;
    this.parentId = data.parentId;
    this.declarationKind = data.declarationKind;
    this.dependencies = data.dependencies;
    this.loc = data.loc;
    this.ui = data.ui;

    this.file = file;
  }

  public load(data: Variable<TType>) {
    this.type = data.type;
    this.declarationKind = data.declarationKind;

    // TODO: handle merge
    this.dependencies = data.dependencies;

    this.loc = data.loc;
    if (data.ui) {
      this.ui = data.ui;
    }
  }

  protected getBaseData(): ComponentFileVarBase<TType, TKind> {
    const data = this.getDataInternal();
    const hash = getDeterministicId(JSON.stringify(data));

    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      type: this.type,
      file: this.file.path,
      hash,
      parentId: this.parentId,
      declarationKind: this.declarationKind,
      dependencies: this.dependencies,
      loc: this.loc,
      ui: this.ui,
    };
  }

  protected abstract getDataInternal(): unknown;

  public abstract getData(): ComponentFileVar;
}
