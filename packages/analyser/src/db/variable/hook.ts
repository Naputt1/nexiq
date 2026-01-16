import type { ComponentFileVarHook } from "shared";
import { ReactVariable } from "./reactVariable.js";

export class HookVariable extends ReactVariable {
  constructor(
    options: Omit<ComponentFileVarHook, "variableType" | "var" | "components">
  ) {
    super({ ...options, variableType: "hook" } as ComponentFileVarHook);
  }

  public load(data: HookVariable) {
    super.load(data);

    this.variableType = "hook";
  }

  public getData(): ComponentFileVarHook {
    return {
      ...super.getReactVariable(),
      variableType: "hook",
    };
  }
}
