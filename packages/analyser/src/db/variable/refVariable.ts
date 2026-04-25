import type {
  ComponentFileVarRef,
  PropDataType,
  DBBatch,
  RefMetadata,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactVariable } from "./reactVariable.ts";

export class RefVariable extends ReactVariable<"data", "ref"> {
  defaultData: PropDataType;

  constructor(
    options: Omit<ComponentFileVarRef, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "ref", type: "data" }, file);

    this.defaultData = options.defaultData;
  }

  public load(data: Partial<ComponentFileVarRef>) {
    super.load(data);

    this.defaultData = data.defaultData || this.defaultData;
  }

  public getData(): ComponentFileVarRef {
    const data: ComponentFileVarRef = {
      ...super.getBaseData(),
      defaultData: this.defaultData,
    };

    return data;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      defaultData: this.defaultData,
    };
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify({
      defaultData: this.defaultData,
    } as RefMetadata);
    batch.entities.add(row);
  }
}
