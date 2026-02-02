import type { MemoFileVarHook } from "shared";
import { ReactVariable } from "./reactVariable.js";
import type { File } from "../fileDB.js";

export class MemoVariable extends ReactVariable<"memo"> {
  memoDependencies: string[];

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

    this.memoDependencies = options.memoDependencies;
  }

  public load(data: MemoVariable) {
    super.load(data);

    // TODO: handle merge
  }

  public getData(): MemoFileVarHook {
    return {
      ...this.getBaseData(),
      kind: "memo",
      memoDependencies: this.memoDependencies,
    };
  }
}
