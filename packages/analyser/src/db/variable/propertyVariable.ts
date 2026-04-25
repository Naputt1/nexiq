import type {
  ComponentFileVarBase,
  ComponentFileVarProperty,
  DBBatch,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { Variable } from "./variable.ts";

export class PropertyVariable extends Variable<"data", "property"> {
  constructor(
    options: Omit<ComponentFileVarProperty, "kind" | "type" | "file" | "hash">,
    file: File,
  ) {
    super(
      { ...options, kind: "property", type: "data" } as Omit<
        ComponentFileVarBase<"data", "property">,
        "file" | "hash"
      >,
      file,
    );
  }

  public load(data: Partial<ComponentFileVarProperty>) {
    super.load(data);
  }

  protected getDataInternal() {
    return {
      name: this.name,
    };
  }

  public getData(): ComponentFileVarProperty {
    return this.getBaseData();
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify({});
    batch.entities.add(row);
  }
}
