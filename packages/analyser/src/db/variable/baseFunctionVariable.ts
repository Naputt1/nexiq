import type {
  VariableScope,
  ComponentFileVarBaseTypeFunction,
  VarKind,
  FunctionReturn,
  ComponentInfoRender,
  VarType,
  DBBatch,
  FunctionMetadata,
} from "@nexiq/shared";
import { Variable } from "./variable.ts";
import type { File } from "../fileDB.ts";
import { Scope } from "./scope.ts";

export abstract class BaseFunctionVariable<
  TKind extends VarKind,
  TType extends VarType = VarType,
> extends Variable<TType, TKind> {
  var: Scope;
  scope: VariableScope;
  async?: boolean | undefined;
  return?: FunctionReturn | undefined;
  children: Record<string, ComponentInfoRender>;
  superClass?: { id?: string; name: string } | undefined;

  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<TKind, TType>,
      "var" | "components" | "file" | "hash"
    >,
    file: File,
  ) {
    super(options, file);
    this.var = new Scope();
    this.scope = options.scope;
    this.async = options.async;
    this.return = options.return;
    this.children = {};
    this.superClass = options.superClass;
  }

  public load(data: Partial<ComponentFileVarBaseTypeFunction<TKind, TType>>) {
    super.load(data);

    if (data.type !== undefined) this.type = data.type as TType;
    this.scope = data.scope ?? this.scope;
    if (data.async !== undefined) this.async = data.async;
    if (data.return !== undefined) this.return = data.return;
    this.superClass = data.superClass ?? this.superClass;
    this.var.merge(data.var);
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<TKind, TType> {
    return {
      ...super.getBaseData(),
      type: this.type,
      var: this.var.getData(),
      scope: this.scope,
      async: this.async,
      return: this.return,
      superClass: this.superClass,
    };
  }

  protected getMetadata(): FunctionMetadata {
    return {
      params: [], // Params are usually collected elsewhere or could be added here
      ...(this.async !== undefined ? { async: this.async } : {}),
    };
  }

  protected getDataInternal() {
    return {
      var: this.var.getData(),
      scope: this.scope,
      async: this.async,
      return: this.return,
      superClass: this.superClass,
    };
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify(this.getMetadata());
    batch.entities.add(row);

    const innerScopeId = `scope:block:${this.id}`;
    batch.scopes.add({
      id: innerScopeId,
      file_id: 0, // Will be updated by SqliteDB
      parent_id: scopeId,
      kind: "function",
      entity_id: this.id,
      data_json: JSON.stringify(this.scope),
    });

    this.var.toDBRow(batch, innerScopeId, scopeId);
  }
}
