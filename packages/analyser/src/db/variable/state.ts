import type { ComponentFileVarState } from "shared";
import type { File } from "../fileDB.js";
import { Variable } from "./variable.js";

export class StateVariable extends Variable<"data", "state"> {
  value: string;
  setter: string | undefined;

  constructor(
    options: Omit<
      ComponentFileVarState,
      "kind" | "var" | "components" | "file" | "type"
    >,
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
}
