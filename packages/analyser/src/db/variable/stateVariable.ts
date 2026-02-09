import type { ComponentFileVarState } from "shared";
import type { File } from "../fileDB.js";
import { ReactVariable } from "./reactVariable.js";

export class StateVariable extends ReactVariable<"data", "state"> {
  value: string;
  setter: string | undefined;

  constructor(
    options: Omit<ComponentFileVarState, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "state", type: "data" }, file);

    this.value = options.value;
    this.setter = options.setter;
  }

  public load(data: StateVariable) {
    super.load(data);

    this.kind = "state";
  }

  public getData(): ComponentFileVarState {
    const data: ComponentFileVarState = {
      ...super.getBaseData(),
      kind: "state",
      value: this.value,
    };

    if (this.setter) {
      data.setter = this.setter;
    }

    return data;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      value: this.value,
      setter: this.setter,
    };
  }
}
