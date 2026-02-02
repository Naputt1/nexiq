import type { ComponentFileVarHook } from "shared";
import type { File } from "../fileDB.js";
import { ReactFunctionVariable } from "./reactFunctionVariable.js";

export class HookVariable extends ReactFunctionVariable<"hook"> {
  constructor(
    options: Omit<
      ComponentFileVarHook,
      "kind" | "var" | "components" | "states"
    >,
    file: File,
  ) {
    super({ ...options, kind: "hook" }, file);
  }

  public load(data: HookVariable) {
    super.load(data);

    this.kind = "hook";
  }

  public getData(): ComponentFileVarHook {
    return {
      ...super.getBaseData(),
    };
  }
}
