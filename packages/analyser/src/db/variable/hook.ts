import type { ComponentFileVarHook } from "shared";
import { ReactVariable } from "./reactVariable.js";
import type { File } from "../fileDB.js";

export class HookVariable extends ReactVariable<"hook"> {
  constructor(
    options: Omit<ComponentFileVarHook, "kind" | "var" | "components">,
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
      kind: "hook",
    };
  }
}
