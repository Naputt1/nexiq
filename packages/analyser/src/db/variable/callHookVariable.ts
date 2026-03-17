import type { ComponentFileVarCallHook } from "@nexu/shared";
import type { File } from "../fileDB.js";
import { ReactVariable } from "./reactVariable.js";

export class CallHookVariable extends ReactVariable<"data", "hook"> {
  call: { id: string; name: string };

  constructor(
    options: Omit<ComponentFileVarCallHook, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "hook", type: "data" }, file);

    this.call = options.call;
  }

  public load(data: CallHookVariable) {
    super.load(data);

    this.kind = "hook";
  }

  public getData(): ComponentFileVarCallHook {
    return {
      ...super.getBaseData(),
      call: this.call,
    };
  }

  protected getDataInternal() {
    return {
      name: this.name,
      call: this.call,
    };
  }
}
