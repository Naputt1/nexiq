import type { MemoFileVarHook } from "@react-map/shared";
import type { File } from "../fileDB.js";
import { ReactWithCallbackVariable } from "./reactWithCallbackVariable.js";

export class MemoVariable extends ReactWithCallbackVariable<"memo"> {
  constructor(
    options: Omit<
      MemoFileVarHook,
      "kind" | "var" | "components" | "type" | "file"
    >,
    file: File,
  ) {
    super(
      {
        ...options,
        kind: "memo",
        type: "function",
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      file,
    );
  }

  public load(data: MemoVariable) {
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
