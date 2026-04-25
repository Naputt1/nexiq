import type { ComponentFileVarCallback } from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactWithCallbackVariable } from "./reactWithCallbackVariable.ts";

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
        type: "function",
      } as Omit<ComponentFileVarCallback, "var" | "components" | "file">,
      file,
    );
  }

  public load(data: Partial<ComponentFileVarCallback>) {
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
