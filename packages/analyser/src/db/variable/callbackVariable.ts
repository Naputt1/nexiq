import type { ComponentFileVarCallback } from "shared";
import type { File } from "../fileDB.js";
import { ReactWithCallbackVariable } from "./reactWithCallbackVariable.js";

export class CallbackVariable extends ReactWithCallbackVariable<"callback"> {
  constructor(
    options: Omit<
      ComponentFileVarCallback,
      "kind" | "var" | "components" | "type" | "file"
    >,
    file: File,
  ) {
    super(
      {
        ...options,
        kind: "callback",
      },
      file,
    );
  }

  public load(data: CallbackVariable) {
    super.load(data);

    // TODO: handle merge
  }

  public getData(): ComponentFileVarCallback {
    return {
      ...this.getBaseData(),
    } as ComponentFileVarCallback;
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      reactDeps: this.reactDeps,
    };
  }
}
