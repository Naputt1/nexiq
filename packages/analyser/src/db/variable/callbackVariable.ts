import type { MemoFileVarHook } from "shared";
import type { File } from "../fileDB.js";
import { ReactWithCallbackVariable } from "./reactWithCallbackVariable.js";

export class CallbackVariable extends ReactWithCallbackVariable<"memo"> {
  constructor(
    options: Omit<MemoFileVarHook, "kind" | "var" | "components" | "type">,
    file: File,
  ) {
    super(
      {
        ...options,
        kind: "memo",
      },
      file,
    );
  }

  public load(data: CallbackVariable) {
    super.load(data);

    // TODO: handle merge
  }

  public getData(): MemoFileVarHook {
    return {
      ...this.getBaseData(),
    };
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      reactDeps: this.reactDeps,
    };
  }
}
