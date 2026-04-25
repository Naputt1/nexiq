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
      } as Omit<MemoFileVarHook, "var" | "components" | "file">,
      file,
    );
  }

  public load(data: Partial<MemoFileVarHook>) {
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
