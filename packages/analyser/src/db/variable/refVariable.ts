import type { ComponentFileVarRef, PropDataType } from "shared";
import type { File } from "../fileDB.js";
import { ReactVariable } from "./reactVariable.js";

export class RefVariable extends ReactVariable<"data", "ref"> {
  defaultData: PropDataType;

  constructor(
    options: Omit<ComponentFileVarRef, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "ref", type: "data" }, file);

    this.defaultData = options.defaultData;
  }

  public load(data: RefVariable) {
    super.load(data);
  }

  public getData(): ComponentFileVarRef {
    const data: ComponentFileVarRef = {
      ...super.getBaseData(),
      defaultData: this.defaultData,
    };

    return data;
  }
}
