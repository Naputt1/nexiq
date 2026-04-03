import type { ComponentFileVarHook } from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactFunctionVariable } from "./reactFunctionVariable.ts";

export class HookVariable extends ReactFunctionVariable<"hook"> {
  constructor(
    options: Omit<
      ComponentFileVarHook,
      "kind" | "var" | "components" | "hash" | "file"
    >,
    file: File,
  ) {
    super({ ...options, kind: "hook", type: "function" }, file);
  }

  public load(data: HookVariable) {
    super.load(data);
    this.kind = "hook";
  }

  public getData(): ComponentFileVarHook {
    return {
      ...super.getBaseData(),
    } as ComponentFileVarHook;
  }
}
