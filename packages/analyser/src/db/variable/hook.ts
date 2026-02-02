import type { ComponentFileVarHook } from "shared";
import { ReactVariable } from "./reactVariable.js";
import type { File } from "../fileDB.js";

export class HookVariable extends ReactVariable {
  constructor(
    options: Omit<ComponentFileVarHook, "variableType" | "var" | "components">,
    file: File,
  ) {
    super({ ...options, variableType: "hook" }, file);
  }

  public load(data: HookVariable) {
    super.load(data);

    this.variableType = "hook";
  }

  public getData(): ComponentFileVarHook {
    return {
      ...super.getBaseData(),
      variableType: "hook",
    };
  }
}
