import type { MemoFileVarHook } from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactWithCallbackVariable } from "./reactWithCallbackVariable.ts";

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
