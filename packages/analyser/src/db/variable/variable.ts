import type {
  ComponentFileVar,
  ComponentFileVarBase,
  ComponentFileVarDependency,
  VariableLoc,
  VariableName,
  VarKind,
  VarType,
  UIItemState,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { getDeterministicId } from "../../utils/hash.ts";
import { Scope } from "./scope.ts";

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
    | undefined;
  dependencies: Record<string, ComponentFileVarDependency>;
  parent?: Scope;
  loc: VariableLoc;
  isStatic?: boolean | undefined;
  memberKind?: string | undefined;
  ui?:
    | (UIItemState & {
        renders?: Record<string, UIItemState>;
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
    this.isStatic = data.isStatic;
    this.memberKind = data.memberKind;

    this.file = file;
  }

  public load(data: Variable<TType>) {
    this.type = data.type;
    this.declarationKind = data.declarationKind;
    this.isStatic = data.isStatic;
    this.memberKind = data.memberKind;

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
      isStatic: this.isStatic,
      memberKind: this.memberKind,
    };
  }

  protected abstract getDataInternal(): unknown;

  public abstract getData(): ComponentFileVar;
}
