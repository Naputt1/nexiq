import type {
  ComponentFileVarBase,
  ComponentFileVarClass,
  VariableScope,
  DBBatch,
  ClassMetadata,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { Variable } from "./variable.ts";
import { Scope } from "./scope.ts";

export class ClassVariable extends Variable<"data", "class"> {
  public var: Scope;
  public scope: VariableScope;
  public superClass?: { id?: string; name: string } | undefined;

  constructor(
    options: Omit<
      ComponentFileVarClass,
      "var" | "type" | "kind" | "file" | "hash"
    >,
    file: File,
  ) {
    super(
      { ...options, kind: "class", type: "data" } as Omit<
        ComponentFileVarBase<"data", "class">,
        "file" | "hash"
      >,
      file,
    );
    this.var = new Scope();
    this.scope = options.scope;
    this.superClass = options.superClass;
  }

  public load(data: Partial<ComponentFileVarClass>) {
    super.load(data);

    this.scope = data.scope || this.scope;
    this.superClass = data.superClass || this.superClass;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      var: this.var.getData(),
      scope: this.scope,
      superClass: this.superClass,
    };
  }

  protected getBaseData(): ComponentFileVarClass {
    return {
      ...super.getBaseData(),
      kind: "class",
      type: "data",
      var: this.var.getData(),
      scope: this.scope,
      superClass: this.superClass,
    };
  }

  public getData(): ComponentFileVarClass {
    return this.getBaseData();
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify({
      superClass: this.superClass,
    } as ClassMetadata);
    batch.entities.add(row);

    const innerScopeId = `scope:block:${this.id}`;
    batch.scopes.add({
      id: innerScopeId,
      file_id: 0,
      parent_id: scopeId,
      kind: "class",
      entity_id: this.id,
      data_json: JSON.stringify(this.scope),
    });

    this.var.toDBRow(batch, innerScopeId, scopeId);
  }
}
