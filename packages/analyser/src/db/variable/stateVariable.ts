import type {
  ComponentFileVarState,
  TypeData,
  DBBatch,
  StateMetadata,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactVariable } from "./reactVariable.ts";

export class StateVariable extends ReactVariable<"data", "state"> {
  setter: string | undefined;
  stateType: TypeData | undefined;

  constructor(
    options: Omit<ComponentFileVarState, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "state", type: "data" }, file);

    this.setter = options.setter;
    this.stateType = options.stateType;
  }

  public load(data: Partial<ComponentFileVarState>) {
    super.load(data);

    this.setter = data.setter || this.setter;
    this.stateType = data.stateType || this.stateType;
    this.kind = "state";
  }

  public getData(): ComponentFileVarState {
    const data: ComponentFileVarState = {
      ...super.getBaseData(),
      kind: "state",
    };

    if (this.setter) {
      data.setter = this.setter;
    }

    if (this.stateType) {
      data.stateType = this.stateType;
    }

    return data;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      setter: this.setter,
      stateType: this.stateType,
    };
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify({
      setter: this.setter,
      stateType: this.stateType,
    } as StateMetadata);
    batch.entities.add(row);
  }
}
