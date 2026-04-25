import type {
  ComponentFileVar,
  ComponentFileVarBase,
  ComponentFileVarDependency,
  VariableLoc,
  VariableName,
  VarKind,
  VarType,
  DBBatch,
  EntityRow,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { getDeterministicId } from "../../utils/hash.ts";
import { Scope } from "./scope.ts";
import { getVariableNameKey } from "../../analyzer/pattern.ts";

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
  parent?: Variable | Scope;
  loc: VariableLoc;
  scopeId?: string | undefined;
  isStatic?: boolean | undefined;
  memberKind?: string | undefined;

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
    this.scopeId = data.scopeId;
    this.isStatic = data.isStatic;
    this.memberKind = data.memberKind;

    this.file = file;
  }

  public load(data: Partial<ComponentFileVarBase<TType, TKind>>) {
    this.type = (data.type as TType) ?? this.type;
    this.declarationKind = data.declarationKind ?? this.declarationKind;
    this.isStatic = data.isStatic ?? this.isStatic;
    this.memberKind = data.memberKind ?? this.memberKind;

    // TODO: handle merge
    this.dependencies = data.dependencies ?? this.dependencies;

    this.loc = data.loc ?? this.loc;
    this.scopeId = data.scopeId ?? this.scopeId;
  }

  /**
   * Merge state from another Variable of the same kind.
   * Used by Scope when deduplicating variables across threads.
   */
  public merge(other: Variable<TType, TKind>) {
    this.type = other.type ?? this.type;
    this.declarationKind = other.declarationKind ?? this.declarationKind;
    this.isStatic = other.isStatic ?? this.isStatic;
    this.memberKind = other.memberKind ?? this.memberKind;
    this.dependencies = other.dependencies ?? this.dependencies;
    this.loc = other.loc ?? this.loc;
    this.scopeId = other.scopeId ?? this.scopeId;
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
      scopeId: this.scopeId,
      isStatic: this.isStatic,
      memberKind: this.memberKind,
    };
  }

  protected abstract getDataInternal(): unknown;

  public abstract getData(): ComponentFileVar;

  public abstract toDBRow(batch: DBBatch, scopeId: string): void;

  protected getBaseRow(scopeId: string): EntityRow {
    return {
      id: this.id,
      scope_id: scopeId,
      kind: this.kind,
      name: getVariableNameKey(this.name),
      type: this.type,
      line: this.loc.line,
      column: this.loc.column,
      end_line: null,
      end_column: null,
      declaration_kind: this.declarationKind ?? null,
      data_json: null,
    };
  }
}
