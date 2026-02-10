import type { ComponentFileVarState } from "shared";
import type { File } from "../fileDB.js";
import { ReactVariable } from "./reactVariable.js";

export class StateVariable extends ReactVariable<"data", "state"> {
  setter: string | undefined;

  constructor(
    options: Omit<ComponentFileVarState, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "state", type: "data" }, file);

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
    };

    if (this.setter) {
      data.setter = this.setter;
    }

    return data;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      setter: this.setter,
    };
  }
}
